import type pg from 'pg'
import { appendThreadMessage, createDelegation, createWorkItem, getPrimeProfile, insertRuntimeEvent, updateWorkItem, type WorkItem } from '../runtime.js'
import { getAgentByRole } from '../registry.js'
import { routeInvestigation, recordRoutingOutcome } from '../routing/index.js'
import { createPrimeSessionSpan, createModuleSpan, recordModuleCompletion, recordDecision, recordBudget, endSpan, recordError, isOTelInitialized } from '../observability/otel.js'
import type { AgentHarness } from '../fleet-executor/harness.js'
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
  publishEvent?: (type: string, payload: Record<string, unknown>) => Promise<void>
  getHarness: (agentId: string) => AgentHarness | undefined
}

export interface PrimeEventHandleResult {
  session: PrimeSession
  decision: PrimeDecision
  actions: PrimeActionDispatchResult[]
}

const STALE_DUPLICATE_MESSAGE_SESSION_MS = 5 * 60 * 1000

// Per-session AbortControllers — lets the abort API cancel in-flight LLM calls.
const _sessionAbortControllers = new Map<string, AbortController>()

export function abortPrimeSession(sessionId: string): boolean {
  const controller = _sessionAbortControllers.get(sessionId)
  if (!controller) return false
  controller.abort()
  return true
}

async function updateLastStep(pool: pg.Pool, sessionId: string, step: string): Promise<void> {
  await pool.query(
    `UPDATE prime_agent_sessions SET last_step = $2 WHERE id = $1`,
    [sessionId, step]
  )
}

async function emitPrimeEvent(
  deps: PrimeEventLoopDeps,
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!deps.publishEvent) return
  await deps.publishEvent(type, payload)
}

/**
 * Returns true if there is no actionable work for a cron.fast tick:
 *   1. No active/pending work items exist, OR
 *   2. Every active/pending work item already has an in-flight delegation, AND
 *      no fleet.delegation completed/failed events have arrived since the last
 *      cron_fast prime session completed.
 *
 * When quiescent, the cron.fast tick skips the LLM entirely.
 */
async function isCronQuiescent(pool: pg.Pool): Promise<boolean> {
  // 1. Are there any active/pending work items?
  const { rows: [itemCount] } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM work_items WHERE status IN ('active', 'pending')`
  )
  if (parseInt(itemCount.n, 10) === 0) {
    return true
  }

  // 2. Do all active/pending work items have an in-flight delegation?
  const { rows: [uncoveredCount] } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM work_items wi
     WHERE wi.status IN ('active', 'pending')
       AND NOT EXISTS (
         SELECT 1 FROM delegations d
         WHERE d.work_item_id = wi.id
           AND d.status IN ('queued', 'running', 'pending')
       )`
  )
  if (parseInt(uncoveredCount.n, 10) > 0) {
    // At least one item has no in-flight delegation — prime may need to act.
    return false
  }

  // 3. All items are covered. Only wake if a delegation event arrived since the
  //    last completed cron_fast session — otherwise there is nothing new to react to.
  const { rows: [lastSession] } = await pool.query<{ completed_at: string | null }>(
    `SELECT completed_at
     FROM prime_agent_sessions
     WHERE trigger_type = 'cron_fast'
       AND status IN ('completed', 'escalated')
     ORDER BY completed_at DESC
     LIMIT 1`
  )
  const since = lastSession?.completed_at ?? null

  const { rows: [newEvents] } = await pool.query<{ n: string }>(
    since
      ? `SELECT COUNT(*)::text AS n
         FROM runtime_events
         WHERE event_type IN ('delegation.completed', 'delegation.failed')
           AND created_at > $1`
      : `SELECT COUNT(*)::text AS n
         FROM runtime_events
         WHERE event_type IN ('delegation.completed', 'delegation.failed')`,
    since ? [since] : []
  )
  return parseInt(newEvents.n, 10) === 0
}

