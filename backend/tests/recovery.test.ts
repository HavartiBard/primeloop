import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { insertAgent } from '../src/registry.js'
import { recoverInflight } from '../src/recovery/restart.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('recoverInflight (US1 — restart recovery)', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM runtime_events')
    await pool.query('DELETE FROM delegations')
    await pool.query(`DELETE FROM agents WHERE name LIKE 'rec-%'`)
  })

  afterAll(async () => {
    await pool.end()
  })

  async function makeAgent(tier: 'durable' | 'ephemeral'): Promise<string> {
    const agent = await insertAgent(pool, {
      name: `rec-${randomUUID().slice(0, 8)}`,
      type: 'worker',
      runtime_family: 'acp',
      execution_mode: 'local',
      tier,
      capabilities: [],
    } as any)
    return agent.id
  }

  async function makeInflightDelegation(agentId: string | null): Promise<string> {
    const { rows } = await pool.query(
      `INSERT INTO delegations (to_agent_id, status, capability, request)
       VALUES ($1, 'in_progress', 'test', '{}') RETURNING id`,
      [agentId]
    )
    return rows[0].id
  }

  async function eventsFor(delegationId: string): Promise<string[]> {
    const { rows } = await pool.query(
      `SELECT event_type FROM runtime_events WHERE delegation_id = $1 ORDER BY seq`,
      [delegationId]
    )
    return rows.map((r) => r.event_type as string)
  }

  it('resumes a durable in-flight delegation in place (re-queued, emits session.resumed)', async () => {
    const agent = await makeAgent('durable')
    const d = await makeInflightDelegation(agent)

    const report = await recoverInflight(pool)

    expect(report.resumed).toContain(d)
    const { rows } = await pool.query(`SELECT status, recovery_epoch FROM delegations WHERE id = $1`, [d])
    expect(rows[0].status).toBe('queued')
    expect(rows[0].recovery_epoch).toBe(1)
    expect(await eventsFor(d)).toContain('session.resumed')
  })

  it('re-dispatches an ephemeral in-flight delegation (emits delegation.recovered)', async () => {
    const agent = await makeAgent('ephemeral')
    const d = await makeInflightDelegation(agent)

    const report = await recoverInflight(pool)

    expect(report.redispatched).toContain(d)
    const { rows } = await pool.query(`SELECT status FROM delegations WHERE id = $1`, [d])
    expect(rows[0].status).toBe('queued')
    expect(await eventsFor(d)).toContain('delegation.recovered')
  })

  it('is idempotent — a second pass processes nothing and emits no new events', async () => {
    const agent = await makeAgent('durable')
    const d = await makeInflightDelegation(agent)

    await recoverInflight(pool)
    const before = (await eventsFor(d)).length

    const report2 = await recoverInflight(pool)

    expect(report2.resumed).toHaveLength(0)
    expect(report2.redispatched).toHaveLength(0)
    expect((await eventsFor(d)).length).toBe(before)
    const { rows } = await pool.query(`SELECT recovery_epoch FROM delegations WHERE id = $1`, [d])
    expect(rows[0].recovery_epoch).toBe(1)
  })

  it('fails a delegation that has exhausted recovery attempts (emits recovered_failed, never silently lost)', async () => {
    const agent = await makeAgent('durable')
    const d = await makeInflightDelegation(agent)
    await pool.query(`UPDATE delegations SET recovery_epoch = 3 WHERE id = $1`, [d])

    const report = await recoverInflight(pool)

    expect(report.recoveredFailed).toContain(d)
    const { rows } = await pool.query(`SELECT status FROM delegations WHERE id = $1`, [d])
    expect(rows[0].status).toBe('failed')
    expect(await eventsFor(d)).toContain('delegation.recovered_failed')
  })

  it('treats a delegation with no agent as ephemeral re-dispatch', async () => {
    const d = await makeInflightDelegation(null)
    const report = await recoverInflight(pool)
    expect(report.redispatched).toContain(d)
  })
})
