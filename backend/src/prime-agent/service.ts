import type pg from 'pg'
import type { AgentHarness } from '../fleet-executor/harness.js'
import { setPrimeCoordinatorProcessor, setPrimeCoordinatorQueue } from '../coordinator.js'
import { getPrimeConfig, updatePrimeConfig } from './config.js'
import { handlePrimeEvent } from './event-loop.js'
import { createConfiguredLlmRouter, type LlmRouter } from './llm-router.js'
import { createInMemoryPrimeQueue, createPostgresPrimeQueue, type PrimeQueue } from './queue.js'

export interface PrimeAgentService {
  queue: PrimeQueue
  start(): Promise<void>
  close(): Promise<void>
}

export interface PrimeAgentServiceOptions {
  queue?: PrimeQueue
  router?: LlmRouter
  checkpointStore?: import('../checkpoint.js').CheckpointStore
  publishEvent?: (type: string, payload: Record<string, unknown>) => Promise<void>
  getHarness?: (agentId: string) => AgentHarness | undefined
}

export function createPrimeAgentService(
  pool: pg.Pool,
  options: PrimeAgentServiceOptions = {}
): PrimeAgentService {
  let queue: PrimeQueue
  if (options.checkpointStore) {
    queue = createPostgresPrimeQueue(options.checkpointStore)
  } else {
    queue = options.queue ?? createInMemoryPrimeQueue()
  }

  const router: LlmRouter = options.router ?? createConfiguredLlmRouter(pool)

  let started = false
  let fastTimer: ReturnType<typeof setInterval> | undefined
  let slowTimer: ReturnType<typeof setInterval> | undefined
  setPrimeCoordinatorQueue(queue)

  return {
    queue,
    async start(): Promise<void> {
      if (started) return

      const config = await getPrimeConfig(pool)
      if (!config.enabled) {
        await updatePrimeConfig(pool, {
          status: 'stopped',
          last_error: null,
        })
        return
      }

      started = true
      await updatePrimeConfig(pool, {
        status: 'running',
        last_started_at: new Date().toISOString(),
        last_error: null,
      })

      const processEvent = async (event: Parameters<typeof handlePrimeEvent>[1]) => {
        try {
          await handlePrimeEvent(pool, event, {
            router,
            publishEvent: options.publishEvent,
            getHarness: options.getHarness ?? (() => undefined),
          })
        } catch (error) {
          await updatePrimeConfig(pool, {
            status: 'running',
            last_error: error instanceof Error ? error.message : String(error),
          })
          throw error
        }
      }

      const processCoordinatorEvent = async (event: Parameters<typeof handlePrimeEvent>[1]) => {
        try {
          await processEvent(event)
        } catch (error) {
          console.error('[prime-agent] event handling failed:', error)
          await updatePrimeConfig(pool, {
            status: 'running',
            last_error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      setPrimeCoordinatorProcessor(processCoordinatorEvent)
      queue.process(processEvent)

      fastTimer = setInterval(() => {
        void queue.enqueue({
          type: 'cron.fast',
          payload: { triggered_at: new Date().toISOString(), source: 'cron' },
        })
      }, config.cron_fast_interval_seconds * 1000)

      slowTimer = setInterval(() => {
        void queue.enqueue({
          type: 'cron.fast',
          payload: { triggered_at: new Date().toISOString(), source: 'cron_slow' },
        })
      }, config.cron_slow_interval_seconds * 1000)
    },
    async close(): Promise<void> {
      started = false
      clearInterval(fastTimer)
      clearInterval(slowTimer)
      fastTimer = undefined
      slowTimer = undefined
      setPrimeCoordinatorProcessor(undefined)
      await updatePrimeConfig(pool, {
        status: 'stopped',
      })
      await queue.close()
    },
  }
}