async function reconcileWorkItemStates(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{
    id: string
    blocked_reason: string | null
    routing_outcome: string | null
    metadata: Record<string, unknown> | null
  }>(`
    SELECT wi.id,
           COALESCE(evt.payload->>'reason', wi.blocked_by, 'no-investigation-route') AS blocked_reason,
           COALESCE(evt.payload->>'routing_outcome', wi.metadata->>'routing_outcome') AS routing_outcome,
           wi.metadata
      FROM work_items wi
      LEFT JOIN LATERAL (
        SELECT payload
          FROM runtime_events re
         WHERE re.work_item_id = wi.id
           AND re.event_type IN ('prime.failure.investigation_needed', 'prime.blocker.investigation_needed')
         ORDER BY re.created_at DESC
         LIMIT 1
      ) evt ON true
     WHERE wi.status = 'active'
       AND wi.metadata->>'action_type' IN ('hard_failure_investigation', 'prime_blocker_investigation')
       AND evt.payload IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM delegations d
          WHERE d.work_item_id = wi.id
            AND d.status IN ('queued', 'running', 'pending')
       )
  `)

  for (const row of rows) {
    await updateWorkItem(pool, row.id, {
      status: 'blocked',
      blocked_by: row.blocked_reason ?? 'no-investigation-route',
      metadata: {
        ...(row.metadata ?? {}),
        investigation_status: 'blocked',
        routing_outcome: row.routing_outcome ?? (row.metadata?.['routing_outcome'] as string | undefined) ?? 'blocked_runtime_unavailable',
      },
    })
    await insertRuntimeEvent(pool, {
      event_type: 'work.reclassified',
      actor: 'Prime',
      work_item_id: row.id,
      payload: {
        previous_status: 'active',
        status: 'blocked',
        reason: row.blocked_reason ?? 'no-investigation-route',
      },
    })
  }
}

