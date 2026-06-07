// Integration tests for Agent Catalog: register → instantiate → active.
//
// Backed by a real Postgres test database. The validator is owned by a parallel
// workstream, so these tests DECOUPLE from validation by seeding a
// validated/pending_approval version row directly via the store, then exercise
// the real registration + instantiation paths.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import pg from 'pg';
import { createPool, runMigrations } from '../../src/db.js';
import { createCatalogStore } from '../../src/catalog/store.js';
import { approveVersion } from '../../src/catalog/admission.js';
import { instantiateFromVersion } from '../../src/catalog/instantiate.js';

const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgresql://primeloop:primeloop_dev@127.0.0.1:5434/primeloop_test';

const TEMPLATE_ID = 'catalog-it-template';

function baseDefinition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    templateId: TEMPLATE_ID,
    name: 'Catalog IT Agent',
    version: '1.0.0',
    agentType: 'researcher',
    runtimeFamily: 'local',
    lifecycleIntent: 'durable',
    systemPrompt: 'You are a careful research specialist.',
    soul: 'Methodical, least-privilege researcher.',
    persona: 'Research Specialist',
    capabilityProfile: {
      platformPrimitives: ['read-file', 'list-dir'],
      capabilityBundles: ['repo.read'],
      denyRules: [],
    },
    toolAccess: ['read-file', 'list-dir'],
    mcpAccess: [],
    credentialNeeds: [],
    runtimeRequirements: { limits: { maxTokens: 40000 } },
    approvalPolicy: { autoEligible: false },
    routing: { preferredRole: 'researcher' },
    ...overrides,
  };
}

/** Seed a template + a pending_approval version row directly (no validation). */
async function seedPendingVersion(
  store: ReturnType<typeof createCatalogStore>,
  def: Record<string, unknown>,
): Promise<{ templatePk: string; versionId: string }> {
  const templatePk = await store.createTemplate(TEMPLATE_ID, def.name as string);
  const versionId = await store.createVersion({
    templatePk,
    version: def.version as string,
    admissionState: 'pending_approval',
    resolvedDefinition: def as any,
    contentHash: `hash-${def.version}`,
    sourceId: undefined,
    failureReasons: [],
    autoApproved: false,
  });
  return { templatePk, versionId };
}

