import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../../src/db.js'
import {
  completePrimeSession,
  failPrimeSession,
  getPrimeSession,
  listPrimeSessions,
  savePrimeSessionModuleRuns,
  startPrimeSession,
} from '../../src/prime-agent/session.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('prime-agent session service', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM prime_agent_module_runs')
    await pool.query('DELETE FROM prime_agent_sessions')
    await pool.query('DELETE FROM prime_agent_config')
    await runMigrations(pool)
  })

  afterAll(async () => {
    await pool.query('DELETE FROM prime_agent_module_runs')
    await pool.query('DELETE FROM prime_agent_sessions')
    await pool.query('DELETE FROM prime_agent_config')
    await pool.end()
  })

  it('starts a running session with defaults', async () => {
    const session = await startPrimeSession(pool, {
      trigger_type: 'prime_message',
      trigger_payload: { thread_id: 'thread-1', content: 'Ship A2' },
    })

    expect(session.id).toBeTruthy()
    expect(session.trigger_type).toBe('prime_message')
    expect(session.trigger_payload).toEqual({ thread_id: 'thread-1', content: 'Ship A2' })
    expect(session.status).toBe('running')
    expect(session.actions_taken).toEqual([])
    expect(session.token_count).toBe(0)
    expect(session.started_at).toBeTruthy()
  })

  it('completes a session with summary, actions, and provider info', async () => {
    const session = await startPrimeSession(pool, {
      trigger_type: 'event',
      trigger_payload: { event_type: 'fleet.delegation.completed' },
      module_name: 'reflection',
    })

    const completed = await completePrimeSession(pool, session.id, {
      reasoning_summary: 'Delegation succeeded and no further action is needed.',
      actions_taken: [{ type: 'no_op' }],
      token_count: 321,
      provider_used: 'provider-1',
      model_used: 'gpt-test',
    })

    expect(completed?.status).toBe('completed')
    expect(completed?.reasoning_summary).toBe('Delegation succeeded and no further action is needed.')
    expect(completed?.actions_taken).toEqual([{ type: 'no_op' }])
    expect(completed?.token_count).toBe(321)
    expect(completed?.provider_used).toBe('provider-1')
    expect(completed?.model_used).toBe('gpt-test')
    expect(completed?.completed_at).toBeTruthy()
  })

  it('fails a session and records the error', async () => {
    const session = await startPrimeSession(pool, {
      trigger_type: 'cron_fast',
      trigger_payload: { source: 'scheduler' },
    })

    const failed = await failPrimeSession(pool, session.id, 'provider timeout')

    expect(failed?.status).toBe('failed')
    expect(failed?.error).toBe('provider timeout')
    expect(failed?.completed_at).toBeTruthy()
  })

  it('lists sessions newest first and respects limit', async () => {
    const first = await startPrimeSession(pool, {
      trigger_type: 'event',
      trigger_payload: { sequence: 1 },
    })
    await completePrimeSession(pool, first.id, { reasoning_summary: 'first complete' })

    const second = await startPrimeSession(pool, {
      trigger_type: 'event',
      trigger_payload: { sequence: 2 },
    })
    await failPrimeSession(pool, second.id, 'second failed')

    const sessions = await listPrimeSessions(pool, 1)

    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(second.id)
  })

  it('persists and hydrates module runs for session detail and list views', async () => {
    const session = await startPrimeSession(pool, {
      trigger_type: 'prime_message',
      trigger_payload: { thread_id: 'thread-1' },
    })

    await savePrimeSessionModuleRuns(pool, session.id, [
      {
        id: 'trigger.default',
        stage: 'trigger',
        version: '1.0.0',
        mode: 'active',
        status: 'completed',
        detail: 'accepted incoming event',
        started_at: '2026-05-18T00:00:00.000Z',
        completed_at: '2026-05-18T00:00:01.000Z',
      },
      {
        id: 'feedback.default',
        stage: 'feedback',
        version: '1.0.0',
        mode: 'shadow',
        status: 'completed',
        detail: 'recorded action results',
        started_at: '2026-05-18T00:00:02.000Z',
        completed_at: '2026-05-18T00:00:03.000Z',
      },
    ])

    const detailed = await getPrimeSession(pool, session.id)
    const listed = await listPrimeSessions(pool, 10)

    expect(detailed?.module_runs).toHaveLength(2)
    expect(detailed?.module_runs?.[0]).toMatchObject({
      session_id: session.id,
      run_index: 0,
      module_id: 'trigger.default',
      stage: 'trigger',
      version: '1.0.0',
      mode: 'active',
      status: 'completed',
      detail: 'accepted incoming event',
    })
    expect(listed.find((entry) => entry.id === session.id)?.module_runs).toHaveLength(2)
  })
})