export async function handlePrimeEvent(
  pool: pg.Pool,
  event: PrimeEvent,
  deps: PrimeEventLoopDeps
): Promise<PrimeEventHandleResult> {
  // Create root span for Prime session if OTel is initialized
  let sessionSpan: any = null
  let moduleSpans: Map<string, any> = new Map()
  
  if (isOTelInitialized()) {
    const triggerType = mapTriggerType(event)
    sessionSpan = createPrimeSessionSpan(
      'temp-session', // Will be updated with real session ID after creation
      event.type,
      triggerType
    )
  }
  
  await reconcileWorkItemStates(pool)

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

  if (event.type === 'cron.fast' && await isCronQuiescent(pool).catch(() => false)) {
    await emitPrimeEvent(deps, 'prime.cron.skipped', {
      reason: 'quiescent',
      triggered_at: event.payload.triggered_at,
      source: event.payload.source ?? 'cron',
    })
    // Create a minimal completed session so the last-run timestamp advances
    // and condition 3 above has a fresh baseline next tick.
    const skippedSession = await startPrimeSession(pool, {
      trigger_type: 'cron_fast',
      trigger_payload: event.payload,
      workspace_root: '',
      workspace_revision: '',
      prompt_templates: {},
    })
    const completed = await completePrimeSession(pool, skippedSession.id, {
      reasoning_summary: 'Skipped: no actionable work (quiescent)',
      actions_taken: [],
      token_count: 0,
    })
    const noopDecision: PrimeDecision = {
      reasoning: 'Skipped: no actionable work (quiescent)',
      actions: [],
    }
    return {
      session: completed ?? skippedSession,
      decision: noopDecision,
      actions: [],
    }
  }

  const workspace = await loadPrimeWorkspaceTemplates(pool)
  
  // Update session span with workspace info
  if (sessionSpan) {
    sessionSpan.setAttribute('prime.workspace_root', workspace.effectiveRoot)
    sessionSpan.setAttribute('prime.workspace_revision', workspace.revision)
  }
  
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
  
  // Update session span with real session ID
  if (sessionSpan) {
    sessionSpan.setAttribute('prime.session_id', session.id)
  }
  
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
  const triggerMetadata = getTriggerMetadata(event)
  await emitPrimeEvent(deps, 'prime.turn.started', {
    session_id: session.id,
    trigger_type: event.type,
    ...triggerMetadata,
  })

  // Per-session AbortController — allows the abort API to cancel the LLM call.
  const abortController = new AbortController()
  _sessionAbortControllers.set(session.id, abortController)

  // Inject abort signal into the router so LLM calls can be cancelled.
  const depsWithSignal: PrimeEventLoopDeps = {
    ...deps,
    router: {
      ...deps.router,
      decide: (ctx) => deps.router.decide(ctx, abortController.signal),
    },
  }

  // Hard cap: a session must complete within 3 minutes. This prevents a hung
  // LLM call from leaving a session stuck as 'running' indefinitely.
  const SESSION_TIMEOUT_MS = 6 * 60 * 1000
  const sessionTimeoutPromise = new Promise<never>((_, reject) => {
    const t = setTimeout(() => reject(new Error(`Session timed out after ${SESSION_TIMEOUT_MS / 1000}s`)), SESSION_TIMEOUT_MS)
    abortController.signal.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new Error('Session aborted by operator'))
    })
  })

  try {
    await Promise.race([
      (async () => {
        for (const stage of PRIME_MODULE_STAGES) {
          const stageActiveModules = activeModules.filter((entry) => entry.module.stage === stage)
          const stageShadowModules = shadowModules.filter((entry) => entry.module.stage === stage)

          for (const configured of stageActiveModules) {
            await runConfiguredModule(pool, depsWithSignal, state, configured, 'active', sessionSpan, moduleSpans)
          }

          for (const configured of stageShadowModules) {
            await runConfiguredModule(pool, depsWithSignal, state, configured, 'shadow', sessionSpan, moduleSpans)
          }
        }
      })(),
      sessionTimeoutPromise,
    ])

    const context = requireContext(state)
    const decision = requireDecision(state)
    const actions = state.actions
    
    // Record decision and budget in OTel span
    if (sessionSpan) {
      recordDecision(
        sessionSpan,
        decision.provider_used,
        decision.model_used,
        decision.token_count,
        decision.actions.length
      )
      recordBudget(sessionSpan, state.budget.llmCalls, state.budget.actionsDispatched)
    }

    await emitPrimeEvent(deps, 'prime.turn.reasoning', {
      session_id: session.id,
      trigger_type: event.type,
      reasoning: decision.reasoning,
      response: decision.response ?? null,
      provider_used: decision.provider_used ?? null,
      model_used: decision.model_used ?? null,
      action_count: decision.actions.length,
      ...triggerMetadata,
    })

    await emitPrimeEvent(deps, 'prime.turn.actions', {
      session_id: session.id,
      trigger_type: event.type,
      actions: decision.actions.map((action) => ({
        type: action.type,
        reason: action.reason ?? null,
      })),
      dispatched_count: actions.length,
      ...triggerMetadata,
    })

    await savePrimeSessionModuleRuns(pool, session.id, state.moduleRuns)

    if (event.type === 'prime.message') {
      const primeProfile = await getPrimeProfile(pool)
      const blockerEscalation = shouldEscalateBlockedTurn(actions)
        ? await createSreInvestigationForPrimeBlocker(
            pool,
            event,
            session.id,
            collectBlockerReasons(actions),
            deps.getHarness,
          )
        : null
      await appendThreadMessage(pool, event.payload.thread_id, {
        role: 'assistant',
        sender: primeProfile.name.trim() || 'Prime',
        content: presentPrimeResponse(decision, actions, blockerEscalation?.userMessage),
        metadata: {
          source: 'prime-agent',
          session_id: session.id,
          ...(blockerEscalation?.workItemId ? { investigation_work_item_id: blockerEscalation.workItemId } : {}),
          ...(blockerEscalation?.delegationId ? { investigation_delegation_id: blockerEscalation.delegationId } : {}),
        },
      })
    }

    // End session span on success
    if (sessionSpan) {
      endSpan(sessionSpan, 'ok')
    }
    
    _sessionAbortControllers.delete(session.id)
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
    }

    await emitPrimeEvent(deps, 'prime.turn.completed', {
      session_id: session.id,
      trigger_type: event.type,
      status: completed.status,
      action_count: actions.length,
      reasoning_summary: decision.reasoning,
      provider_used: decision.provider_used ?? null,
      model_used: decision.model_used ?? null,
      ...triggerMetadata,
    })

    // Handle goal.created events: post thinking message and agent join events
    if (event.type === 'goal.created' && event.payload.thread_id) {
      const primeProfile = await getPrimeProfile(pool)
      // Post a thinking message as Prime evaluates which agents to recruit
      await appendThreadMessage(pool, event.payload.thread_id, {
        role: 'assistant',
        sender: primeProfile.name.trim() || 'Prime',
        content: `I'm evaluating which agents to recruit for: ${event.payload.title}`,
        metadata: { source: 'prime-agent', session_id: session.id },
      })
    }

    return {
      session: completed,
      decision,
      actions,
    }
  } catch (error) {
    // End session span on error
    if (sessionSpan) {
      recordError(sessionSpan, error instanceof Error ? error : new Error(String(error)))
      endSpan(sessionSpan, 'error')
    }
    
    _sessionAbortControllers.delete(session.id)
    await savePrimeSessionModuleRuns(pool, session.id, state.moduleRuns)
    await updateLastStep(pool, session.id, 'failed')
    const message = error instanceof Error ? error.message : String(error)
    const failed = await failPrimeSession(pool, session.id, message)
    if (event.type === 'prime.message') {
      const primeProfile = await getPrimeProfile(pool)
      const escalation = await createSreInvestigationForPrimeFailure(pool, event, session.id, message, deps.getHarness)
      await appendThreadMessage(pool, event.payload.thread_id, {
        role: 'assistant',
        sender: primeProfile.name.trim() || 'Prime',
        content: `I could not process that yet: ${message} ${escalation.userMessage}`,
        metadata: {
          source: 'prime-agent',
          session_id: session.id,
          error: true,
          ...(escalation.workItemId ? { investigation_work_item_id: escalation.workItemId } : {}),
          ...(escalation.delegationId ? { investigation_delegation_id: escalation.delegationId } : {}),
        },
      })
    }
    await emitPrimeEvent(deps, 'prime.turn.failed', {
      session_id: session.id,
      trigger_type: event.type,
      error: message,
      last_step: null,
      ...triggerMetadata,
    })
    throw new PrimeEventLoopError(message, failed ?? session)
  }
}

