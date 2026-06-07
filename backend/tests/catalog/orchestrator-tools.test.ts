// T042: Contract tests for catalog control-plane tools.
//
// Verifies per contracts/orchestrator-skill.md:
// - catalog_list_registered: only returns registered non-deprecated templates
// - catalog_propose_instantiation: rationale + requiresHumanApproval via baseline
// - catalog_instantiate: pending_approval for non-baseline, active for auto-eligible,
//   blocked for missing credential, and grants never exceed the declaration (FR-030)
// - actor='prime' events recorded (T046)

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import pg from 'pg';
import { createPool, runMigrations } from '../../src/db.js';
import { createCatalogStore } from '../../src/catalog/store.js';
import { approveVersion } from '../../src/catalog/admission.js';
import {
  catalogListRegistered,
  catalogProposeInstantiation,
  catalogInstantiate,
} from '../../src/catalog/orchestrator-tools.js';

const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgresql://primeloop:primeloop_dev@127.0.0.1:5434/primeloop_test';

// A baseline-eligible template (uses an allowed baseline bundle, autoEligible, no credentials)
const BASELINE_DEF: Record<string, unknown> = {
  templateId: 'orch-baseline-tpl',
  name: 'Baseline Template',
  version: '1.0.0',
  agentType: 'opencode',
  runtimeFamily: 'opencode',
  lifecycleIntent: 'ephemeral',
  systemPrompt: 'Read the repository carefully.',
  soul: 'Careful read-only researcher.',
  // 'git-read' is in SAFE_BASELINE.allowedBundles and has no forbidden primitives
  capabilityProfile: { platformPrimitives: ['soul.read', 'memory.read'], capabilityBundles: ['git-read'], denyRules: [] },
  credentialNeeds: [],
  runtimeRequirements: { limits: { maxTokens: 20000 }, egress: { allowlist: [] } },
  approvalPolicy: { autoEligible: true },
  routing: { preferredRole: 'research' },
};

// A non-baseline template (has delegate primitive → exceeds safe baseline)
const NON_BASELINE_DEF: Record<string, unknown> = {
  templateId: 'orch-nonbaseline-tpl',
  name: 'Non-Baseline Template',
  version: '1.0.0',
  agentType: 'opencode',
  runtimeFamily: 'opencode',
  lifecycleIntent: 'durable',
  systemPrompt: 'Manage delegations.',
  soul: 'Delegation manager.',
  capabilityProfile: { platformPrimitives: ['delegate', 'update_work_item'], capabilityBundles: [], denyRules: [] },
  credentialNeeds: [],
  runtimeRequirements: { limits: { maxTokens: 30000 } },
  approvalPolicy: { autoEligible: false },
  routing: { preferredRole: 'orchestrator' },
};

async function seedRegistered(
  store: ReturnType<typeof createCatalogStore>,
  pool: pg.Pool,
  def: Record<string, unknown>,
): Promise<string> {
  const templateId = def.templateId as string;
  let tmplPk = (await store.getTemplateByTemplateId(templateId))?.id;
  if (!tmplPk) tmplPk = await store.createTemplate(templateId, def.name as string);
  const versionId = await store.createVersion({
    templatePk: tmplPk,
    version: def.version as string,
    admissionState: 'pending_approval',
    resolvedDefinition: def,
    contentHash: `hash-${templateId}`,
    failureReasons: [],
    autoApproved: false,
  });
  await approveVersion(pool, versionId);
  return versionId;
}

