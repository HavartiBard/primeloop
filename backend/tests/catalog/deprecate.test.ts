// T035: Deprecation integration tests.
//
// Verifies FR-024: after deprecation, new instantiation is blocked; running
// agents from prior instantiations continue unaffected.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import pg from 'pg';
import { createPool, runMigrations } from '../../src/db.js';
import { createCatalogStore } from '../../src/catalog/store.js';
import { approveVersion, deprecateTemplate } from '../../src/catalog/admission.js';
import { instantiateFromVersion } from '../../src/catalog/instantiate.js';

const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgresql://primeloop:primeloop_dev@127.0.0.1:5434/primeloop_test';

const TEMPLATE_ID = 'deprecate-test-template';

function makeDefinition(): Record<string, unknown> {
  return {
    templateId: TEMPLATE_ID,
    name: 'Deprecate Test',
    version: '1.0.0',
    agentType: 'opencode',
    runtimeFamily: 'opencode',
    lifecycleIntent: 'ephemeral',
    systemPrompt: 'Test prompt.',
    soul: 'Test soul.',
    capabilityProfile: { platformPrimitives: ['soul.read'], capabilityBundles: [], denyRules: [] },
    credentialNeeds: [],
    runtimeRequirements: { limits: { maxTokens: 10000 } },
  };
}

async function seedRegisteredVersion(store: ReturnType<typeof createCatalogStore>, pool: pg.Pool): Promise<string> {
  let templatePk = (await store.getTemplateByTemplateId(TEMPLATE_ID))?.id;
  if (!templatePk) {
    templatePk = await store.createTemplate(TEMPLATE_ID, 'Deprecate Test');
  }
  const versionId = await store.createVersion({
    templatePk,
    version: '1.0.0',
    admissionState: 'pending_approval',
    resolvedDefinition: makeDefinition() as any,
    contentHash: 'deprecate-hash',
    failureReasons: [],
    autoApproved: false,
  });
  await approveVersion(pool, versionId);
  return versionId;
}

describe('Catalog Deprecation (T035)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = createPool(TEST_DB);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM tool_grants WHERE agent_id IN (SELECT id FROM agents WHERE name LIKE 'deprecate-test-%')`);
    await pool.query(`DELETE FROM agent_runtime_configs WHERE agent_id IN (SELECT id FROM agents WHERE name LIKE 'deprecate-test-%')`);
    await pool.query(`DELETE FROM agents WHERE name LIKE 'deprecate-test-%'`);
    await pool.query('DELETE FROM catalog_admission_events');
    await pool.query('DELETE FROM catalog_template_versions');
    await pool.query('DELETE FROM catalog_templates');
  });

  it('deprecating a template blocks new instantiation (FR-024)', async () => {
    const store = createCatalogStore(pool);
    const versionId = await seedRegisteredVersion(store, pool);

    await deprecateTemplate(pool, TEMPLATE_ID);

    const result = await instantiateFromVersion(pool, versionId);
    expect(result.blocked).toBeDefined();
    expect(result.blocked!.code).toBe('TEMPLATE_DEPRECATED');
    expect(result.agentId).toBeUndefined();
  });

  it('deprecation marks the template lifecycle_state = deprecated', async () => {
    const store = createCatalogStore(pool);
    await seedRegisteredVersion(store, pool);

    await deprecateTemplate(pool, TEMPLATE_ID);

    const tmpl = await store.getTemplateByTemplateId(TEMPLATE_ID);
    expect(tmpl?.lifecycleState).toBe('deprecated');
  });

  it('deprecation records an admission event', async () => {
    const store = createCatalogStore(pool);
    const versionId = await seedRegisteredVersion(store, pool);

    await deprecateTemplate(pool, TEMPLATE_ID);

    const events = await store.getAdmissionEvents(versionId);
    const deprecateEvent = events.find(e => e.toState === 'deprecated');
    expect(deprecateEvent).toBeDefined();
    expect(deprecateEvent?.actor).toBe('operator');
  });

  it('a running agent from a prior instantiation continues after deprecation (FR-024)', async () => {
    const store = createCatalogStore(pool);
    const versionId = await seedRegisteredVersion(store, pool);

    // Simulate a running agent linked to this version
    const { rows } = await pool.query(
      `INSERT INTO agents (name, type, runtime_family, execution_mode, capabilities, config, catalog_template_version_id)
       VALUES ($1, 'opencode', 'opencode', 'managed', '[]', '{}', $2) RETURNING id, state`,
      [`deprecate-test-agent-${Date.now()}`, versionId],
    );
    const agentId = rows[0].id;
    const agentStateBefore = rows[0].state;

    await deprecateTemplate(pool, TEMPLATE_ID);

    // Agent row is unchanged
    const { rows: after } = await pool.query('SELECT state FROM agents WHERE id = $1', [agentId]);
    expect(after[0].state).toBe(agentStateBefore);

    await pool.query('DELETE FROM agents WHERE id = $1', [agentId]);
  });

  it('deprecating an unknown template returns success=false', async () => {
    const result = await deprecateTemplate(pool, 'nonexistent-template-xyz');
    expect(result.success).toBe(false);
  });
});