async function createSreInvestigationForPrimeFailure(
  pool: pg.Pool,
  event: Extract<PrimeEvent, { type: 'prime.message' }>,
  sessionId: string,
  errorMessage: string,
  getHarness: (agentId: string) => AgentHarness | undefined,
): Promise<{ userMessage: string; workItemId?: string; delegationId?: string }> {
  const title = `Investigate Prime failure: ${truncateForTitle(errorMessage)}`
  const failureSignature = errorSignature(errorMessage)
  const description = [
    `Prime session ${sessionId} failed while processing a room message.`,
    `User message: ${event.payload.content}`,
    `Failure: ${errorMessage}`,
    `Thread: ${event.payload.thread_id}`,
    `Message: ${event.payload.message_id}`,
  ].join('\n')
  const existing = await findExistingPrimeFailureInvestigation(
    pool,
    event.payload.thread_id,
    failureSignature
  )
  const workItem = existing
    ? await updateWorkItem(pool, existing.id, {
        description,
        metadata: {
          ...(existing.metadata ?? {}),
          source: 'prime-agent',
          action_type: 'hard_failure_investigation',
          source_session_id: existing.metadata?.['source_session_id'] ?? sessionId,
          latest_session_id: sessionId,
          failure_signature: failureSignature,
          error: errorMessage,
          investigation_status: 'open',
        },
      }) ?? existing
    : await createWorkItem(pool, {
        title,
        description,
        status: 'active',
        lane: 'operations',
        owner_label: 'Prime',
        thread_id: event.payload.thread_id,
        metadata: {
          source: 'prime-agent',
          action_type: 'hard_failure_investigation',
          source_session_id: sessionId,
          latest_session_id: sessionId,
          failure_signature: failureSignature,
          error: errorMessage,
          investigation_status: 'open',
        },
      })

  // Route investigation through the routing layer (FR-009)
  const outcome = await routeInvestigation(
    { pool, getHarness },
    { workClass: 'incident_response' },
  )

  if (outcome.type === 'investigate' && outcome.targetAgent) {
    const delegation = await createDelegation(pool, {
      work_item_id: workItem.id,
      to_agent_id: outcome.targetAgent.id,
      capability: 'sre',
      request: {
        title,
        description: workItem.description,
        content: `Investigate Prime failure and propose a fix: ${errorMessage}`,
        thread_id: event.payload.thread_id,
        session_id: sessionId,
        source: 'prime-agent',
        allowed_files: [],
        read_files: [],
      },
    })

    await insertRuntimeEvent(pool, {
      event_type: 'prime.failure.escalated',
      actor: 'Prime',
      thread_id: event.payload.thread_id,
      work_item_id: workItem.id,
      delegation_id: delegation.id,
      payload: {
        session_id: sessionId,
        to_agent_id: outcome.targetAgent.id,
        error: errorMessage,
      },
    })

    return {
      userMessage: existing
        ? `I reused investigation work item ${workItem.id} and routed it to ${outcome.targetAgent.name}.`
        : `I opened investigation work item ${workItem.id} and routed it to ${outcome.targetAgent.name}.`,
      workItemId: workItem.id,
      delegationId: delegation.id,
    }
  }

  // No executable route — mark blocked, record the blocker, and inform user (FR-009, FR-011)
  const blockedReason = outcome.type === 'blocked_runtime_unavailable' ? 'runtime-unavailable' : 'no-investigation-route'
  await updateWorkItem(pool, workItem.id, {
    status: 'blocked',
    blocked_by: blockedReason,
    metadata: {
      ...(workItem.metadata ?? {}),
      investigation_status: 'blocked',
      routing_outcome: outcome.type,
    },
  })
  await insertRuntimeEvent(pool, {
    event_type: 'prime.failure.investigation_needed',
    actor: 'Prime',
    thread_id: event.payload.thread_id,
    work_item_id: workItem.id,
    payload: {
      session_id: sessionId,
      reason: blockedReason,
      error: errorMessage,
      routing_outcome: outcome.type,
    },
  })

  const remediation = 'suggestedRemediations' in outcome
    ? (outcome as { suggestedRemediations?: Array<{ action: string; description: string }> }).suggestedRemediations?.[0]?.description
    : undefined

  return {
    userMessage: existing
      ? `I reused investigation work item ${workItem.id}, but no executable investigation route is available.${remediation ? ` Suggested fix: ${remediation}.` : ''}`
      : `I opened investigation work item ${workItem.id}, but no executable investigation route is available.${remediation ? ` Suggested fix: ${remediation}.` : ''}`,
    workItemId: workItem.id,
  }
}

