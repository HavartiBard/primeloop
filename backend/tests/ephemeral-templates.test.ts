import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import {
  spawnEphemeralAgent,
  retireEphemeralAgent,
  getEphemeralTemplate,
  listEphemeralTemplates,
} from '../src/ephemeral-templates.js'
import {
  getAgent,
  listAgents,
  listToolGrants,
  getAgentRuntimeConfig,
} from '../src/registry.js'

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://primeloop:primeloop_dev@127.0.0.1:5434/primeloop_test'

describe('ephemeral templates', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
  })

  beforeEach(async () => {
    // Clean up any existing ephemeral agents from previous tests
    await pool.query("DELETE FROM tool_grants WHERE agent_id IN (SELECT id FROM agents WHERE tier = 'ephemeral')")
    await pool.query("DELETE FROM agent_runtime_configs WHERE agent_id IN (SELECT id FROM agents WHERE tier = 'ephemeral')")
    await pool.query("DELETE FROM agents WHERE tier = 'ephemeral'")
  })

  afterAll(async () => {
    await pool.end()
  })

  describe('template definitions', () => {
    it('lists default ephemeral templates', () => {
      const templates = listEphemeralTemplates()
      expect(templates.length).toBe(2)
      const ids = templates.map((t) => t.id).sort()
      expect(ids).toEqual(['implementer', 'reviewer'])
    })

    it('returns template by ID', () => {
      const template = getEphemeralTemplate('implementer')
      expect(template).not.toBeNull()
      expect(template!.id).toBe('implementer')
      expect(template!.role).toBe('implementer')
    })

    it('returns undefined for unknown template', () => {
      const template = getEphemeralTemplate('nonexistent')
      expect(template).toBeUndefined()
    })

    it('has narrower grants than durable staff by default', () => {
      const implementer = getEphemeralTemplate('implementer')!
      // Ephemeral agents cannot delegate or request approval
      expect(implementer.denyRules.some((r) => r.primitive === 'delegate')).toBe(true)
      expect(implementer.denyRules.some((r) => r.primitive === 'request_approval')).toBe(true)
    })
  })

  describe('spawn', () => {
    it('creates ephemeral agent from template', async () => {
      const result = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId: randomUUID(),
      })

      expect(result.agent.tier).toBe('ephemeral')
      expect(result.agent.role).toBe('implementer')
      expect(result.agent.state).toBe('provisioning')
      expect(result.agent.enabled).toBe(true)
    })

    it('creates tool grant for spawned agent', async () => {
      const delegationId = randomUUID()
      const workItemId = randomUUID()
      const result = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId,
        workItemId,
      })

      expect(result.grant.agent_id).toBe(result.agent.id)
      expect(result.grant.delegation_id).toBe(delegationId)
      expect(result.grant.revocation_state).toBe('active')
    })

    it('creates runtime config with resource limits', async () => {
      const result = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId: randomUUID(),
      })

      const config = await getAgentRuntimeConfig(pool, result.agent.id)
      expect(config).not.toBeNull()
      expect(config!.limits).toBeDefined()
    })

    it('throws for unknown template', async () => {
      await expect(
        spawnEphemeralAgent(pool, 'nonexistent', { delegationId: 'del-1' }),
      ).rejects.toThrow('ephemeral template not found: nonexistent')
    })

    it('creates unique agent names to avoid collisions', async () => {
      const result1 = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId: randomUUID(),
      })
      const result2 = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId: randomUUID(),
      })

      expect(result1.agent.id).not.toBe(result2.agent.id)
      expect(result1.agent.name).not.toBe(result2.agent.name)
    })
  })

  describe('retire', () => {
    it('revokes active tool grants', async () => {
      const spawnResult = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId: randomUUID(),
      })

      await retireEphemeralAgent(pool, spawnResult.agent.id, { success: true })

      const grants = await listToolGrants(pool, { agent_id: spawnResult.agent.id })
      expect(grants[0].revocation_state).toBe('revoked')
      expect(grants[0].revoked_at).toBeDefined()
    })

    it('persists retirement event', async () => {
      const spawnResult = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId: randomUUID(),
      })

      await retireEphemeralAgent(pool, spawnResult.agent.id, { success: false, error: 'test failure' })

      const { rows } = await pool.query(
        "SELECT * FROM runtime_events WHERE event_type = 'agent.ephemeral.retired' ORDER BY created_at DESC LIMIT 1",
      )
      expect(rows.length).toBe(1)
      const payload = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload
      expect(payload.success).toBe(false)
    })

    it('keeps agent row queryable for audit', async () => {
      const spawnResult = await spawnEphemeralAgent(pool, 'implementer', {
        delegationId: randomUUID(),
      })
      const agentId = spawnResult.agent.id

      await retireEphemeralAgent(pool, agentId, { success: true })

      // Agent should still be queryable
      const agent = await getAgent(pool, agentId)
      expect(agent).not.toBeNull()
      expect(agent!.tier).toBe('ephemeral')
    })
  })
})
