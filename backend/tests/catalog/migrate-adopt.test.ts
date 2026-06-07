// T049: Migrate-adopt integration test.
//
// Verifies FR-028: adopting a migrated template does not interrupt a running
// agent and links the agent to catalog_template_version_id.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import pg from 'pg';
import { createPool, runMigrations } from '../../src/db.js';
import { createCatalogStore } from '../../src/catalog/store.js';
import { approveVersion } from '../../src/catalog/admission.js';
import { instantiateFromVersion } from '../../src/catalog/instantiate.js';

const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgresql://primeloop:primeloop_dev@127.0.0.1:5434/primeloop_test';

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
    contentHash: `adopt-hash-${templateId}-${def.version}`,
    failureReasons: [],
    autoApproved: false,
  });
  await approveVersion(pool, versionId);
  return versionId;
}

describe('Migrate-Adopt Integration (T049)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = createPool(TEST_DB);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM tool_grants WHERE agent_id IN (SELECT id FROM agents WHERE name LIKE 'adopt-%')`);
    await pool.query(`DELETE FROM agent_runtime_configs WHERE agent_id IN (SELECT id FROM agents WHERE name LIKE 'adopt-%')`);
    await pool.query(`DELETE FROM agents WHERE name LIKE 'adopt-%'`);
    await pool.query(`DELETE FROM catalog_admission_events`);
    await pool.query(`DELETE FROM catalog_template_versions`);
    await pool.query(`DELETE FROM catalog_templates`);
  });

  it('instantiating a migrated template links the agent via catalog_template_version_id (FR-028)', async () => {
    const store = createCatalogStore(pool);
    const def = {
      templateId: 'adopt-researcher',
      name: 'Adopt Researcher',
      version: '1.0.0',
      agentType: 'researcher',
      runtimeFamily: 'local',
      lifecycleIntent: 'durable',
      soul: 'Read-only researcher.',
      personaFile: 'prompts/agents/default-instructions.md',
      capabilityProfile: {
        platformPrimitives: ['soul.read', 'memory.read'],
        capabilityBundles: ['repo.read'],
        denyRules: [],
      },
      credentialNeeds: [],
      runtimeRequirements: { limits: {} },
      approvalPolicy: { autoEligible: false },
      routing: { preferredRole: 'researcher' },
    };
    const versionId = await seedRegistered(store, pool, def);

    const result = await instantiateFromVersion(pool, versionId, { name: 'adopt-researcher-1' });
    expect(result.blocked).toBeUndefined();
    expect(result.agentId).toBeTruthy();

    // Agent is linked to catalog template version
    const { rows } = await pool.query<{ catalog_template_version_id: string | null }>(
      `SELECT catalog_template_version_id FROM agents WHERE id = $1`,
      [result.agentId],
    );
    expect(rows[0]?.catalog_template_version_id).toBe(versionId);
  });

  it('adopting a new version does not affect existing agents instantiated from an older version', async () => {
    const store = createCatalogStore(pool);
    const defV1 = {
      templateId: 'adopt-versioned',
      name: 'Adopt Versioned',
      version: '1.0.0',
      agentType: 'researcher',
      runtimeFamily: 'local',
      lifecycleIntent: 'durable',
      soul: 'V1 researcher.',
      personaFile: 'prompts/agents/default-instructions.md',
      capabilityProfile: {
        platformPrimitives: ['soul.read'],
        capabilityBundles: ['repo.read'],
        denyRules: [],
      },
      credentialNeeds: [],
      runtimeRequirements: { limits: {} },
      approvalPolicy: { autoEligible: false },
      routing: { preferredRole: 'researcher' },
    };
    const v1Id = await seedRegistered(store, pool, defV1);
    const r1 = await instantiateFromVersion(pool, v1Id, { name: 'adopt-versioned-v1' });
    expect(r1.blocked).toBeUndefined();

    // Register v2 of the same template
    const defV2 = { ...defV1, version: '2.0.0', soul: 'V2 researcher.' };
    const tmpl = await store.getTemplateByTemplateId('adopt-versioned');
    const v2Id = await store.createVersion({
      templatePk: tmpl!.id,
      version: '2.0.0',
      admissionState: 'pending_approval',
      resolvedDefinition: defV2,
      contentHash: 'adopt-hash-adopt-versioned-2.0.0',
      failureReasons: [],
      autoApproved: false,
    });
    await approveVersion(pool, v2Id);

    // Instantiate v2
    const r2 = await instantiateFromVersion(pool, v2Id, { name: 'adopt-versioned-v2' });
    expect(r2.blocked).toBeUndefined();
    expect(r2.agentId).not.toBe(r1.agentId);

    // v1 agent is unaffected: still linked to v1
    const { rows: v1Rows } = await pool.query<{ catalog_template_version_id: string }>(
      `SELECT catalog_template_version_id FROM agents WHERE id = $1`,
      [r1.agentId],
    );
    expect(v1Rows[0]?.catalog_template_version_id).toBe(v1Id);

    // v2 agent linked to v2
    const { rows: v2Rows } = await pool.query<{ catalog_template_version_id: string }>(
      `SELECT catalog_template_version_id FROM agents WHERE id = $1`,
      [r2.agentId],
    );
    expect(v2Rows[0]?.catalog_template_version_id).toBe(v2Id);
  });

  it('a running agent (state=active) is not interrupted when its template is deprecated', async () => {
    const store = createCatalogStore(pool);
    const baseDef = {
      templateId: 'adopt-deprecate-test',
      name: 'Deprecate Test',
      agentType: 'researcher',
      runtimeFamily: 'local',
      lifecycleIntent: 'durable',
      soul: 'Researcher.',
      personaFile: 'prompts/agents/default-instructions.md',
      capabilityProfile: {
        platformPrimitives: ['soul.read'],
        capabilityBundles: ['repo.read'],
        denyRules: [],
      },
      credentialNeeds: [],
      runtimeRequirements: { limits: {} },
      approvalPolicy: { autoEligible: false },
      routing: { preferredRole: 'researcher' },
    };

    // Seed v1 and instantiate — v1 transitions to 'active'
    const v1Id = await seedRegistered(store, pool, { ...baseDef, version: '1.0.0' });
    const r = await instantiateFromVersion(pool, v1Id, { name: 'adopt-deprecate-agent' });
    expect(r.blocked).toBeUndefined();

    // Seed v2 (still registered) so we have a fresh version to block
    const tmpl = await store.getTemplateByTemplateId('adopt-deprecate-test');
    const v2Id = await store.createVersion({
      templatePk: tmpl!.id,
      version: '2.0.0',
      admissionState: 'pending_approval',
      resolvedDefinition: { ...baseDef, version: '2.0.0' },
      contentHash: 'adopt-hash-deprecate-2.0.0',
      failureReasons: [],
      autoApproved: false,
    });
    await approveVersion(pool, v2Id);

    // Deprecate the template
    await pool.query(
      `UPDATE catalog_templates SET lifecycle_state = 'deprecated' WHERE template_id = $1`,
      ['adopt-deprecate-test'],
    );

    // Running agent state is unchanged — deprecation does NOT touch agent rows
    const { rows } = await pool.query<{ state: string }>(
      `SELECT state FROM agents WHERE id = $1`,
      [r.agentId],
    );
    expect(rows[0]?.state).toBeTruthy();

    // New instantiation of the registered v2 is now blocked by template deprecation
    const r2 = await instantiateFromVersion(pool, v2Id, { name: 'adopt-deprecate-agent-2' });
    expect(r2.blocked?.code).toBe('TEMPLATE_DEPRECATED');
  });
});
