import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { insertAgent, type RegistryAgent } from '../src/registry.js'
import { RuntimeLeaseManager } from '../src/runtime/lease.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('RuntimeLeaseManager (T044/T047)', () => {
  let pool: pg.Pool
  let manager: RuntimeLeaseManager

  function buildAgent(overrides: Partial<Omit<RegistryAgent, 'id' | 'created_at'>> = {}): Omit<RegistryAgent, 'id' | 'created_at'> {
    return {
      name: `Lease Agent ${randomUUID().slice(0, 8)}`,
      type: 'codex-thread',
      provider_id: undefined,
      tier: 'durable',
      role: 'implementation',
      state: 'idle',
      persona_file: 'AGENTS.md',
      runtime_family: 'codex-app-server',
      execution_mode: 'local',
      endpoint: 'http://127.0.0.1:4400',
      capabilities: ['implementation'],
      config: {},
      enabled: true,
      local_port: 4400,
      worktree_path: '/tmp/runtime-lease-agent',
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
    await pool.query(`DELETE FROM runtime_events WHERE actor = 'runtime-lease'`)
    await pool.query('DELETE FROM runtime_leases')
    await pool.query("DELETE FROM agents WHERE COALESCE(is_prime, false) = false")
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM runtime_events WHERE actor = 'runtime-lease'`)
    await pool.query('DELETE FROM runtime_leases')
    await pool.query("DELETE FROM agents WHERE COALESCE(is_prime, false) = false")
    await pool.end()
  })

  it('acquires a lease, maps the agent to busy, and emits runtime.leased', async () => {
    const agent = await insertAgent(pool, buildAgent())

    const result = await manager.acquire(agent.id)

    expect(result.leaseId).toBeTruthy()
    expect(result.lease.status).toBe('active')

    const { rows: agents } = await pool.query<{ state: string }>('SELECT state FROM agents WHERE id = $1', [agent.id])
    expect(agents[0]?.state).toBe('busy')

    const { rows: leases } = await pool.query<{ status: string }>('SELECT status FROM runtime_leases WHERE id = $1', [result.leaseId])
    expect(leases[0]?.status).toBe('active')

    const { rows: events } = await pool.query<{ event_type: string; payload: { lease_id?: string } }>(
      `SELECT event_type, payload
         FROM runtime_events
        WHERE event_type = 'runtime.leased'
          AND payload->>'agent_id' = $1
        ORDER BY created_at DESC`,
      [agent.id]
    )
    expect(events[0]?.event_type).toBe('runtime.leased')
    expect(events[0]?.payload?.lease_id).toBe(result.leaseId)
  })

  it('reuses the latest reclaimed lease record when re-acquired', async () => {
    const agent = await insertAgent(pool, buildAgent())
    const first = await manager.acquire(agent.id)
    await manager.release(first.leaseId)
    await pool.query(
      `UPDATE runtime_leases
          SET status = 'reclaimed',
              last_activity_at = now() - INTERVAL '11 minutes'
        WHERE id = $1`,
      [first.leaseId]
    )

    const second = await manager.acquire(agent.id)

    expect(second.leaseId).toBe(first.leaseId)
    expect(second.lease.status).toBe('active')
  })
})