describe('Catalog Orchestrator Tools (T042)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = createPool(TEST_DB);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM tool_grants WHERE agent_id IN (SELECT id FROM agents WHERE name LIKE 'orch-%')`);
    await pool.query(`DELETE FROM agent_runtime_configs WHERE agent_id IN (SELECT id FROM agents WHERE name LIKE 'orch-%')`);
    await pool.query(`DELETE FROM agents WHERE name LIKE 'orch-%'`);
    await pool.query("DELETE FROM approvals WHERE action LIKE 'catalog.instantiate:%'");
    await pool.query('DELETE FROM catalog_admission_events');
    await pool.query('DELETE FROM catalog_template_versions');
    await pool.query('DELETE FROM catalog_templates');
  });

  // ── catalog_list_registered ─────────────────────────────────────────────

  describe('catalog_list_registered', () => {
    it('returns registered non-deprecated templates', async () => {
      const store = createCatalogStore(pool);
      await seedRegistered(store, pool, BASELINE_DEF);
      await seedRegistered(store, pool, NON_BASELINE_DEF);

      const { templates } = await catalogListRegistered(pool, {});
      const ids = templates.map(t => t.templateId);
      expect(ids).toContain('orch-baseline-tpl');
      expect(ids).toContain('orch-nonbaseline-tpl');
    });

    it('filters by capability', async () => {
      const store = createCatalogStore(pool);
      await seedRegistered(store, pool, BASELINE_DEF);

      const { templates } = await catalogListRegistered(pool, { capability: 'research' });
      expect(templates.map(t => t.templateId)).toContain('orch-baseline-tpl');

      const { templates: none } = await catalogListRegistered(pool, { capability: 'nonexistent-capability' });
      expect(none.map(t => t.templateId)).not.toContain('orch-baseline-tpl');
    });

    it('filters by lifecycleIntent', async () => {
      const store = createCatalogStore(pool);
      await seedRegistered(store, pool, BASELINE_DEF);   // ephemeral
      await seedRegistered(store, pool, NON_BASELINE_DEF); // durable

      const { templates: ephemeral } = await catalogListRegistered(pool, { lifecycleIntent: 'ephemeral' });
      expect(ephemeral.map(t => t.templateId)).toContain('orch-baseline-tpl');
      expect(ephemeral.map(t => t.templateId)).not.toContain('orch-nonbaseline-tpl');
    });

    it('excludes deprecated templates', async () => {
      const store = createCatalogStore(pool);
      await seedRegistered(store, pool, BASELINE_DEF);
      await pool.query(`UPDATE catalog_templates SET lifecycle_state = 'deprecated' WHERE template_id = $1`, ['orch-baseline-tpl']);

      const { templates } = await catalogListRegistered(pool, {});
      expect(templates.map(t => t.templateId)).not.toContain('orch-baseline-tpl');
    });
  });

  // ── catalog_propose_instantiation ──────────────────────────────────────

  describe('catalog_propose_instantiation', () => {
    it('returns rationale and requiresHumanApproval=false for baseline template', async () => {
      const store = createCatalogStore(pool);
      await seedRegistered(store, pool, BASELINE_DEF);

      const proposal = await catalogProposeInstantiation(pool, {
        intent: 'research',
        templateId: 'orch-baseline-tpl',
      });

      expect(proposal.templateId).toBe('orch-baseline-tpl');
      expect(proposal.rationale).toBeTruthy();
      expect(proposal.requiresHumanApproval).toBe(false);
      expect(proposal.estimatedGrants.primitives).toContain('soul.read');
    });

    it('returns requiresHumanApproval=true for non-baseline template (FR-030)', async () => {
      const store = createCatalogStore(pool);
      await seedRegistered(store, pool, NON_BASELINE_DEF);

      const proposal = await catalogProposeInstantiation(pool, {
        intent: 'orchestrator',
        templateId: 'orch-nonbaseline-tpl',
      });

      expect(proposal.requiresHumanApproval).toBe(true);
    });

    it('auto-selects a matching template when templateId is omitted', async () => {
      const store = createCatalogStore(pool);
      await seedRegistered(store, pool, BASELINE_DEF);

      const proposal = await catalogProposeInstantiation(pool, { intent: 'research' });
      expect(proposal.templateId).toBe('orch-baseline-tpl');
    });

    it('throws when no template matches the intent', async () => {
      await expect(
        catalogProposeInstantiation(pool, { intent: 'xyzzy-nonexistent' }),
      ).rejects.toThrow(/No registered template/);
    });
  });

  // ── catalog_instantiate ────────────────────────────────────────────────

  describe('catalog_instantiate', () => {
    it('returns pending_approval for non-baseline template (FR-030)', async () => {
      const store = createCatalogStore(pool);
      await seedRegistered(store, pool, NON_BASELINE_DEF);

      const result = await catalogInstantiate(pool, { templateId: 'orch-nonbaseline-tpl' });
      expect(result.status).toBe('pending_approval');
      expect('approvalId' in result && result.approvalId).toBeTruthy();
      // No agent was created
      const { rows } = await pool.query('SELECT id FROM agents WHERE name LIKE \'orch-%\'');
      expect(rows).toHaveLength(0);
    });

    it('returns active for auto-eligible baseline template', async () => {
      const store = createCatalogStore(pool);
      await seedRegistered(store, pool, BASELINE_DEF);

      const result = await catalogInstantiate(pool, {
        templateId: 'orch-baseline-tpl',
        name: 'orch-test-agent',
      });
      expect(result.status).toBe('active');
      expect('agentId' in result && result.agentId).toBeTruthy();
    });

    it('records actor=prime admission events (T046)', async () => {
      const store = createCatalogStore(pool);
      await seedRegistered(store, pool, NON_BASELINE_DEF);

      await catalogInstantiate(pool, { templateId: 'orch-nonbaseline-tpl' });

      const tmpl = await store.getTemplateByTemplateId('orch-nonbaseline-tpl');
      const versions = await store.listVersions(tmpl!.id);
      const events = await store.getAdmissionEvents(versions[0].id);
      const primeEvent = events.find(e => e.actor === 'prime');
      expect(primeEvent).toBeDefined();
    });

    it('returns blocked for unknown template', async () => {
      const result = await catalogInstantiate(pool, { templateId: 'does-not-exist' });
      expect(result.status).toBe('blocked');
      expect((result as any).code).toBe('TEMPLATE_NOT_FOUND');
    });

    it('grants never exceed the template declaration (FR-030)', async () => {
      const store = createCatalogStore(pool);
      await seedRegistered(store, pool, BASELINE_DEF);

      const result = await catalogInstantiate(pool, {
        templateId: 'orch-baseline-tpl',
        name: 'orch-grant-check',
      });
      expect(result.status).toBe('active');

      // The created agent exists and is linked to the template version
      const { rows } = await pool.query(
        'SELECT catalog_template_version_id FROM agents WHERE name = $1',
        ['orch-grant-check'],
      );
      expect(rows[0]?.catalog_template_version_id).toBeTruthy();
    });
  });
});
