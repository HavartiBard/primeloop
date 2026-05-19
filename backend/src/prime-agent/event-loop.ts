import type pg from 'pg'
import { hashContextSnapshot } from '../checkpoint-store.js'
import { appendThreadMessage, getPrimeProfile } from '../runtime.js'
import type { PrimeActionDispatchResult } from './actions.js'
import { buildContextSnapshot, type PrimeContext } from './context.js'
import type { PrimeEvent } from './events.js'
import type { LlmRouter, PrimeDecision } from './llm-router.js'
import { listPrimeModules, runPrimeModules, summarizePrimeModules } from './modules/registry.js'
import type { PrimeLoopState } from './modules/types.js'
import {
  completePrimeSession,
  failPrimeSession,
  startPrimeSession,
  type PrimeSession,
  type PrimeSessionTriggerType,
} from './session.js'
import { loadPrimeWorkspaceTemplates } from '../workspace.js'

export interface PrimeEventLoopDeps {
  router: LlmRouter
}

export interface PrimeEventHandleResult {
  session: PrimeSession
  decision: PrimeDecision
  actions: PrimeActionDispatchResult[]
}

async function updateLastStep(pool: pg.Pool, sessionId: string, step: string): Promise<void> {
  await pool.query(
    `UPDATE prime_agent_sessions SET last_step = $2 WHERE id = $1`,
    [sessionId, step]
  )
}

export async function handlePrimeEvent(
  pool: pg.Pool,
  event: PrimeEvent,
  deps: PrimeEventLoopDeps
): Promise<PrimeEventHandleResult> {
  const workspace = await loadPrimeWorkspaceTemplates(pool)
  const modules = listPrimeModules()
  const session = await startPrimeSession(pool, {
    trigger_type: mapTriggerType(event),
    trigger_payload: event.payload,
    workspace_root: workspace.effectiveRoot,
    workspace_revision: workspace.revision,
    prompt_templates: {
      ...workspace.templatePaths,
      prime_modules: summarizePrimeModules(modules),
    },
  })

  try {
    const state: PrimeLoopState = {
      event,
      session,
      actions: [],
      diagnostics: [],
      moduleRuns: [],
      budget: {
        llmCalls: 0,
        actionsDispatched: 0,
      },
    }

    for (const module of modules) {
      await updateLastStep(pool, session.id, `module:${module.id}`)
      await runPrimeModules(state, { pool, router: deps.router, sessionId: session.id }, [module])
    }

    const context = requireContext(state)
    const decision = requireDecision(state)
    const actions = await saveActionContinuations(pool, context, decision, session.id, state.actions)

    if (event.type === 'prime.message') {
      const primeProfile = await getPrimeProfile(pool)
      await appendThreadMessage(pool, event.payload.thread_id, {
        role: 'assistant',
        sender: primeProfile.name.trim() || 'Prime',
        content: summarizePrimeResponse(decision, actions),
        metadata: {
          source: 'prime-agent',
          session_id: session.id,
        },
      })
    }

    await updateLastStep(pool, session.id, 'completed')
    const completed = await completePrimeSession(pool, session.id, {
      reasoning_summary: decision.reasoning,
      actions_taken: decision.actions,
      token_count: decision.token_count,
      provider_used: decision.provider_used,
      model_used: decision.model_used,
    })

    if (!completed) {
      throw new Error(`failed to complete prime session: ${session.id}`)
    }
    if (event.type === 'prime.message') {
      await updateIntakeWorkItemStatus(pool, event.payload.message_id, 'review')
    }

    return {
      session: completed,
      decision,
      actions,
    }
  } catch (error) {
    await updateLastStep(pool, session.id, 'failed')
    const message = error instanceof Error ? error.message : String(error)
    const failed = await failPrimeSession(pool, session.id, message)
    if (event.type === 'prime.message') {
      await updateIntakeWorkItemStatus(pool, event.payload.message_id, 'blocked')
      const primeProfile = await getPrimeProfile(pool)
      await appendThreadMessage(pool, event.payload.thread_id, {
        role: 'assistant',
        sender: primeProfile.name.trim() || 'Prime',
        content: `I could not process that yet: ${message}`,
        metadata: {
          source: 'prime-agent',
          session_id: session.id,
          error: true,
        },
      })
    }
    throw new PrimeEventLoopError(message, failed ?? session)
  }
}

async function updateIntakeWorkItemStatus(
  pool: pg.Pool,
  messageId: string,
  status: 'review' | 'blocked'
): Promise<void> {
  await pool.query(
    `UPDATE work_items
     SET status = $2, updated_at = now()
     WHERE metadata->>'source' = 'prime-agent-intake'
       AND metadata->>'message_id' = $1`,
    [messageId, status]
  )
}

async function saveActionContinuations(
  pool: pg.Pool,
  ctx: PrimeContext,
  decision: PrimeDecision,
  sessionId: string,
  results: PrimeActionDispatchResult[]
): Promise<PrimeActionDispatchResult[]> {
  for (const result of results) {
    if (result.approval && !result.approval.status.includes('approved')) {
      await saveApprovalContinuation(pool, sessionId, ctx, decision)
    }
  }

  return results
}

function requireContext(state: PrimeLoopState): PrimeContext {
  if (!state.context) {
    throw new Error('Prime loop completed without assembled context')
  }
  return state.context
}

function requireDecision(state: PrimeLoopState): PrimeDecision {
  if (!state.decision) {
    throw new Error('Prime loop completed without a decision')
  }
  return state.decision
}

async function saveApprovalContinuation(
  pool: pg.Pool,
  sessionId: string,
  context: PrimeContext,
  decision: PrimeDecision
): Promise<void> {
  const snapshot = buildContextSnapshot(context)
  await pool.query(
    `INSERT INTO checkpoint_continuations (owner_type, owner_id, step, context_hash, context_snapshot, continuation, status)
     VALUES ('prime_session', $1, 'awaiting_approval', $2, $3, $4, 'pending')`,
    [
      sessionId,
      hashContextSnapshot(snapshot),
      JSON.stringify(snapshot),
      JSON.stringify({ decision }),
    ]
  )
}

function mapTriggerType(event: PrimeEvent): PrimeSessionTriggerType {
  switch (event.type) {
    case 'prime.message':
      return 'prime_message'
    case 'cron.fast':
      return 'cron_fast'
    case 'fleet.delegation.completed':
    case 'fleet.delegation.failed':
      return 'event'
  }
}

function summarizePrimeResponse(
  decision: PrimeDecision,
  actions: PrimeActionDispatchResult[]
): string {
  const dispatched = actions.map((result) => result.action.type)
  const summary = decision.reasoning.trim()
  if (dispatched.length === 0) {
    return summary
  }
  return `${summary} Actions: ${dispatched.join(', ')}.`
}

export class PrimeEventLoopError extends Error {
  session: PrimeSession

  constructor(message: string, session: PrimeSession) {
    super(message)
    this.name = 'PrimeEventLoopError'
    this.session = session
  }
}
