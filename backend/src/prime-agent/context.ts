import type pg from 'pg'
import type { AgentHarness } from '../fleet-executor/harness.js'
import type { PrimeEvent } from './events.js'
import { listAgents, type RegistryAgent } from '../registry.js'
import type { Delegation, RuntimeEvent, ThreadMessage, WorkItem } from '../runtime.js'
import {
  buildRuntimeTruth,
  type RuntimeTruth,
  type RuntimeAvailability,
} from '../routing/index.js'

export interface PrimeLesson {
  id: string
  agent_id: string
  content: string
  context?: string
  category?: string
  severity?: string
  created_at: string
}

export interface PrimeContext {
  trigger: PrimeEvent
  fleet: {
    agents: RegistryAgent[]
    workItems: WorkItem[]
    delegations: Delegation[]
  }
  /** Runtime truth: dispatchable vs registered vs spawnable capacity (FR-001, FR-006) */
  runtimeTruth: RuntimeTruth
  recentEvents: RuntimeEvent[]
  recentLessons: PrimeLesson[]
  threadMessages: ThreadMessage[]
}

export function buildContextSnapshot(context: PrimeContext): Record<string, unknown> {
  return {
    active_work_item_count: context.fleet.workItems.length,
    pending_delegation_ids: context.fleet.delegations
      .filter((d) => d.status === 'queued')
      .map((d) => d.id),
    last_event_id: context.recentEvents[0]?.id,
  }
}

const AGENT_LIMIT = 25
const WORK_ITEM_LIMIT = 20
const DELEGATION_LIMIT = 20
const EVENT_LIMIT = 50
const LESSON_LIMIT = 10

export interface AssembleContextDeps {
  pool: pg.Pool
  getHarness: (agentId: string) => AgentHarness | undefined
}

export async function assemblePrimeContext(
  deps: AssembleContextDeps,
  event: PrimeEvent,
): Promise<PrimeContext> {
  const { pool } = deps
  const [agents, workItems, delegations, recentEvents, recentLessons, threadMessages, runtimeTruth] = await Promise.all([
    listEnabledAgents(pool),
    listRecentWorkItems(pool, WORK_ITEM_LIMIT),
    listRecentDelegations(pool, DELEGATION_LIMIT),
    listRecentRuntimeEvents(pool, EVENT_LIMIT),
    listRelevantLessons(pool, event, LESSON_LIMIT),
    listThreadMessagesForEvent(pool, event, 15),
    buildRuntimeTruth({ pool, getHarness: deps.getHarness }),
  ])

  return {
    trigger: event,
    fleet: {
      agents,
      workItems,
      delegations,
    },
    runtimeTruth,
    recentEvents,
    recentLessons,
    threadMessages,
  }
}

async function listEnabledAgents(pool: pg.Pool): Promise<RegistryAgent[]> {
  const agents = await listAgents(pool)
  return agents.filter((agent) => agent.enabled).slice(0, AGENT_LIMIT)
}

async function listRecentWorkItems(pool: pg.Pool, limit: number): Promise<WorkItem[]> {
  const { rows } = await pool.query(
    `SELECT * FROM work_items ORDER BY updated_at DESC LIMIT $1`,
    [limit]
  )
  return rows
}

async function listRecentDelegations(pool: pg.Pool, limit: number): Promise<Delegation[]> {
  const { rows } = await pool.query(
    `SELECT * FROM delegations ORDER BY updated_at DESC LIMIT $1`,
    [limit]
  )
  return rows
}

async function listRecentRuntimeEvents(pool: pg.Pool, limit: number): Promise<RuntimeEvent[]> {
  const { rows } = await pool.query(
    `SELECT * FROM runtime_events ORDER BY created_at DESC LIMIT $1`,
    [limit]
  )
  return rows
}

async function listThreadMessagesForEvent(
  pool: pg.Pool,
  event: PrimeEvent,
  limit: number
): Promise<ThreadMessage[]> {
  if (event.type !== 'prime.message') return []

  const { rows } = await pool.query<ThreadMessage>(
    `SELECT *
     FROM thread_messages
     WHERE thread_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [event.payload.thread_id, limit]
  )
  return rows.reverse()
}

async function listRelevantLessons(pool: pg.Pool, event: PrimeEvent, limit: number): Promise<PrimeLesson[]> {
  const { rows: tableRows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'agent_lessons'
     ) AS exists`
  )

  if (tableRows[0]?.exists !== true) {
    return []
  }

  const terms = extractTriggerTerms(event)
  const { rows } = await pool.query<PrimeLesson>(
    `SELECT id, agent_id, content, context, category, severity, created_at::text
     FROM agent_lessons
     ORDER BY created_at DESC
     LIMIT $1`,
    [Math.max(limit * 5, limit)]
  )

  if (terms.length === 0) {
    return rows.slice(0, limit)
  }

  return rows
    .map((lesson) => ({ lesson, score: lessonScore(lesson, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return new Date(b.lesson.created_at).getTime() - new Date(a.lesson.created_at).getTime()
    })
    .slice(0, limit)
    .map((entry) => entry.lesson)
}

function extractTriggerTerms(event: PrimeEvent): string[] {
  const chunks: string[] = [event.type]

  switch (event.type) {
    case 'prime.message':
      chunks.push(event.payload.content, event.payload.sender)
      break
    case 'cron.fast':
      if (event.payload.source) chunks.push(event.payload.source)
      break
    case 'fleet.delegation.completed':
      chunks.push(event.payload.delegation_id, event.payload.work_item_id ?? '', event.payload.agent_id ?? '')
      break
    case 'fleet.delegation.failed':
      chunks.push(
        event.payload.delegation_id,
        event.payload.work_item_id ?? '',
        event.payload.agent_id ?? '',
        event.payload.error,
      )
      break
  }

  return tokenize(chunks.join(' '))
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3)
}

function lessonScore(lesson: PrimeLesson, terms: string[]): number {
  const haystack = `${lesson.content} ${lesson.context ?? ''} ${lesson.category ?? ''} ${lesson.severity ?? ''}`.toLowerCase()
  return terms.reduce((score, term) => (haystack.includes(term) ? score + 1 : score), 0)
}
