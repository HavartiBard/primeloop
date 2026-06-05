import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { SessionStore } from '../src/session/store.js'
import { createPool, runMigrations } from '../src/db.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('session timeline merge (T048)', () => {
  let pool: pg.Pool
  let store: SessionStore

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    store = new SessionStore(pool)
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM checkpoint_continuations')
    await pool.query('DELETE FROM runtime_events')
    await pool.query('DELETE FROM delegations')
    await pool.query('DELETE FROM thread_messages')
    await pool.query('DELETE FROM threads')
  })

  afterAll(async () => {
    await pool.query('DELETE FROM checkpoint_continuations')
    await pool.query('DELETE FROM runtime_events')
    await pool.query('DELETE FROM delegations')
    await pool.query('DELETE FROM thread_messages')
    await pool.query('DELETE FROM threads')
    await pool.end()
  })

  it('merges runtime events, messages, traces, and checkpoints into one ordered timeline', async () => {
    const threadId = randomUUID()
    const delegationId = randomUUID()

    await pool.query(`INSERT INTO threads (id, title) VALUES ($1, 'timeline thread')`, [threadId])
    await pool.query(
      `INSERT INTO thread_messages (thread_id, role, sender, content, created_at)
       VALUES ($1, 'user', 'james', 'hello', now())`,
      [threadId]
    )

    await store.appendEvent(threadId, {
      session_id: threadId,
      event_type: 'runtime.started',
      actor: 'system',
      payload: { ok: true },
    })

    await pool.query(
      `INSERT INTO delegations (id, capability, status, trace, created_at, updated_at)
       VALUES ($1, 'implementation', 'queued', $2::jsonb, now(), now())`,
      [
        delegationId,
        JSON.stringify([{ step: 'queued', at: new Date().toISOString(), detail: { note: 'queued' } }]),
      ]
    )
    await pool.query(
      `INSERT INTO checkpoint_continuations (owner_type, owner_id, step, context_hash, context_snapshot, continuation, status, created_at)
       VALUES ('delegation', $1, 'resume', 'hash-1', '{}'::jsonb, '{}'::jsonb, 'pending', now())`,
      [delegationId]
    )

    const threadTimeline = await store.getEvents(threadId)
    expect(threadTimeline.map((event) => event.event_type)).toEqual(['runtime.started', 'thread.message'])
    expect(threadTimeline.map((event) => event.seq)).toEqual([1, 2])

    const delegationTimeline = await store.getEvents(delegationId)
    expect(delegationTimeline.map((event) => event.event_type)).toEqual([
      'delegation.trace',
      'checkpoint.continuation',
    ])
    expect(delegationTimeline.map((event) => event.seq)).toEqual([1, 2])
  })
})
