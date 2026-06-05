import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { insertAgent, type RegistryAgent } from '../src/registry.js'
import { RuntimeLeaseManager } from '../src/runtime/lease.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('lease.reclaim (T043/T046)', () => {
  let pool: pg.Pool
  let manager: RuntimeLeaseManager

  function buildAgent(overrides: Partial<Omit<RegistryAgent, 'id' | 'created_at'>> = {}): Omit<RegistryAgent, 'id' | 'created_at'> {
    return {
      name: `Reclaim Agent ${randomUUID().slice(0, 8)}`,
      type: 'codex-thread',
      provider_id: undefined,
      tier: 'durable',
      role: 'implementation',
      state: 'idle',
      persona_file: 'AGENTS.md',
      runtime_family: 'codex-app-server',
      execution_mode: 'local',
      endpoint: 'http://127.0.0.1:4500',
      capabilities: ['implementation'],
      config: {},
      enabled: true,
      local_port: 4500,
      worktree_path: '/tmp/reclaim-agent',
      workspace_root: undefined,
      system_prompt: 'Ship working code',
      soul: 'Calm builder',
      host: undefined,
      container_name: undefined,
      ssh_user: undefined,
      ...overrides,
    }
  }

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    manager = new RuntimeLeaseManager(pool)
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM runtime_events WHERE actor IN ('runtime-lease', 'process-manager', 'agent.lifecycle.transition')`)
    await pool.query('DELETE FROM runtime_leases')
    await pool.query("DELETE FROM agents WHERE COALESCE(is_prime, false) = false")
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM runtime_events WHERE actor IN ('runtime-lease', 'process-manager', 'agent.lifecycle.transition')`)
    await pool.query('DELETE FROM runtime_leases')
    await pool.query("DELETE FROM agents WHERE COALESCE(is_prime, false) = false")
    await pool.end()
  })

  it('reclaims >10 minute idle leases and emits runtime.reclaimed', async () => {
    const agent = await insertAgent(pool, buildAgent())
    const lease = await manager.acquire(agent.id)
    await manager.release(lease.leaseId)
    await pool.query(
      `UPDATE runtime_leases
          SET last_activity_at = now() - INTERVAL '11 minutes'
        WHERE id = $1`,
      [lease.leaseId]
    )

    const reclaimed = await manager.reclaimIdle()

    expect(reclaimed).toEqual([agent.id])

    const { rows: leases } = await pool.query<{ status: string }>('SELECT status FROM runtime_leases WHERE id = $1', [lease.leaseId])
    expect(leases[0]?.status).toBe('reclaimed')

    const { rows: agents } = await pool.query<{ state: string }>('SELECT state FROM agents WHERE id = $1', [agent.id])
    expect(agents[0]?.state).toBe('idle')

    const { rows: events } = await pool.query<{ event_type: string; payload: { lease_id?: string } }>(
      `SELECT event_type, payload
         FROM runtime_events
        WHERE event_type = 'runtime.reclaimed'
          AND payload->>'agent_id' = $1
        ORDER BY created_at DESC`,
      [agent.id]
    )
    expect(events[0]?.event_type).toBe('runtime.reclaimed')
    expect(events[0]?.payload?.lease_id).toBe(lease.leaseId)
  })
})