async function createSreInvestigationForPrimeBlocker(
  pool: pg.Pool,
  event: Extract<PrimeEvent, { type: 'prime.message' }>,
  sessionId: string,
  blockerReasons: string[],
  getHarness: (agentId: string) => AgentHarness | undefined,
): Promise<{ userMessage: string; workItemId?: string; delegationId?: string }> {
  const summary = blockerReasons.join(' ').trim() || 'Prime is blocked and needs investigation.'
  const title = `Investigate Prime blocker: ${truncateForTitle(summary)}`
  const signature = errorSignature(`blocker:${summary}`)
  const description = [
    `Prime session ${sessionId} completed in a blocked state while processing a room message.`,
    `User message: ${event.payload.content}`,
    'Blockers:',
    ...blockerReasons.map((reason) => `- ${reason}`),
    `Thread: ${event.payload.thread_id}`,
    `Message: ${event.payload.message_id}`,
  ].join('\n')
  const existing = await findExistingPrimeInvestigation(
    pool,
    event.payload.thread_id,
    'prime_blocker_investigation',
    signature
  )
  const workItem = existing
    ? await updateWorkItem(pool, existing.id, {
        description,
        metadata: {
          ...(existing.metadata ?? {}),
          source: 'prime-agent',
          action_type: 'prime_blocker_investigation',
          source_session_id: existing.metadata?.['source_session_id'] ?? sessionId,
          latest_session_id: sessionId,
          failure_signature: signature,
          blocker_reasons: blockerReasons,
          investigation_status: 'open',
        },
      }) ?? existing
    : await createWorkItem(pool, {
        title,
        description,
        status: 'active',
        lane: 'operations',
        owner_label: 'Prime',
        thread_id: event.payload.thread_id,
        metadata: {
          source: 'prime-agent',
          action_type: 'prime_blocker_investigation',
          source_session_id: sessionId,
          latest_session_id: sessionId,
          failure_signature: signature,
          blocker_reasons: blockerReasons,
          investigation_status: 'open',
        },
      })

  // Route investigation through the routing layer (FR-009)
  const outcome = await routeInvestigation(
    { pool, getHarness },
    { workClass: 'incident_response' },
  )

  if (outcome.type === 'investigate' && outcome.targetAgent) {
    const delegation = await createDelegation(pool, {
      work_item_id: workItem.id,
      to_agent_id: outcome.targetAgent.id,
      capability: 'sre',
      request: {
        title,
        description: workItem.description,
        content: `Investigate Prime blocker and propose a fix: ${summary}`,
        thread_id: event.payload.thread_id,
        session_id: sessionId,
        source: 'prime-agent',
        allowed_files: [],
        read_files: [],
      },
    })

    await insertRuntimeEvent(pool, {
      event_type: 'prime.blocker.escalated',
      actor: 'Prime',
      thread_id: event.payload.thread_id,
      work_item_id: workItem.id,
      delegation_id: delegation.id,
      payload: {
        session_id: sessionId,
        to_agent_id: outcome.targetAgent.id,
        blockers: blockerReasons,
      },
    })

    return {
      userMessage: existing
        ? `I reused investigation work item ${workItem.id} and routed it to ${outcome.targetAgent.name}.`
        : `I opened investigation work item ${workItem.id} and routed it to ${outcome.targetAgent.name}.`,
      workItemId: workItem.id,
      delegationId: delegation.id,
    }
  }

  // No executable route — mark blocked, record the blocker, and inform user (FR-009, FR-011)
  const blockedReason = outcome.type === 'blocked_runtime_unavailable' ? 'runtime-unavailable' : 'no-investigation-route'
  await updateWorkItem(pool, workItem.id, {
    status: 'blocked',
    blocked_by: blockedReason,
    metadata: {
      ...(workItem.metadata ?? {}),
      investigation_status: 'blocked',
      routing_outcome: outcome.type,
    },
  })
  await insertRuntimeEvent(pool, {
    event_type: 'prime.blocker.investigation_needed',
    actor: 'Prime',
    thread_id: event.payload.thread_id,
    work_item_id: workItem.id,
    payload: {
      session_id: sessionId,
      reason: blockedReason,
      blockers: blockerReasons,
      routing_outcome: outcome.type,
    },
  })

  const remediation = 'suggestedRemediations' in outcome
    ? (outcome as { suggestedRemediations?: Array<{ action: string; description: string }> }).suggestedRemediations?.[0]?.description
    : undefined

  return {
    userMessage: existing
      ? `I reused investigation work item ${workItem.id}, but no executable investigation route is available.${remediation ? ` Suggested fix: ${remediation}.` : ''}`
      : `I opened investigation work item ${workItem.id}, but no executable investigation route is available.${remediation ? ` Suggested fix: ${remediation}.` : ''}`,
    workItemId: workItem.id,
  }
}

