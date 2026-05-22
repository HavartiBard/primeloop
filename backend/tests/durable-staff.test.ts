import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { bootstrapDurableStaff, type DurableStaffBootstrapResult } from '../src/durable-staff.js'
import {
  getAgentByRole,
  listAgents,
  getCapabilityProfileByName,
  getAgentRuntimeConfig,
} from '../src/registry.js'

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://agent_cp:agent_cp_dev@127.0.0.1:5434/agent_cp_test'

describe('durable staff bootstrap', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
  })

  beforeEach(async () => {
    // Clean up any existing durable staff from previous tests
    await pool.query('DELETE FROM tool_grants WHERE agent_id IN (SELECT id FROM agents WHERE tier = \'durable\' AND role IN (\'architect\', \'sre\', \'devops\'))')
    await pool.query('DELETE FROM agent_runtime_configs WHERE agent_id IN (SELECT id FROM agents WHERE tier = \'durable\' AND role IN (\'architect\', \'sre\', \'devops\'))')
    await pool.query('DELETE FROM capability_profiles WHERE name LIKE \'%-default\'')
    await pool.query("DELETE FROM agents WHERE tier = 'durable' AND role IN ('architect', 'sre', 'devops')")
  })

  afterAll(async () => {
    await pool.end()
  })

  it('creates all three durable staff agents on first run', async () => {
    const result = await bootstrapDurableStaff(pool)

    expect(result.created.length).toBe(3)
    expect(result.updated.length).toBe(0)
    expect(result.unchanged.length).toBe(0)

    // Verify each role was created
    const roles = result.created.map((a) => a.role).sort()
    expect(roles).toEqual(['architect', 'devops', 'sre'])

    // Verify all are durable tier
    for (const agent of result.created) {
      expect(agent.tier).toBe('durable')
      expect(agent.enabled).toBe(true)
      expect(agent.state).toBe('provisioning')
    }
  })

  it('does not duplicate agents on re-run', async () => {
    // First bootstrap
    const firstResult = await bootstrapDurableStaff(pool)
    expect(firstResult.created.length).toBe(3)

    // Second bootstrap should find all existing
    const secondResult = await bootstrapDurableStaff(pool)
    expect(secondResult.created.length).toBe(0)
    expect(secondResult.unchanged.length).toBe(3)

    // Verify total count is still 3
    const agents = await listAgents(pool)
    const durableStaff = agents.filter((a) => a.role && ['architect', 'sre', 'devops'].includes(a.role))
    expect(durableStaff.length).toBe(3)
  })

  it('preserves agent identity across bootstrap runs', async () => {
    // First bootstrap
    const firstResult = await bootstrapDurableStaff(pool)
    const firstIds = new Map(firstResult.created.map((a) => [a.role, a.id]))

    // Second bootstrap
    const secondResult = await bootstrapDurableStaff(pool)
    expect(secondResult.created.length).toBe(0)

    // Verify identities match
    for (const role of ['architect', 'sre', 'devops']) {
      const agent = await getAgentByRole(pool, role)
      expect(agent).not.toBeNull()
      expect(agent!.id).toBe(firstIds.get(role))
    }
  })

  it('creates capability profiles for each role', async () => {
    const result = await bootstrapDurableStaff(pool)

    for (const defRole of ['architect', 'sre', 'devops']) {
      const profile = await getCapabilityProfileByName(pool, `${defRole}-default`)
      expect(profile).not.toBeNull()
      expect(profile!.name).toBe(`${defRole}-default`)
    }
  })

  it('creates runtime config for each agent', async () => {
    const result = await bootstrapDurableStaff(pool)

    for (const agent of result.created) {
      const config = await getAgentRuntimeConfig(pool, agent.id)
      expect(config).not.toBeNull()
      expect(config!.capability_profile_id).toBeDefined()
    }
  })

  it('reconciles persona file changes without identity churn', async () => {
    // First bootstrap with default definitions
    await bootstrapDurableStaff(pool)
    const architectBefore = await getAgentByRole(pool, 'architect')
    expect(architectBefore).not.toBeNull()
    const originalId = architectBefore!.id

    // Second bootstrap with modified persona file
    const customDefs = [
      {
        role: 'architect',
        name: 'Architect',
        type: 'architect',
        personaFile: 'prompts/agents/architect-v2.md',
        soul: 'Updated soul definition.',
        platformPrimitives: ['delegate'],
        capabilityBundles: ['repo.read'],
        denyRules: [],
        approvalRules: {},
      },
    ]
    const result = await bootstrapDurableStaff(pool, customDefs)

    // Should show as updated, not created
    expect(result.created.length).toBe(0)
    expect(result.updated.length).toBe(1)
    expect(result.updated[0].id).toBe(originalId)
    expect(result.updated[0].persona_file).toBe('prompts/agents/architect-v2.md')

    // Identity preserved
    const architectAfter = await getAgentByRole(pool, 'architect')
    expect(architectAfter!.id).toBe(originalId)
  })

  it('has correct role-specific capability bundles', async () => {
    await bootstrapDurableStaff(pool)

    const architectProfile = await getCapabilityProfileByName(pool, 'architect-default')
    expect(architectProfile!.capability_bundles).toContain('repo.read')
    expect(architectProfile!.capability_bundles).toContain('repo.write')

    const sreProfile = await getCapabilityProfileByName(pool, 'sre-default')
    expect(sreProfile!.capability_bundles).toContain('ci.inspect')
    expect(sreProfile!.deny_rules.length).toBeGreaterThan(0)

    const devopsProfile = await getCapabilityProfileByName(pool, 'devops-default')
    expect(devopsProfile!.capability_bundles).toContain('deploy.production')
  })
})
