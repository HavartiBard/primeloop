import type pg from 'pg'
import { appendThreadMessage, getPrimeProfile } from '../runtime.js'
import type { PrimeActionDispatchResult } from './actions.js'
import type { PrimeContext } from './context.js'
import type { PrimeEvent } from './events.js'
import type { LlmRouter, PrimeDecision } from './llm-router.js'
import { listConfiguredPrimeModules, runPrimeModules, runShadowPrimeModules } from './modules/registry.js'
import { PRIME_MODULE_STAGES, type PrimeConfiguredModule, type PrimeLoopState } from './modules/types.js'
import {
  completePrimeSession,
  failRunningPrimeMessageSessions,
  failPrimeMessageSessionsExcept,
  failPrimeSession,
  listPrimeMessageSessionsByMessageId,
  savePrimeSessionModuleRuns,
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

const STALE_DUPLICATE_MESSAGE_SESSION_MS = 5 * 60 * 1000

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
  const duplicate = event.type === 'prime.message'
    ? await reconcilePrimeMessageSession(pool, event.payload.message_id)
    : null
  if (duplicate?.kind === 'completed') {
    return {
      session: duplicate.session,
      decision: {
        reasoning: 'Duplicate Prime message suppressed because it was already completed.',
        actions: [],
      },
      actions: [],
    }
  }
  if (duplicate?.kind === 'running') {
    return {
      session: duplicate.session,
      decision: {
        reasoning: 'Duplicate Prime message suppressed because it is already being processed.',
        actions: [],
      },
      actions: [],
    }
  }

  const workspace = await loadPrimeWorkspaceTemplates(pool)
  const configuredModules = await listConfiguredPrimeModules(pool)
  const activeModules = configuredModules.filter((entry) => entry.rollout_mode === 'active')
  const shadowModules = configuredModules.filter((entry) => entry.rollout_mode === 'shadow')
  const session = await startPrimeSession(pool, {
    trigger_type: mapTriggerType(event),
    trigger_payload: event.payload,
    workspace_root: workspace.effectiveRoot,
    workspace_revision: workspace.revision,
    prompt_templates: {
      ...workspace.templatePaths,
      prime_modules: summarizeConfiguredPrimeModules(configuredModules),
    },
  })
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

  try {
    for (const stage of PRIME_MODULE_STAGES) {
      const stageActiveModules = activeModules.filter((entry) => entry.module.stage === stage)
      const stageShadowModules = shadowModules.filter((entry) => entry.module.stage === stage)

      for (const configured of stageActiveModules) {
        await updateLastStep(pool, session.id, `module:${configured.module.id}`)
        await runPrimeModules(state, {
          pool,
          router: deps.router,
          sessionId: session.id,
          executionMode: 'active',
          moduleConfig: configured.config,
        }, [configured.module])
      }

      for (const configured of stageShadowModules) {
        await updateLastStep(pool, session.id, `shadow:${configured.module.id}`)
        await runShadowPrimeModules(
          state,
          {
            pool,
            router: deps.router,
            sessionId: session.id,
            executionMode: 'shadow',
            moduleConfig: configured.config,
          },
          [configured.module]
        )
      }
    }

    const context = requireContext(state)
    const decision = requireDecision(state)
    const actions = state.actions

    await savePrimeSessionModuleRuns(pool, session.id, state.moduleRuns)

    if (event.type === 'prime.message') {
      const primeProfile = await getPrimeProfile(pool)
      await appendThreadMessage(pool, event.payload.thread_id, {
        role: 'assistant',
        sender: primeProfile.name.trim() || 'Prime',
        content: presentPrimeResponse(decision, actions),
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
      await failPrimeMessageSessionsExcept(
        pool,
        event.payload.message_id,
        session.id,
        `duplicate prime.message session superseded by ${session.id}`
      )
      await updateIntakeWorkItemStatus(pool, event.payload.message_id, 'review')
    }

    return {
      session: completed,
      decision,
      actions,
    }
  } catch (error) {
    await savePrimeSessionModuleRuns(pool, session.id, state.moduleRuns)
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

async function reconcilePrimeMessageSession(
  pool: pg.Pool,
  messageId: string
): Promise<
  | { kind: 'completed'; session: PrimeSession }
  | { kind: 'running'; session: PrimeSession }
  | null
> {
  const sessions = await listPrimeMessageSessionsByMessageId(pool, messageId)
  const completed = sessions.find((session) => session.status === 'completed' || session.status === 'escalated')
  if (completed) {
    await failPrimeMessageSessionsExcept(
      pool,
      messageId,
      completed.id,
      `duplicate prime.message session superseded by completed session ${completed.id}`
    )
    return { kind: 'completed', session: completed }
  }

  const running = sessions.find((session) => session.status === 'running')
  if (!running) {
    return null
  }

  const startedAt = new Date(running.started_at).getTime()
  if (Number.isFinite(startedAt) && Date.now() - startedAt >= STALE_DUPLICATE_MESSAGE_SESSION_MS) {
    await failRunningPrimeMessageSessions(
      pool,
      messageId,
      `stale duplicate prime.message session timed out after ${STALE_DUPLICATE_MESSAGE_SESSION_MS}ms`
    )
    return null
  }

  return { kind: 'running', session: running }
}

function summarizeConfiguredPrimeModules(modules: PrimeConfiguredModule[]): string {
  return modules
    .map(({ module, rollout_mode }) => `${rollout_mode}:${module.stage}:${module.id}@${module.version}`)
    .join(', ')
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

function presentPrimeResponse(
  decision: PrimeDecision,
  actions: PrimeActionDispatchResult[]
): string {
  // Always use response as the user-facing content. Never fall back to reasoning.
  const base = decision.response?.trim()
  if (!base) {
    return 'I\'ve processed your request.'
  }

  // Build natural-language action descriptions from each action's reason field.
  const dispatched = actions.filter((result) => result.action.type !== 'no_op')
  if (dispatched.length === 0) {
    return base
  }

  const actionDescriptions = dispatched.map((result) => {
    const reason = result.action.reason?.trim()
    if (!reason) {
      return `I've taken action: ${result.action.type.replace(/_/g, ' ')}`
    }
    // Use the action's reason as a natural-language description
    return reason[0].toLowerCase() + reason.slice(1)
  })

  return `${base} ${actionDescriptions.join(' ')}`
}

export class PrimeEventLoopError extends Error {
  session: PrimeSession

  constructor(message: string, session: PrimeSession) {
    super(message)
    this.name = 'PrimeEventLoopError'
    this.session = session
  }
}
