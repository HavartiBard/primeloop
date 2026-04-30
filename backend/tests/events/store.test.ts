import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../../src/db.js'
import { insertEvent, listEvents } from '../../src/events/store.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('event store', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
  })

  beforeEach(async () => {
    await pool.query('TRUNCATE event_log')
  })

  afterAll(async () => {
    await pool.end()
  })

  it('inserts an event and returns it with id and timestamp', async () => {
    const event = await insertEvent(pool, {
      agent: 'langgraph',
      type: 'run.started',
      payload: { run_id: 'abc' },
    })
    expect(event.id).toBeTruthy()
    expect(event.agent).toBe('langgraph')
    expect(event.type).toBe('run.started')
    expect(event.payload).toEqual({ run_id: 'abc' })
    expect(event.created_at).toBeTruthy()
  })

  it('listEvents returns newest first', async () => {
    await insertEvent(pool, { agent: 'langgraph', type: 'run.started', payload: { n: 1 } })
    await insertEvent(pool, { agent: 'raclette', type: 'session.active', payload: { n: 2 } })

    const events = await listEvents(pool, {})
    expect(events[0].payload).toEqual({ n: 2 })
    expect(events[1].payload).toEqual({ n: 1 })
  })

  it('listEvents filters by agent', async () => {
    await insertEvent(pool, { agent: 'langgraph', type: 'run.started', payload: {} })
    await insertEvent(pool, { agent: 'raclette', type: 'session.active', payload: {} })

    const events = await listEvents(pool, { agent: 'raclette' })
    expect(events).toHaveLength(1)
    expect(events[0].agent).toBe('raclette')
  })

  it('listEvents respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await insertEvent(pool, { agent: 'langgraph', type: 'run.started', payload: { i } })
    }
    const events = await listEvents(pool, { limit: 3 })
    expect(events).toHaveLength(3)
  })
})
