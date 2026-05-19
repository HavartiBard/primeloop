import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { PostgresCheckpointStore } from '../src/checkpoint-store.js'
import { createPool, runMigrations } from '../src/db.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('PostgresCheckpointStore', () => {
  let pool: pg.Pool
  let store: PostgresCheckpointStore

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    store = new PostgresCheckpointStore(pool)
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM checkpoint_continuations')
    await pool.query('DELETE FROM prime_queue_items')
  })

  afterAll(async () => {
    await pool.query('DELETE FROM checkpoint_continuations')
    await pool.query('DELETE FROM prime_queue_items')
    await pool.end()
  })

  it('supports enqueue, claim, complete, and fail queue item lifecycle', async () => {
    const queuedId = await store.enqueueItem({
      type: 'prime.message',
      payload: {
        thread_id: 'thread-1',
        message_id: 'message-1',
        content: 'Ship checkpoint queue',
        sender: 'james',
      },
    })

    const claimed = await store.claimNextItem()

    expect(claimed).toEqual({
      id: queuedId,
      event: {
        type: 'prime.message',
        payload: {
          thread_id: 'thread-1',
          message_id: 'message-1',
          content: 'Ship checkpoint queue',
          sender: 'james',
        },
      },
    })

    await store.completeItem(queuedId)

    let rows = await pool.query(
      `SELECT status, attempt, error
       FROM prime_queue_items
       WHERE id = $1`,
      [queuedId]
    )
    expect(rows.rows[0]).toMatchObject({
      status: 'done',
      attempt: 1,
      error: null,
    })

    const failedId = await store.enqueueItem({
      type: 'fleet.delegation.failed',
      payload: {
        delegation_id: 'delegation-1',
        error: 'timeout',
      },
    })
    await store.claimNextItem()
    await store.failItem(failedId, 'timeout')

    rows = await pool.query(
      `SELECT status, attempt, error
       FROM prime_queue_items
       WHERE id = $1`,
      [failedId]
    )
    expect(rows.rows[0]).toMatchObject({
      status: 'failed',
      attempt: 1,
      error: 'timeout',
    })
  })

  it('recoverStaleItems resets processing rows to pending', async () => {
    const queueId = await store.enqueueItem({
      type: 'cron.fast',
      payload: {
        triggered_at: '2026-05-11T00:00:00.000Z',
        source: 'test',
      },
    })

    await store.claimNextItem()

    const recovered = await store.recoverStaleItems()

    expect(recovered).toBe(1)

    const { rows } = await pool.query(
      `SELECT status
       FROM prime_queue_items
       WHERE id = $1`,
      [queueId]
    )
    expect(rows[0].status).toBe('pending')
  })

  it('supports continuation save, load, resumed, and discarded lifecycle', async () => {
    const saved = await store.saveContinuation({
      owner_type: 'prime_session',
      owner_id: '11111111-1111-1111-1111-111111111111',
      step: 'awaiting_approval',
      context_snapshot: {
        active_work_item_count: 2,
        pending_delegation_ids: ['delegation-1'],
        last_event_id: 'event-1',
      },
      continuation: {
        decision: {
          reasoning: 'wait for approval',
        },
      },
    })

    const loaded = await store.loadContinuation('11111111-1111-1111-1111-111111111111')

    expect(loaded).toMatchObject({
      id: saved.id,
      owner_type: 'prime_session',
      owner_id: '11111111-1111-1111-1111-111111111111',
      step: 'awaiting_approval',
      status: 'pending',
    })

    await store.markResumed(saved.id)

    let rows = await pool.query(
      `SELECT status, resumed_at IS NOT NULL AS resumed
       FROM checkpoint_continuations
       WHERE id = $1`,
      [saved.id]
    )
    expect(rows.rows[0]).toEqual({
      status: 'resumed',
      resumed: true,
    })

    const second = await store.saveContinuation({
      owner_type: 'delegation',
      owner_id: '22222222-2222-2222-2222-222222222222',
      step: 'dispatch_partial',
      context_snapshot: {
        active_work_item_count: 1,
        pending_delegation_ids: [],
        last_event_id: 'event-2',
      },
      continuation: {
        state: 'partial',
      },
    })

    await store.discardContinuation(second.id)

    rows = await pool.query(
      `SELECT status
       FROM checkpoint_continuations
       WHERE id = $1`,
      [second.id]
    )
    expect(rows.rows[0].status).toBe('discarded')
  })

  it('contextChanged returns false on the same hash and true on changed pending delegation ids', async () => {
    const saved = await store.saveContinuation({
      owner_type: 'prime_session',
      owner_id: '33333333-3333-3333-3333-333333333333',
      step: 'awaiting_approval',
      context_snapshot: {
        active_work_item_count: 3,
        pending_delegation_ids: ['delegation-1'],
        last_event_id: 'event-3',
      },
      continuation: {
        decision: {
          reasoning: 'hold',
        },
      },
    })

    expect(
      store.contextChanged(saved, {
        active_work_item_count: 3,
        pending_delegation_ids: ['delegation-1'],
        last_event_id: 'event-3',
      })
    ).toBe(false)

    expect(
      store.contextChanged(saved, {
        active_work_item_count: 3,
        pending_delegation_ids: ['delegation-2'],
        last_event_id: 'event-3',
      })
    ).toBe(true)
  })
})