async function findExistingPrimeFailureInvestigation(
  pool: pg.Pool,
  threadId: string,
  failureSignature: string
): Promise<WorkItem | null> {
  return findExistingPrimeInvestigation(pool, threadId, 'hard_failure_investigation', failureSignature)
}

async function findExistingPrimeInvestigation(
  pool: pg.Pool,
  threadId: string,
  actionType: string,
  failureSignature: string
): Promise<WorkItem | null> {
  const { rows } = await pool.query<WorkItem>(
    `SELECT *
     FROM work_items
     WHERE thread_id = $1
       AND status IN ('active', 'pending')
       AND metadata->>'action_type' = $2
       AND metadata->>'investigation_status' = 'open'
       AND metadata->>'failure_signature' = $3
     ORDER BY updated_at DESC
     LIMIT 1`,
    [threadId, actionType, failureSignature]
  )
  return rows[0] ?? null
}

function shouldEscalateBlockedTurn(actions: PrimeActionDispatchResult[]): boolean {
  const reasons = collectBlockerReasons(actions)
  return reasons.some((reason) => /\b(cannot|blocked|missing|unavailable|did not|requires|error|prevents|failed|no agent|no enabled|suggested fix|routing blocked)\b/i.test(reason))
}

function collectBlockerReasons(actions: PrimeActionDispatchResult[]): string[] {
  return actions
    .filter((result) => result.action.type === 'no_op')
    .map((result) => result.action.reason?.trim())
    .filter((reason): reason is string => Boolean(reason))
}

