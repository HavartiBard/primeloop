import type pg from 'pg'
import { hashContextSnapshot } from '../checkpoint-store.js'
import { appendThreadMessage } from '../runtime.js'
import { dispatchPrimeActions, type PrimeActionDispatchResult } from './actions.js'
import { assemblePrimeContext, buildContextSnapshot, type PrimeContext } from './context.js'
import type { PrimeEvent } from './events.js'
import { validatePrimeDecision, type LlmRouter, type PrimeDecision } from './llm-router.js'
import {
  completePrimeSession,
  failPrimeSession,
  startPrimeSession,
  type PrimeSession,
  type PrimeSessionTriggerType,
} from './session.js'

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
  const session = await startPrimeSession(pool, {
    trigger_type: mapTriggerType(event),
    trigger_payload: event.payload,
  })

  try {
    await updateLastStep(pool, session.id, 'assembling_context')
    const context = await assemblePrimeContext(pool, event)

    await updateLastStep(pool, session.id, 'deciding')
    const decision = validatePrimeDecision(await deps.router.decide(context))

    await updateLastStep(pool, session.id, 'dispatching')
    const actions = await dispatchPrimeActionsWithContinuation(
      pool,
      context,
      decision,
      session.id,
      event
    )

    if (event.type === 'chief.message') {
      await appendThreadMessage(pool, event.payload.thread_id, {
        role: 'assistant',
        sender: 'Prime Agent',
        content: summarizeChiefResponse(decision, actions),
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

    return {
      session: completed,
      decision,
      actions,
    }
  } catch (error) {
    await updateLastStep(pool, session.id, 'failed')
    const message = error instanceof Error ? error.message : String(error)
    const failed = await failPrimeSession(pool, session.id, message)
    throw new PrimeEventLoopError(message, failed ?? session)
  }
}

async function dispatchPrimeActionsWithContinuation(
  pool: pg.Pool,
  ctx: PrimeContext,
  decision: PrimeDecision,
  sessionId: string,
  event: PrimeEvent
): Promise<PrimeActionDispatchResult[]> {
  const results = await dispatchPrimeActions(pool, ctx, decision)

  for (const result of results) {
    if (result.approval && !result.approval.status.includes('approved')) {
      await saveApprovalContinuation(pool, sessionId, ctx, decision)
    }
  }

  return results
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
    case 'chief.message':
      return 'chief_message'
    case 'cron.fast':
      return 'cron_fast'
    case 'fleet.delegation.completed':
    case 'fleet.delegation.failed':
      return 'event'
  }
}

function summarizeChiefResponse(
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
