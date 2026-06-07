// T034: Versioning and rollback integration tests.
//
// Verifies: v1→v2 version history retained, rollback makes v1 current again,
// running managed agents from v1 are unaffected (SC-004, SC-006, FR-022, FR-023).

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import pg from 'pg';
import { createPool, runMigrations } from '../../src/db.js';
import { createCatalogStore } from '../../src/catalog/store.js';
import { approveVersion, rollbackVersion } from '../../src/catalog/admission.js';

const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgresql://primeloop:primeloop_dev@127.0.0.1:5434/primeloop_test';

const TEMPLATE_ID = 'rollback-test-template';

function makeDefinition(version: string): Record<string, unknown> {
  return {
    templateId: TEMPLATE_ID,
    name: 'Rollback Test',
    version,
    agentType: 'opencode',
    runtimeFamily: 'opencode',
    lifecycleIntent: 'ephemeral',
    systemPrompt: `Prompt for ${version}`,
    soul: 'Rollback soul',
    capabilityProfile: { platformPrimitives: ['soul.read'], capabilityBundles: [], denyRules: [] },
    credentialNeeds: [],
    runtimeRequirements: { limits: { maxTokens: 10000 } },
  };
}

async function seedVersion(
  store: ReturnType<typeof createCatalogStore>,
  version: string,
  state: 'pending_approval' | 'registered',
): Promise<{ templatePk: string; versionId: string }> {
  let templatePk = (await store.getTemplateByTemplateId(TEMPLATE_ID))?.id;
  if (!templatePk) {
    templatePk = await store.createTemplate(TEMPLATE_ID, 'Rollback Test');
  }
  const versionId = await store.createVersion({
    templatePk,
    version,
    admissionState: state,
    resolvedDefinition: makeDefinition(version) as any,
    contentHash: `hash-${version}`,
    failureReasons: [],
    autoApproved: false,
  });
  return { templatePk, versionId };
}

describe('Catalog Versioning & Rollback (T034)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = createPool(TEST_DB);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM catalog_admission_events');
    await pool.query('DELETE FROM catalog_template_versions');
    await pool.query('DELETE FROM catalog_templates');
  });

  it('registering v2 retains v1 and makes v2 the current version (FR-022, T039)', async () => {
    const store = createCatalogStore(pool);

    const { versionId: v1Id } = await seedVersion(store, '1.0.0', 'pending_approval');
    await approveVersion(pool, v1Id);

    const { versionId: v2Id } = await seedVersion(store, '2.0.0', 'pending_approval');
    await approveVersion(pool, v2Id);

    const tmpl = await store.getTemplateByTemplateId(TEMPLATE_ID);
    expect(tmpl?.currentVersionId).toBe(v2Id);

    const versions = await store.listVersions(tmpl!.id);
    expect(versions.length).toBe(2);
    const v1 = versions.find(v => v.version === '1.0.0');
    expect(v1?.admissionState).toBe('registered');
  });

  it('rollback sets v1 as current without losing version history (SC-006)', async () => {
    const store = createCatalogStore(pool);

    const { versionId: v1Id } = await seedVersion(store, '1.0.0', 'pending_approval');
    await approveVersion(pool, v1Id);

    const { versionId: v2Id } = await seedVersion(store, '2.0.0', 'pending_approval');
    await approveVersion(pool, v2Id);

    // Rollback to v1
    const rollbackResult = await rollbackVersion(pool, TEMPLATE_ID, '1.0.0');
    expect(rollbackResult.success).toBe(true);
    expect(rollbackResult.versionId).toBe(v1Id);

    const tmpl = await store.getTemplateByTemplateId(TEMPLATE_ID);
    expect(tmpl?.currentVersionId).toBe(v1Id);

    // v2 is still in version history
    const versions = await store.listVersions(tmpl!.id);
    expect(versions.length).toBe(2);
    expect(versions.find(v => v.version === '2.0.0')).toBeDefined();
  });

  it('rollback records an admission event for the transition', async () => {
    const store = createCatalogStore(pool);

    const { versionId: v1Id } = await seedVersion(store, '1.0.0', 'pending_approval');
    await approveVersion(pool, v1Id);

    const { versionId: v2Id } = await seedVersion(store, '2.0.0', 'pending_approval');
    await approveVersion(pool, v2Id);

    await rollbackVersion(pool, TEMPLATE_ID, '1.0.0');

    // The audit event may be on v1 or v2 (whichever was current at rollback time)
    const tmpl = await store.getTemplateByTemplateId(TEMPLATE_ID);
    const versions = await store.listVersions(tmpl!.id);
    let rollbackEvent;
    for (const v of versions) {
      const events = await store.getAdmissionEvents(v.id);
      rollbackEvent = events.find(e => e.reason?.includes('Rollback'));
      if (rollbackEvent) break;
    }
    expect(rollbackEvent).toBeDefined();
    expect(rollbackEvent?.actor).toBe('operator');
  });

  it('rollback to a non-registered version fails (SC-006 guard)', async () => {
    const store = createCatalogStore(pool);
    // Seed a version that is only validated (not registered)
    await seedVersion(store, '1.0.0', 'pending_approval');
    // Don't approve — stays at pending_approval

    const result = await rollbackVersion(pool, TEMPLATE_ID, '1.0.0');
    expect(result.success).toBe(false);
  });

  it('catalog changes do not mutate a running managed agent (SC-004, FR-023)', async () => {
    const store = createCatalogStore(pool);

    const { versionId: v1Id } = await seedVersion(store, '1.0.0', 'pending_approval');
    await approveVersion(pool, v1Id);

    // Simulate a running agent by creating an agents row linked to v1
    const { rows: agentRows } = await pool.query(
      `INSERT INTO agents (name, type, runtime_family, execution_mode, capabilities, config, catalog_template_version_id)
       VALUES ($1, 'opencode', 'opencode', 'managed', '[]', '{}', $2) RETURNING id`,
      [`rollback-test-agent-${Date.now()}`, v1Id],
    );
    const agentId = agentRows[0].id;

    // Register v2 and rollback
    const { versionId: v2Id } = await seedVersion(store, '2.0.0', 'pending_approval');
    await approveVersion(pool, v2Id);
    await rollbackVersion(pool, TEMPLATE_ID, '1.0.0');

    // The agent still references v1 — it was not touched
    const { rows } = await pool.query('SELECT catalog_template_version_id FROM agents WHERE id = $1', [agentId]);
    expect(rows[0].catalog_template_version_id).toBe(v1Id);

    // Cleanup
    await pool.query('DELETE FROM agents WHERE id = $1', [agentId]);
  });
});