async function runConfiguredModule(
  pool: pg.Pool,
  deps: PrimeEventLoopDeps,
  state: PrimeLoopState,
  configured: PrimeConfiguredModule,
  mode: 'active' | 'shadow',
  sessionSpan?: any,
  moduleSpans?: Map<string, any>
): Promise<void> {
  const step = mode === 'shadow'
    ? `shadow:${configured.module.id}`
    : `module:${configured.module.id}`
  await updateLastStep(pool, state.session.id, step)
  await emitPrimeEvent(deps, 'prime.turn.step', {
    session_id: state.session.id,
    trigger_type: state.event.type,
    step,
    stage: configured.module.stage,
    module_id: configured.module.id,
    version: configured.module.version,
    mode,
    status: 'started',
    ...getTriggerMetadata(state.event),
  })

  // Create module span if OTel is available
  let moduleSpan: any = null
  if (sessionSpan && configured.module.stage) {
    moduleSpan = createModuleSpan(
      sessionSpan,
      configured.module.id,
      configured.module.stage,
      configured.module.version,
      mode
    )
    if (moduleSpan) {
      moduleSpans?.set(configured.module.id, moduleSpan)
    }
  }
  
  try {
    if (mode === 'shadow') {
      await runShadowPrimeModules(
        state,
        {
          pool,
          router: deps.router,
          sessionId: state.session.id,
          executionMode: 'shadow',
          moduleConfig: configured.config,
          getHarness: deps.getHarness,
        },
        [configured.module]
      )
    } else {
      await runPrimeModules(
        state,
        {
          pool,
          router: deps.router,
          sessionId: state.session.id,
          executionMode: 'active',
          moduleConfig: configured.config,
          getHarness: deps.getHarness,
        },
        [configured.module]
      )
    }

    const latestRun = state.moduleRuns[state.moduleRuns.length - 1]
    
    // Record module completion in OTel span
    if (moduleSpan) {
      recordModuleCompletion(
        moduleSpan,
        latestRun?.status === 'failed' ? 'failed' : 'success',
        latestRun?.detail
      )
      moduleSpans?.delete(configured.module.id)
    }
    
    await emitPrimeEvent(deps, 'prime.turn.step', {
      session_id: state.session.id,
      trigger_type: state.event.type,
      step,
      stage: configured.module.stage,
      module_id: configured.module.id,
      version: configured.module.version,
      mode,
      status: latestRun?.status ?? 'completed',
      detail: latestRun?.detail ?? null,
      ...getTriggerMetadata(state.event),
    })
  } catch (error) {
    // Record module failure in OTel span
    if (moduleSpan) {
      recordModuleCompletion(moduleSpan, 'failed', error instanceof Error ? error.message : String(error))
      moduleSpans?.delete(configured.module.id)
    }
    
    const message = error instanceof Error ? error.message : String(error)
    await emitPrimeEvent(deps, 'prime.turn.step', {
      session_id: state.session.id,
      trigger_type: state.event.type,
      step,
      stage: configured.module.stage,
      module_id: configured.module.id,
      version: configured.module.version,
      mode,
      status: 'failed',
      detail: message,
      ...getTriggerMetadata(state.event),
    })
    throw error
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
    case 'goal.created':
      return 'event'
  }
}

