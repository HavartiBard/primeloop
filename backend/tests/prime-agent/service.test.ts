import { beforeEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import type { PrimeEvent } from '../../src/prime-agent/events.js'

const configMocks = vi.hoisted(() => ({
  getPrimeConfig: vi.fn(),
  updatePrimeConfig: vi.fn(),
}))

const eventLoopMocks = vi.hoisted(() => ({
  handlePrimeEvent: vi.fn(),
}))

const coordinatorMocks = vi.hoisted(() => ({
  setPrimeCoordinatorQueue: vi.fn(),
  setPrimeCoordinatorProcessor: vi.fn(),
}))

vi.mock('../../src/prime-agent/config.js', () => ({
  getPrimeConfig: configMocks.getPrimeConfig,
  updatePrimeConfig: configMocks.updatePrimeConfig,
}))

vi.mock('../../src/prime-agent/event-loop.js', () => ({
  handlePrimeEvent: eventLoopMocks.handlePrimeEvent,
}))

vi.mock('../../src/coordinator.js', () => ({
  setPrimeCoordinatorQueue: coordinatorMocks.setPrimeCoordinatorQueue,
  setPrimeCoordinatorProcessor: coordinatorMocks.setPrimeCoordinatorProcessor,
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

  it('rethrows queue processing errors so the queue can mark the item failed', async () => {
    configMocks.getPrimeConfig.mockResolvedValue({ enabled: true })
    eventLoopMocks.handlePrimeEvent.mockRejectedValue(new Error('loop failed'))

    const queue = createTestQueue()
    const service = createPrimeAgentService(pool, { queue })
    await service.start()

    const handler = queue.process.mock.calls[0]?.[0] as (event: PrimeEvent) => Promise<void>
    await expect(handler({
      type: 'cron.fast',
      payload: {
        triggered_at: '2026-05-09T23:30:00.000Z',
      },
    })).rejects.toThrow('loop failed')
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

  it('enqueues cron.fast events at the configured fast interval', async () => {
    vi.useFakeTimers()
    configMocks.getPrimeConfig.mockResolvedValue({
      enabled: true,
      cron_fast_interval_seconds: 1,
      cron_slow_interval_seconds: 3600,
    })
    eventLoopMocks.handlePrimeEvent.mockResolvedValue(undefined)

    const { createInMemoryPrimeQueue } = await import('../../src/prime-agent/queue.js')
    const queue = createInMemoryPrimeQueue()
    const enqueueSpy = vi.spyOn(queue, 'enqueue')

    const service = createPrimeAgentService(pool, { queue })
    await service.start()

    await vi.advanceTimersByTimeAsync(2500)

    expect(enqueueSpy).toHaveBeenCalledTimes(2)
    expect(enqueueSpy.mock.calls[0]![0]).toMatchObject({ type: 'cron.fast' })

    await service.close()
    vi.useRealTimers()
  })

  it('does not enqueue cron events after close()', async () => {
    vi.useFakeTimers()
    configMocks.getPrimeConfig.mockResolvedValue({
      enabled: true,
      cron_fast_interval_seconds: 1,
      cron_slow_interval_seconds: 3600,
    })
    eventLoopMocks.handlePrimeEvent.mockResolvedValue(undefined)

    const { createInMemoryPrimeQueue } = await import('../../src/prime-agent/queue.js')
    const queue = createInMemoryPrimeQueue()
    const enqueueSpy = vi.spyOn(queue, 'enqueue')

    const service = createPrimeAgentService(pool, { queue })
    await service.start()
    await service.close()

    await vi.advanceTimersByTimeAsync(3000)
    expect(enqueueSpy).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

function createTestQueue() {
  return {
    enqueue: vi.fn(async () => {}),
    process: vi.fn(),
    close: vi.fn(async () => {}),
  }
}
