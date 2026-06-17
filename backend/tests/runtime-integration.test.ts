import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { createDelegation } from '../src/runtime.js'
import { bootstrapDurableStaff } from '../src/durable-staff.js'
import { spawnEphemeralAgent, retireEphemeralAgent } from '../src/ephemeral-templates.js'
import {
  getAgentByRole,
  listAgents,
  listToolGrants,
  getAgentRuntimeConfig,
  getCapabilityProfileByName,
} from '../src/registry.js'

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://primeloop:primeloop_dev@127.0.0.1:5434/primeloop_test'

describe('runtime integration', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
  })

  beforeEach(async () => {
    // Clean up test artifacts — delete in correct order to respect FK constraints
    await pool.query("DELETE FROM tool_grants WHERE agent_id IN (SELECT id FROM agents WHERE tier IN ('durable', 'ephemeral'))")
    await pool.query("DELETE FROM agent_runtime_configs WHERE agent_id IN (SELECT id FROM agents WHERE tier IN ('durable', 'ephemeral'))")
    await pool.query("DELETE FROM capability_profiles WHERE name LIKE '%-default'")
    await pool.query("DELETE FROM agents WHERE tier IN ('durable', 'ephemeral')")
  })

  afterAll(async () => {
    await pool.end()
  })

  // tool_grants.delegation_id is FK-constrained to delegations; create a real row.
  const mkDelegationId = async (): Promise<string> =>
    (await createDelegation(pool, { capability: 'implementation' })).id

  describe('durable worker full path', () => {
    it('bootstrap → identity stable → profile linked → config created', async () => {
      // Bootstrap durable staff
      const bootstrapResult = await bootstrapDurableStaff(pool)
      expect(bootstrapResult.created.length).toBe(3)

      // Verify each durable agent has complete linkage
      for (const role of ['architect', 'sre', 'devops']) {
        const agent = await getAgentByRole(pool, role)
        expect(agent).not.toBeNull()
        expect(agent!.tier).toBe('durable')
        expect(agent!.state).toBe('provisioning')

        // Verify runtime config exists with profile linkage
        const config = await getAgentRuntimeConfig(pool, agent!.id)
        expect(config).not.toBeNull()
        expect(config!.capability_profile_id).toBeDefined()

        // Verify capability profile exists
        const profile = await getCapabilityProfileByName(pool, `${role}-default`)
        expect(profile).not.toBeNull()
      }

      // Re-run bootstrap — no duplicates
      const secondBootstrap = await bootstrapDurableStaff(pool)
      expect(secondBootstrap.created.length).toBe(0)
      expect(secondBootstrap.unchanged.length).toBe(3)
    })

    it('durable agents persist across bootstrap cycles', async () => {
      // First bootstrap
      const first = await bootstrapDurableStaff(pool)
      const architectId1 = first.created.find((a) => a.role === 'architect')!.id

      // Second bootstrap
      const second = await bootstrapDurableStaff(pool)
      const architectAgent = await getAgentByRole(pool, 'architect')

      // Same identity preserved
      expect(architectAgent!.id).toBe(architectId1)
      expect(second.created.length).toBe(0)
    })
  })

  describe('ephemeral worker full path', () => {
    it('spawn → grant created → retire → audit queryable', async () => {
      // Spawn ephemeral agent
      const delegationId = await mkDelegationId()
      const spawnResult = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId,
      })

      expect(spawnResult.agent.tier).toBe('ephemeral')
      expect(spawnResult.agent.state).toBe('provisioning')

      // Verify at least one grant exists and is active for this delegation
      const grants = await listToolGrants(pool, { agent_id: spawnResult.agent.id })
      expect(grants.length).toBeGreaterThanOrEqual(1)
      const activeGrant = grants.find((g) => g.revocation_state === 'active' && g.delegation_id === delegationId)
      expect(activeGrant).not.toBeNull()

      // Retire the agent
      await retireEphemeralAgent(pool, spawnResult.agent.id, { success: true })

      // Verify grant is revoked
      const grantsAfter = await listToolGrants(pool, { agent_id: spawnResult.agent.id })
      expect(grantsAfter[0].revocation_state).toBe('revoked')

      // Verify agent row still queryable for audit
      const allAgents = await listAgents(pool)
      const retiredAgent = allAgents.find((a) => a.id === spawnResult.agent.id)
      expect(retiredAgent).not.toBeNull()
      expect(retiredAgent!.tier).toBe('ephemeral')
    })

    it('multiple ephemeral agents can coexist', async () => {
      const del1 = await mkDelegationId()
      const del2 = await mkDelegationId()

      const spawn1 = await spawnEphemeralAgent(pool, 'implementer', { delegationId: del1 })
      const spawn2 = await spawnEphemeralAgent(pool, 'reviewer', { delegationId: del2 })

      expect(spawn1.agent.id).not.toBe(spawn2.agent.id)

      // Both should be queryable
      const allAgents = await listAgents(pool)
      const ephemerals = allAgents.filter((a) => a.tier === 'ephemeral')
      expect(ephemerals.length).toBe(2)
    })

    it('ephemeral grants are narrower than durable staff', async () => {
      // Bootstrap durable architect
      await bootstrapDurableStaff(pool)
      const architect = await getAgentByRole(pool, 'architect')!

      // Spawn ephemeral implementer
      const spawnResult = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId: await mkDelegationId(),
      })

      // Verify architect has broader platform primitives than implementer
      const architectProfile = await getCapabilityProfileByName(pool, 'architect-default')
      const implementerProfile = await getCapabilityProfileByName(pool, 'implementer-default')

      expect(architectProfile!.platform_primitives.length).toBeGreaterThan(
        implementerProfile!.platform_primitives.length,
      )
    })
  })

  describe('cross-slice integration', () => {
    it('durable and ephemeral agents coexist without conflicts', async () => {
      // Bootstrap durable staff
      await bootstrapDurableStaff(pool)

      // Spawn ephemeral agent
      const spawnResult = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId: await mkDelegationId(),
      })

      // Verify both tiers exist and are separate
      const allAgents = await listAgents(pool)
      const durables = allAgents.filter((a) => a.tier === 'durable')
      const ephemerals = allAgents.filter((a) => a.tier === 'ephemeral')

      expect(durables.length).toBe(3)
      expect(ephemerals.length).toBe(1)

      // Verify no overlap in identities
      const durableIds = new Set(durables.map((a) => a.id))
      const ephemeralIds = new Set(ephemerals.map((a) => a.id))
      for (const id of ephemeralIds) {
        expect(durableIds.has(id)).toBe(false)
      }
    })

    it('capability profiles are shared correctly across tiers', async () => {
      // Bootstrap durable staff
      await bootstrapDurableStaff(pool)

      // Spawn ephemeral agent
      const spawnResult = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId: await mkDelegationId(),
      })

      // Verify profiles exist for both tiers
      const architectProfile = await getCapabilityProfileByName(pool, 'architect-default')
      const implementerProfile = await getCapabilityProfileByName(pool, 'implementer-default')

      expect(architectProfile).not.toBeNull()
      expect(implementerProfile).not.toBeNull()

      // Verify profiles are distinct (different IDs)
      expect(architectProfile!.id).not.toBe(implementerProfile!.id)

      // Verify runtime configs link to their respective profiles
      const architect = await getAgentByRole(pool, 'architect')!
      const architectConfig = await getAgentRuntimeConfig(pool, architect.id)
      expect(architectConfig!.capability_profile_id).toBe(architectProfile!.id)
    })
  })
})
