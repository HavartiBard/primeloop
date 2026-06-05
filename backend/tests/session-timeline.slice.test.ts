import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { SessionStore } from '../src/session/store.js'
import { createPool, runMigrations } from '../src/db.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('session timeline slices (T049)', () => {
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

  it('returns last N in ascending order and pushes LIMIT into SQL', async () => {
    const sessionId = randomUUID()
    await appendN(sessionId, 8)

    const spy = vi.spyOn(pool, 'query')
    const events = await store.getEvents(sessionId, { last: 3 })

    expect(events.map((event) => event.seq)).toEqual([6, 7, 8])
    const sql = spy.mock.calls.at(-1)?.[0]
    expect(String(sql)).toContain('ORDER BY seq DESC LIMIT')
    spy.mockRestore()
  })

  it('returns an inclusive seq range and pushes seq predicates into SQL', async () => {
    const sessionId = randomUUID()
    await appendN(sessionId, 8)

    const spy = vi.spyOn(pool, 'query')
    const events = await store.getEvents(sessionId, { from: 3, to: 5 })

    expect(events.map((event) => event.seq)).toEqual([3, 4, 5])
    const sql = spy.mock.calls.at(-1)?.[0]
    expect(String(sql)).toContain('WHERE seq >=')
    expect(String(sql)).toContain('AND seq <=')
    spy.mockRestore()
  })
})
