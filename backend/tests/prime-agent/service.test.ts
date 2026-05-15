import { beforeEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import type { PrimeEvent } from '../../src/prime-agent/events.js'

const configMocks = vi.hoisted(() => ({
  getPrimeConfig: vi.fn(),
}))

const eventLoopMocks = vi.hoisted(() => ({
  handlePrimeEvent: vi.fn(),
}))

const coordinatorMocks = vi.hoisted(() => ({
  setPrimeCoordinatorQueue: vi.fn(),
}))

vi.mock('../../src/prime-agent/config.js', () => ({
  getPrimeConfig: configMocks.getPrimeConfig,
}))

vi.mock('../../src/prime-agent/event-loop.js', () => ({
  handlePrimeEvent: eventLoopMocks.handlePrimeEvent,
}))

vi.mock('../../src/coordinator.js', () => ({
  setPrimeCoordinatorQueue: coordinatorMocks.setPrimeCoordinatorQueue,
}))

import { createPrimeAgentService } from '../../src/prime-agent/service.js'

describe('prime-agent service', () => {
  const pool = {} as pg.Pool

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the queue with the coordinator and does not start processing when disabled', async () => {
    configMocks.getPrimeConfig.mockResolvedValue({ enabled: false })

    const queue = createTestQueue()
    const service = createPrimeAgentService(pool, { queue })
    await service.start()

    expect(coordinatorMocks.setPrimeCoordinatorQueue).toHaveBeenCalledWith(queue)
    expect(queue.process).not.toHaveBeenCalled()
  })

  it('starts processing when enabled and forwards events into the event loop', async () => {
    configMocks.getPrimeConfig.mockResolvedValue({ enabled: true })
    eventLoopMocks.handlePrimeEvent.mockResolvedValue(undefined)

    const queue = createTestQueue()
    const service = createPrimeAgentService(pool, { queue })
    await service.start()

    expect(queue.process).toHaveBeenCalledTimes(1)
    const handler = queue.process.mock.calls[0]?.[0] as (event: PrimeEvent) => Promise<void>
    await handler({
      type: 'cron.fast',
      payload: {
        triggered_at: '2026-05-09T23:30:00.000Z',
      },
    })

    expect(eventLoopMocks.handlePrimeEvent).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        type: 'cron.fast',
      }),
      expect.objectContaining({
        router: expect.any(Object),
      })
    )
  })

  it('can start later after an initial disabled boot', async () => {
    configMocks.getPrimeConfig
      .mockResolvedValueOnce({ enabled: false })
      .mockResolvedValueOnce({ enabled: true })
    eventLoopMocks.handlePrimeEvent.mockResolvedValue(undefined)

    const queue = createTestQueue()
    const service = createPrimeAgentService(pool, { queue })

    await service.start()
    expect(queue.process).not.toHaveBeenCalled()

    await service.start()
    expect(queue.process).toHaveBeenCalledTimes(1)
  })

  it('closes the underlying queue', async () => {
    configMocks.getPrimeConfig.mockResolvedValue({ enabled: false })

    const queue = createTestQueue()
    const service = createPrimeAgentService(pool, { queue })
    await service.close()

    expect(queue.close).toHaveBeenCalledTimes(1)
  })
})

function createTestQueue() {
  return {
    enqueue: vi.fn(async () => {}),
    process: vi.fn(),
    close: vi.fn(async () => {}),
  }
}
