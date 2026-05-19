import { describe, expect, it } from 'vitest'
import type { PrimeEvent } from '../../src/prime-agent/events.js'
import { createInMemoryPrimeQueue } from '../../src/prime-agent/queue.js'

describe('prime-agent queue', () => {
  it('preserves event payloads until a processor is registered', async () => {
    const queue = createInMemoryPrimeQueue()
    const received: PrimeEvent[] = []

    await queue.enqueue({
      type: 'prime.message',
      payload: {
        thread_id: 'thread-1',
        message_id: 'message-1',
        content: 'Ship the queue abstraction',
        sender: 'james',
      },
    })

    queue.process(async (event) => {
      received.push(event)
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(received).toEqual([
      {
        type: 'prime.message',
        payload: {
          thread_id: 'thread-1',
          message_id: 'message-1',
          content: 'Ship the queue abstraction',
          sender: 'james',
        },
      },
    ])
  })

  it('delivers enqueued events to the processor in order', async () => {
    const queue = createInMemoryPrimeQueue()
    const received: PrimeEvent[] = []

    queue.process(async (event) => {
      received.push(event)
    })

    await queue.enqueue({
      type: 'cron.fast',
      payload: {
        triggered_at: '2026-05-09T22:00:00.000Z',
        source: 'test',
      },
    })
    await queue.enqueue({
      type: 'fleet.delegation.failed',
      payload: {
        delegation_id: 'delegation-1',
        work_item_id: 'work-1',
        error: 'timeout',
      },
    })

    expect(received).toEqual([
      {
        type: 'cron.fast',
        payload: {
          triggered_at: '2026-05-09T22:00:00.000Z',
          source: 'test',
        },
      },
      {
        type: 'fleet.delegation.failed',
        payload: {
          delegation_id: 'delegation-1',
          work_item_id: 'work-1',
          error: 'timeout',
        },
      },
    ])
  })

  it('rejects enqueue after close', async () => {
    const queue = createInMemoryPrimeQueue()
    await queue.close()

    await expect(
      queue.enqueue({
        type: 'fleet.delegation.completed',
        payload: {
          delegation_id: 'delegation-2',
          agent_id: 'agent-1',
          result: { outcome: 'ok' },
        },
      })
    ).rejects.toThrow('Prime queue is closed')
  })
})
