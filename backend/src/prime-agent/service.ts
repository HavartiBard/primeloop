import type pg from 'pg'
import type { AgentHarness } from '../fleet-executor/harness.js'
import { setPrimeCoordinatorProcessor, setPrimeCoordinatorQueue } from '../coordinator.js'
import { getPrimeConfig, updatePrimeConfig } from './config.js'
import { handlePrimeEvent } from './event-loop.js'
import { createConfiguredLlmRouter, type LlmRouter } from './llm-router.js'
import { createInMemoryPrimeQueue, createPostgresPrimeQueue, type PrimeQueue } from './queue.js'
import { appendThreadMessage } from '../runtime.js'
/**
 * Team plan for Prime onboarding.
 * Represents a proposed set of agents derived from the setup conversation.
 */
export interface TeamPlan {
  id: string
  purpose: string
  confirmation_status: 'proposed' | 'confirmed' | 'rejected' | 'partially_confirmed'
  agents: Array<{
    role: string
    name: string
    rationale: string
    recommendation_strength: 'strongly_recommended' | 'optional'
    category: 'platform_maintenance' | 'goal_specific'
    capabilities: string[]
  }>
  created_agent_ids: string[]
}

/**
 * Generate a team plan for initial Prime onboarding.
 * Inserts a row into the team_plans table and returns the created plan.
 */
export async function generateTeamPlan(
  pool: pg.Pool,
  sessionId: string
): Promise<TeamPlan> {
  const agents: TeamPlan['agents'] = [
    {
      role: 'sre',
      name: 'SRE Agent',
      rationale: 'Monitors system health and responds to incidents',
      recommendation_strength: 'strongly_recommended' as const,
      category: 'platform_maintenance' as const,
      capabilities: ['monitoring', 'alerting', 'incident_response'],
    },
    {
      role: 'devops',
      name: 'DevOps Agent',
      rationale: 'Manages CI/CD pipelines and infrastructure provisioning',
      recommendation_strength: 'strongly_recommended' as const,
      category: 'platform_maintenance' as const,
      capabilities: ['ci_cd', 'infrastructure', 'deployment'],
    },
    {
      role: 'architect',
      name: 'Architect Agent',
      rationale: 'Reviews technical decisions and maintains system design consistency',
      recommendation_strength: 'optional' as const,
      category: 'goal_specific' as const,
      capabilities: ['design_review', 'documentation'],
    },
    {
      role: 'researcher',
      name: 'Researcher Agent',
      rationale: 'Investigates new technologies and gathers context for decisions',
      recommendation_strength: 'optional' as const,
      category: 'goal_specific' as const,
      capabilities: ['research', 'analysis'],
    },
  ]

  const { rows } = await pool.query(
    `INSERT INTO team_plans (title, session_id, agents, confirmation_status, confirmed, recommended)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, confirmation_status, agents, created_agent_ids`,
    [
      'Recommended Initial Team',
      sessionId,
      JSON.stringify(agents),
      'proposed',
      false,
      true,
    ]
  )

  const row = rows[0]
  return {
    id: row.id,
    purpose: 'Initial team to support Prime operations',
    confirmation_status: row.confirmation_status as TeamPlan['confirmation_status'],
    agents: row.agents as TeamPlan['agents'],
    created_agent_ids: row.created_agent_ids as string[],
  }
}

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
