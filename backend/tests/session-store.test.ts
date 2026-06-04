import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { SessionStore } from '../src/session/store.js'
import { createPool, runMigrations } from '../src/db.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('SessionStore (session substrate — T011)', () => {
  let pool: pg.Pool
  let store: SessionStore

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    store = new SessionStore(pool)
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM runtime_events')
  })

  afterAll(async () => {
    await pool.query('DELETE FROM runtime_events')
    await pool.end()
  })

  async function appendN(sessionId: string, n: number) {
    for (let i = 0; i < n; i++) {
      await store.appendEvent(sessionId, {
        session_id: sessionId,
        event_type: `evt.${i}`,
        actor: 'tester',
        payload: { i },
      })
    }
  }

  it('assigns a monotonic per-session seq starting at 1', async () => {
    const session = randomUUID()
    const a = await store.appendEvent(session, { session_id: session, event_type: 'a', actor: 't', payload: {} })
    const b = await store.appendEvent(session, { session_id: session, event_type: 'b', actor: 't', payload: {} })
    const c = await store.appendEvent(session, { session_id: session, event_type: 'c', actor: 't', payload: {} })
    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3])
  })

  it('keeps seq independent per session', async () => {
    const s1 = randomUUID()
    const s2 = randomUUID()
    await appendN(s1, 2)
    const e = await store.appendEvent(s2, { session_id: s2, event_type: 'x', actor: 't', payload: {} })
    expect(e.seq).toBe(1)
  })

  it('getEvents returns the full timeline ordered by seq ascending', async () => {
    const session = randomUUID()
    await appendN(session, 4)
    const events = await store.getEvents(session)
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4])
    expect(events.map((e) => e.event_type)).toEqual(['evt.0', 'evt.1', 'evt.2', 'evt.3'])
  })

  it('getEvents({ last }) returns a bounded, seq-ordered suffix', async () => {
    const session = randomUUID()
    await appendN(session, 5)
    const events = await store.getEvents(session, { last: 2 })
    expect(events.map((e) => e.seq)).toEqual([4, 5])
  })

  it('getEvents({ from, to }) returns only the inclusive range', async () => {
    const session = randomUUID()
    await appendN(session, 5)
    const events = await store.getEvents(session, { from: 2, to: 4 })
    expect(events.map((e) => e.seq)).toEqual([2, 3, 4])
  })

  it('getSession reports first and last seq', async () => {
    const session = randomUUID()
    await appendN(session, 3)
    const header = await store.getSession(session)
    expect(header?.first_seq).toBe(1)
    expect(header?.last_seq).toBe(3)
  })

  it('returns null for an unknown session', async () => {
    expect(await store.getSession(randomUUID())).toBeNull()
  })

  it('assigns distinct sequential seqs under concurrent appends to one session', async () => {
    const session = randomUUID()
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.appendEvent(session, { session_id: session, event_type: `c.${i}`, actor: 't', payload: { i } })
      )
    )
    const events = await store.getEvents(session)
    expect(events.map((e) => e.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})
