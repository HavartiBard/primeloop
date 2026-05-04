import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('db schema', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
  })

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS agent_heartbeat, approvals, event_log')
    await pool.end()
  })

  it('creates event_log table', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'event_log' ORDER BY column_name`
    )
    const cols = res.rows.map((r: { column_name: string }) => r.column_name)
    expect(cols).toEqual(expect.arrayContaining(['agent', 'created_at', 'id', 'payload', 'type']))
  })

  it('creates approvals table', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'approvals' ORDER BY column_name`
    )
    const cols = res.rows.map((r: { column_name: string }) => r.column_name)
    expect(cols).toEqual(
      expect.arrayContaining(['action', 'approval_id', 'created_at', 'decided_at', 'run_id', 'status'])
    )
  })

  it('creates agent_heartbeat table', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'agent_heartbeat' ORDER BY column_name`
    )
    const cols = res.rows.map((r: { column_name: string }) => r.column_name)
    expect(cols).toEqual(expect.arrayContaining(['agent', 'healthy', 'last_seen']))
  })
})