function getTriggerMetadata(event: PrimeEvent): Record<string, unknown> {
  switch (event.type) {
    case 'prime.message':
      return {
        thread_id: event.payload.thread_id,
        message_id: event.payload.message_id,
        sender: event.payload.sender,
      }
    case 'cron.fast':
      return {
        triggered_at: event.payload.triggered_at,
        source: event.payload.source ?? 'cron',
      }
    case 'fleet.delegation.completed':
      return {
        delegation_id: event.payload.delegation_id,
        work_item_id: event.payload.work_item_id ?? null,
        agent_id: event.payload.agent_id ?? null,
      }
    case 'fleet.delegation.failed':
      return {
        delegation_id: event.payload.delegation_id,
        work_item_id: event.payload.work_item_id ?? null,
        agent_id: event.payload.agent_id ?? null,
      }
    case 'goal.created':
      return {
        goal_id: event.payload.goal_id,
        title: event.payload.title,
      }
  }
}

function truncateForTitle(value: string, max = 72): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1)}…`
}

function errorSignature(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, '<uuid>')
    .replace(/\s+/g, ' ')
    .trim()
}

function presentPrimeResponse(
  decision: PrimeDecision,
  actions: PrimeActionDispatchResult[],
  escalationMessage?: string
): string {
  // Always use response as the user-facing content. Never fall back to reasoning.
  const base = decision.response?.trim()
  if (!base) {
    console.warn('prime-agent: missing response in Prime decision, using fallback')
    return 'I\'ve processed your request.'
  }

  // Build natural-language action descriptions from each action's reason field.
  const dispatched = actions.filter((result) => result.action.type !== 'no_op')
  if (dispatched.length === 0) {
    const blockerDescriptions = actions
      .map((result) => result.action.reason?.trim())
      .filter((reason): reason is string => Boolean(reason))
    const explanation = blockerDescriptions.length > 0
      ? `${base} ${blockerDescriptions.join(' ')}`
      : base
    return escalationMessage ? `${explanation} ${escalationMessage}` : explanation
  }

  // If base ends with terminal punctuation, capitalize the first action description.
  const baseEndsWithPunctuation = /[.!?]$/.test(base)
  const actionDescriptions = dispatched.map((result, index) => {
    const reason = result.action.reason?.trim()
    if (!reason) {
      return `I've taken action: ${result.action.type.replace(/_/g, ' ')}`
    }
    // Capitalize first character if base ends with terminal punctuation
    // or if this is the first description (to start a new sentence).
    const shouldCapitalize = index === 0 && baseEndsWithPunctuation
    return shouldCapitalize
      ? reason[0].toUpperCase() + reason.slice(1)
      : reason[0].toLowerCase() + reason.slice(1)
  })

  const response = `${base} ${actionDescriptions.join(' ')}`
  return escalationMessage ? `${response} ${escalationMessage}` : response
}

export class PrimeEventLoopError extends Error {
  session: PrimeSession

  constructor(message: string, session: PrimeSession) {
    super(message)
    this.name = 'PrimeEventLoopError'
    this.session = session
  }
}
