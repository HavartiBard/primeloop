import { describe, it, expect, vi, beforeEach } from 'vitest'
import type pg from 'pg'

const appendThreadMessageMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/runtime.js', () => ({
  appendThreadMessage: appendThreadMessageMock,
}))

import { routeResult } from '../../src/fleet-executor/result-router.js'
import { createInMemoryPrimeQueue } from '../../src/prime-agent/queue.js'
import type { Delegation } from '../../src/runtime.js'
import type { TaskResult } from '../../src/fleet-executor/harness.js'

const pool = {
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
} as unknown as pg.Pool

const delegation: Delegation = {
  id: 'del-1',
  work_item_id: 'wi-1',
  to_agent_id: 'agent-1',
  status: 'in_progress',
  capability: 'code',
  request: { thread_id: 'thread-1', title: 'do the thing' },
  result: {},
  trace: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const taskResult: TaskResult = {
  text: 'done',
  tokens: 100,
  changed_files: ['src/foo.ts'],
}

describe('routeResult', () => {
  let primeQueue: ReturnType<typeof createInMemoryPrimeQueue>

  beforeEach(() => {
    vi.clearAllMocks()
    primeQueue = createInMemoryPrimeQueue()
  })

  it('updates delegation to completed on success', async () => {
    await routeResult({ pool, primeQueue }, delegation, { success: true, result: taskResult })
    const call = (pool.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('completed'),
    )
    expect(call).toBeDefined()
  })

  it('enqueues fleet.delegation.completed into prime queue on success', async () => {
    const enqueueSpy = vi.spyOn(primeQueue, 'enqueue')
    await routeResult({ pool, primeQueue }, delegation, { success: true, result: taskResult })
    expect(enqueueSpy).toHaveBeenCalledOnce()
    expect(enqueueSpy.mock.calls[0][0]).toMatchObject({
      type: 'fleet.delegation.completed',
      payload: expect.objectContaining({ delegation_id: 'del-1' }),
    })
  })

  it('posts completion summary to the thread', async () => {
    await routeResult({ pool, primeQueue }, delegation, { success: true, result: taskResult })
    expect(appendThreadMessageMock).toHaveBeenCalledWith(
      pool,
      'thread-1',
      expect.objectContaining({ role: 'assistant' }),
    )
  })

  it('updates delegation to failed on failure', async () => {
    await routeResult({ pool, primeQueue }, delegation, { success: false, error: 'scope violation: src/secret.ts' })
    const call = (pool.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('failed'),
    )
    expect(call).toBeDefined()
  })

  it('enqueues fleet.delegation.failed on failure', async () => {
    const enqueueSpy = vi.spyOn(primeQueue, 'enqueue')
    await routeResult({ pool, primeQueue }, delegation, { success: false, error: 'timed out' })
    expect(enqueueSpy.mock.calls[0][0]).toMatchObject({ type: 'fleet.delegation.failed' })
  })

  it('does not throw if thread_id is absent', async () => {
    const noThread = { ...delegation, request: { title: 'no thread' } }
    await expect(
      routeResult({ pool, primeQueue }, noThread, { success: true, result: taskResult }),
    ).resolves.toBeUndefined()
    expect(appendThreadMessageMock).not.toHaveBeenCalled()
  })
})