describe('Catalog Integration - register → instantiate → active', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = createPool(TEST_DB);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Tear down agents/grants/configs/credentials produced by prior runs, then
    // catalog state. Order respects FK dependencies.
    await pool.query(
      `DELETE FROM tool_grants WHERE agent_id IN (
         SELECT id FROM agents WHERE name LIKE 'Catalog IT%' OR config->>'template_id' = $1)`,
      [TEMPLATE_ID],
    );
    await pool.query(
      `DELETE FROM agent_runtime_configs WHERE agent_id IN (
         SELECT id FROM agents WHERE name LIKE 'Catalog IT%' OR config->>'template_id' = $1)`,
      [TEMPLATE_ID],
    );
    await pool.query(
      `DELETE FROM brokered_credentials WHERE agent_id IN (
         SELECT id FROM agents WHERE name LIKE 'Catalog IT%' OR config->>'template_id' = $1)`,
      [TEMPLATE_ID],
    );
    await pool.query(
      `DELETE FROM agents WHERE name LIKE 'Catalog IT%' OR config->>'template_id' = $1`,
      [TEMPLATE_ID],
    );
    await pool.query('DELETE FROM catalog_admission_events');
    await pool.query('DELETE FROM catalog_template_versions');
    await pool.query(`DELETE FROM catalog_templates WHERE template_id = $1`, [TEMPLATE_ID]);
    await pool.query(
      `DELETE FROM capability_profiles WHERE name LIKE 'catalog:' || $1 || '%'`,
      [TEMPLATE_ID],
    );
  });

  it('approveVersion registers: creates capability profile, links it, records event', async () => {
    const store = createCatalogStore(pool);
    const { versionId } = await seedPendingVersion(store, baseDefinition());

    const result = await approveVersion(pool, versionId, 'looks good');
    expect(result.success).toBe(true);
    expect(result.capabilityProfileId).toBeDefined();

    // Version is registered and linked to the profile.
    const version = await store.getVersionById(versionId);
    expect(version?.admissionState).toBe('registered');
    expect(version?.capabilityProfileId).toBe(result.capabilityProfileId);

    // Capability profile actually exists with mapped primitives/bundles.
    const { rows: profileRows } = await pool.query(
      'SELECT platform_primitives, capability_bundles FROM capability_profiles WHERE id = $1',
      [result.capabilityProfileId],
    );
    expect(profileRows).toHaveLength(1);
    expect(profileRows[0].platform_primitives).toEqual(['read-file', 'list-dir']);
    expect(profileRows[0].capability_bundles).toEqual(['repo.read']);

    // Template current_version_id now points at the registered version.
    // (getTemplateByTemplateId returns the raw row, so read the column directly.)
    const { rows: tplRows } = await pool.query(
      'SELECT current_version_id FROM catalog_templates WHERE template_id = $1',
      [TEMPLATE_ID],
    );
    expect(tplRows[0].current_version_id).toBe(versionId);

    // An admission event recorded the transition to registered.
    const events = await store.getAdmissionEvents(versionId);
    expect(events.some((e) => e.toState === 'registered')).toBe(true);
  });

  it('approveVersion rejects approving from the wrong state', async () => {
    const store = createCatalogStore(pool);
    // Seed a registered version directly (cannot approve again).
    const templatePk = await store.createTemplate(TEMPLATE_ID, 'Catalog IT Agent');
    const versionId = await store.createVersion({
      templatePk,
      version: '1.0.0',
      admissionState: 'registered',
      resolvedDefinition: baseDefinition() as any,
      contentHash: 'hash-reg',
      sourceId: undefined,
      failureReasons: [],
      autoApproved: false,
    });

    await expect(approveVersion(pool, versionId)).rejects.toThrow(/Cannot approve from state/);
  });

  it('instantiate creates a managed agent, runtime config, no process, → active', async () => {
    const store = createCatalogStore(pool);
    const { versionId } = await seedPendingVersion(store, baseDefinition());

    // Register first.
    const reg = await approveVersion(pool, versionId);
    expect(reg.success).toBe(true);

    // Instantiate.
    const inst = await instantiateFromVersion(pool, versionId, { name: 'Catalog IT Managed Agent' });
    expect(inst.blocked).toBeUndefined();
    expect(inst.agentId).toBeDefined();

    // Agent row exists, linked to the catalog version, execution_mode managed,
    // and NOT in a running/busy state (no process was started → state 'ready').
    const { rows: agentRows } = await pool.query(
      `SELECT execution_mode, tier, state, catalog_template_version_id, system_prompt, soul
         FROM agents WHERE id = $1`,
      [inst.agentId],
    );
    expect(agentRows).toHaveLength(1);
    expect(agentRows[0].execution_mode).toBe('managed');
    expect(agentRows[0].tier).toBe('durable');
    expect(agentRows[0].state).toBe('ready');
    expect(agentRows[0].catalog_template_version_id).toBe(versionId);
    expect(agentRows[0].system_prompt).toBe('You are a careful research specialist.');

    // Runtime config created with the capability profile + limits.
    const { rows: rcRows } = await pool.query(
      `SELECT capability_profile_id, limits FROM agent_runtime_configs WHERE agent_id = $1`,
      [inst.agentId],
    );
    expect(rcRows).toHaveLength(1);
    expect(rcRows[0].capability_profile_id).toBe(reg.capabilityProfileId);
    expect(rcRows[0].limits).toEqual({ maxTokens: 40000 });

    // A tool grant was resolved and persisted (least-privilege intersection).
    const { rows: grantRows } = await pool.query(
      `SELECT granted_primitives, granted_capability_bundles FROM tool_grants WHERE agent_id = $1`,
      [inst.agentId],
    );
    expect(grantRows.length).toBeGreaterThanOrEqual(1);
    expect(grantRows[0].granted_primitives).toEqual(['read-file', 'list-dir']);

    // Version transitioned to active with an admission event.
    const version = await store.getVersionById(versionId);
    expect(version?.admissionState).toBe('active');
    const events = await store.getAdmissionEvents(versionId);
    expect(events.some((e) => e.toState === 'active')).toBe(true);
  });

  it('instantiate is blocked with CREDENTIAL_NOT_PROVISIONED when a declared credential is missing', async () => {
    const store = createCatalogStore(pool);
    const def = baseDefinition({
      version: '2.0.0',
      credentialNeeds: ['MISSING_SECRET_TOKEN'],
    });
    const { versionId } = await seedPendingVersion(store, def);

    await approveVersion(pool, versionId);

    const inst = await instantiateFromVersion(pool, versionId);
    expect(inst.agentId).toBeUndefined();
    expect(inst.blocked?.code).toBe('CREDENTIAL_NOT_PROVISIONED');
    expect((inst.blocked as any).missingCredentials).toEqual(['MISSING_SECRET_TOKEN']);

    // No agent was created for the blocked instantiation.
    const { rows } = await pool.query(
      `SELECT id FROM agents WHERE catalog_template_version_id = $1`,
      [versionId],
    );
    expect(rows).toHaveLength(0);

    // Version stays registered (not advanced to active).
    const version = await store.getVersionById(versionId);
    expect(version?.admissionState).toBe('registered');
  });

  it('instantiate proceeds when the declared credential IS provisioned in the broker', async () => {
    const store = createCatalogStore(pool);
    const def = baseDefinition({
      version: '3.0.0',
      credentialNeeds: ['PROVISIONED_TOKEN'],
    });
    const { versionId } = await seedPendingVersion(store, def);
    await approveVersion(pool, versionId);

    // Provision the named credential in the broker. brokered_credentials.agent_id
    // is NOT NULL, so attach it to a throwaway agent; the provisioning check only
    // looks at scope->>'envName' + active status.
    const { rows: holder } = await pool.query(
      `INSERT INTO agents (name, type, runtime_family, execution_mode)
       VALUES ('Catalog IT Cred Holder', 'researcher', 'local', 'managed') RETURNING id`,
    );
    await pool.query(
      `INSERT INTO brokered_credentials (agent_id, kind, scope, secret_ref, status, auto_rotatable)
       VALUES ($1, 'named_secret', $2::jsonb, 'ref-provisioned', 'active', false)`,
      [holder[0].id, JSON.stringify({ envName: 'PROVISIONED_TOKEN' })],
    );

    const inst = await instantiateFromVersion(pool, versionId);
    expect(inst.blocked).toBeUndefined();
    expect(inst.agentId).toBeDefined();

    const version = await store.getVersionById(versionId);
    expect(version?.admissionState).toBe('active');
  });
});
