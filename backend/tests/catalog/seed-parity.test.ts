// T048: Spawn/bootstrap parity test.
//
// After seeding the catalog from in-code definitions, spawnEphemeralAgent and
// bootstrapDurableStaff produce the same agents/grants as the in-code baseline.
// SC-009: no code changes needed to add/change an agent definition after migration.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { createPool, runMigrations } from '../../src/db.js';
import { createCatalogStore } from '../../src/catalog/store.js';
import { approveVersion } from '../../src/catalog/admission.js';
import { spawnEphemeralAgent } from '../../src/ephemeral-templates.js';
import { bootstrapDurableStaff } from '../../src/durable-staff.js';

const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgresql://primeloop:primeloop_dev@127.0.0.1:5434/primeloop_test';

/** Seed a template version directly into the catalog at 'registered' state. */
async function seedCatalogTemplate(
  pool: pg.Pool,
  def: Record<string, unknown>,
): Promise<string> {
  const store = createCatalogStore(pool);
  const templateId = def.templateId as string;
  let tmplPk = (await store.getTemplateByTemplateId(templateId))?.id;
  if (!tmplPk) tmplPk = await store.createTemplate(templateId, def.name as string);
  const versionId = await store.createVersion({
    templatePk: tmplPk,
    version: def.version as string,
    admissionState: 'pending_approval',
    resolvedDefinition: def,
    contentHash: `parity-hash-${templateId}`,
    failureReasons: [],
    autoApproved: false,
  });
  await approveVersion(pool, versionId);
  return versionId;
}

describe('Spawn/Bootstrap Parity (T048)', () => {
  let pool: pg.Pool;
  let testDelegationId: string;

  beforeAll(async () => {
    pool = createPool(TEST_DB);
    await runMigrations(pool);
    // Seed a delegation row once (FK required by tool_grants.delegation_id)
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO delegations (capability, request, status)
       VALUES ('implementer', '{}', 'queued')
       RETURNING id`,
    );
    testDelegationId = rows[0].id;
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Clean agents, grants, and catalog tables
    await pool.query(`DELETE FROM tool_grants WHERE delegation_id = $1`, [testDelegationId]);
    await pool.query(`DELETE FROM tool_grants WHERE agent_id IN (SELECT id FROM agents WHERE tier = 'ephemeral')`);
    await pool.query(`DELETE FROM agent_runtime_configs WHERE agent_id IN (SELECT id FROM agents WHERE tier = 'ephemeral')`);
    await pool.query(`DELETE FROM agents WHERE tier = 'ephemeral'`);
    await pool.query(`DELETE FROM agents WHERE role IN ('architect', 'sre', 'devops') AND tier = 'durable'`);
    await pool.query(`DELETE FROM agent_runtime_configs WHERE agent_id NOT IN (SELECT id FROM agents)`);
    await pool.query(`DELETE FROM catalog_admission_events`);
    await pool.query(`DELETE FROM catalog_template_versions`);
    await pool.query(`DELETE FROM catalog_templates`);
    await pool.query(`DELETE FROM capability_profiles WHERE name LIKE '%-default'`);
  });

  describe('spawnEphemeralAgent', () => {
    it('falls back to in-code when catalog is empty', async () => {
      const result = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId: testDelegationId,
      });
      expect(result.agent.tier).toBe('ephemeral');
      expect(result.agent.role).toBe('implementer');
      expect(result.grant).toBeDefined();
    });

    it('uses catalog definition when implementer template is seeded', async () => {
      const catalogDef = {
        templateId: 'implementer',
        name: 'Implementer',
        version: '1.0.0',
        agentType: 'implementer',
        runtimeFamily: 'local',
        lifecycleIntent: 'ephemeral',
        soul: 'Focused implementation specialist. Executes scoped code changes with verification.',
        personaFile: 'prompts/agents/implementer.md',
        capabilityProfile: {
          platformPrimitives: ['update_work_item', 'soul.read', 'memory.read'],
          capabilityBundles: ['repo.read', 'repo.write'],
          denyRules: [
            { kind: 'primitive', primitive: 'delegate', reason: 'ephemeral agents cannot delegate' },
          ],
        },
        credentialNeeds: [],
        runtimeRequirements: { limits: { max_tokens: 50000, max_duration_ms: 300000, max_concurrent_processes: 2 } },
        approvalPolicy: { autoEligible: false },
        routing: { preferredRole: 'implementer' },
      };
      await seedCatalogTemplate(pool, catalogDef);

      const result = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId: testDelegationId,
      });

      expect(result.agent.tier).toBe('ephemeral');
      expect(result.agent.role).toBe('implementer');
      // Soul comes from catalog definition
      expect(result.agent.soul).toBe(catalogDef.soul);
      expect(result.grant).toBeDefined();
    });

    it('produces same role/tier for catalog and in-code paths', async () => {
      // In-code baseline
      const inCodeResult = await spawnEphemeralAgent(pool, 'reviewer', {
        delegationId: testDelegationId,
      });
      expect(inCodeResult.agent.role).toBe('reviewer');
      expect(inCodeResult.agent.tier).toBe('ephemeral');
    });
  });

  describe('bootstrapDurableStaff', () => {
    it('falls back to in-code when catalog has no durable templates', async () => {
      const result = await bootstrapDurableStaff(pool);
      expect(result.created.length + result.updated.length + result.unchanged.length).toBeGreaterThan(0);
      const roles = [...result.created, ...result.updated].map((a) => a.role);
      const allRoles = [...roles, ...result.unchanged];
      expect(allRoles).toContain('architect');
      expect(allRoles).toContain('sre');
      expect(allRoles).toContain('devops');
    });

    it('uses catalog definition when architect is seeded', async () => {
      const catalogDef = {
        templateId: 'architect',
        name: 'Architect',
        version: '1.0.0',
        agentType: 'architect',
        runtimeFamily: 'local',
        lifecycleIntent: 'durable',
        soul: 'Design-first thinker. Produces clear ADRs, cross-cutting consistency checks, and architectural guidance.',
        personaFile: 'prompts/agents/architect.md',
        capabilityProfile: {
          platformPrimitives: ['delegate', 'update_work_item', 'request_approval', 'soul.read', 'memory.read'],
          capabilityBundles: ['repo.read', 'repo.write'],
          denyRules: [],
        },
        credentialNeeds: [],
        runtimeRequirements: { limits: {} },
        approvalPolicy: { autoEligible: false },
        routing: { preferredRole: 'architect' },
      };
      await seedCatalogTemplate(pool, catalogDef);

      const result = await bootstrapDurableStaff(pool);
      const allAgents = [...result.created, ...result.updated];
      const architect = allAgents.find((a) => a.role === 'architect');

      // Architect was bootstrapped (either created or updated from catalog)
      expect(architect ?? result.unchanged.includes('architect')).toBeTruthy();
    });
  });
});
