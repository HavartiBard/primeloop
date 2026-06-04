import type pg from 'pg'
import type { AgentHarness } from '../fleet-executor/harness.js'
import { ensurePendingApproval } from '../approvals.js'
import {
  appendThreadMessage,
  createDelegation,
  createWorkItem,
  getPrimeProfile,
  insertRuntimeEvent,
  updateWorkItem,
  type Delegation,
  type WorkItem,
} from '../runtime.js'
import { readProfileFiles, writeProfileFiles } from '../workspace.js'
import {
  routeWorkRequest,
  recordRoutingOutcome,
  findExistingBlocker,
  assertDomainRoleAssignment,
  type RoutingRequest,
  type RoutingOutcome,
} from '../routing/index.js'
import type { PrimeContext } from './context.js'
import type { PrimeAction, PrimeDecision } from './llm-router.js'
import { transitionGoalStatus, updateGoal } from '../goals/service.js'
import { createLearningRecord } from '../learning/service.js'
import { LearningCategory, LearningSignalType, LearningConfidence } from '../learning/types.js'
import { createWorkItem as createWorkItemGoal } from '../goals/work-item-service.js'
import type { WorkItem as GoalWorkItem } from '../goals/types.js'
import { broadcastEvent } from '../ws/control-plane-events.js'
import {
  SECTION_DEFS,
  type SectionKey,
} from './profile-sections.js'

export interface PrimeActionDispatchResult {
  action: PrimeAction
  status: 'dispatched'
  work_item?: WorkItem | null
  delegation?: Delegation | null
  approval?: {
    approval_id: string
    run_id: string
    action: string
    status: string
  }
}

export async function dispatchPrimeActions(
  pool: pg.Pool,
  ctx: PrimeContext,
  decision: PrimeDecision,
  getHarness: (agentId: string) => AgentHarness | undefined,
): Promise<PrimeActionDispatchResult[]> {
  const results: PrimeActionDispatchResult[] = []

  for (const action of decision.actions) {
    if (action.type === 'delegate' && requiresApprovalGate(action)) {
      results.push(await dispatchRequestApprovalForAction(pool, ctx, action))
      continue
    }

    switch (action.type) {
      case 'delegate':
        results.push(await dispatchRoutingDelegate(pool, ctx, action, getHarness))
        break
      case 'update_work_item':
        results.push(await dispatchUpdateWorkItem(pool, ctx, action))
        break
      case 'request_approval':
        results.push(await dispatchRequestApproval(pool, ctx, action))
        break
      case 'update_profile':
        results.push(await dispatchUpdateProfile(pool, ctx, action))
        break
      case 'no_op':
        results.push(await dispatchNoOp(pool, ctx, action))
        break
      default:
        throw new Error(`Unsupported Prime action type: ${(action as { type: string }).type}`)
    }
  }

  return results
}

async function dispatchRoutingDelegate(
  pool: pg.Pool,
  ctx: PrimeContext,
  action: PrimeAction,
  getHarness: (agentId: string) => AgentHarness | undefined,
): Promise<PrimeActionDispatchResult> {
  const coordinatorName = await getCoordinatorName(pool)
  const title = normalizedTitle(
    stringField(action.payload, 'title'),
    descriptionLikeField(action.payload, 'description'),
    action.reason,
    fallbackTitle(ctx, 'Prime delegation')
  )
  const description = stringField(action.payload, 'description') || action.reason
  const capability = stringField(action.payload, 'capability') || 'general'
  const threadId = resolveThreadId(ctx, stringField(action.payload, 'thread_id'))
  const preferredRole = stringField(action.payload, 'preferred_role')
  const allowEphemeralSpawn = action.payload.allow_ephemeral_spawn !== false

  // Build a routing request (FR-002, FR-007)
  const routingRequest: RoutingRequest = {
    id: crypto.randomUUID(),
    workClass: capability,
    preferredRole,
    constraints: {
      requiredCapabilities: [capability],
      allowEphemeralSpawn,
    },
    threadId,
    source: 'prime-agent',
    createdAt: new Date().toISOString(),
  }

  // Route through the routing layer to validate executable runtime availability (FR-002)
  const outcome = await routeWorkRequest(
    { pool, getHarness },
    routingRequest,
  )

  // Record the outcome for audit and deduplication (FR-011)
  await recordRoutingOutcome(pool, routingRequest, outcome)

  // Handle each outcome type
  switch (outcome.type) {
    case 'dispatch_existing': {
      return await handleDispatchOutcome(
        pool, ctx, action, title, description, capability, threadId, outcome,
      )
    }

    case 'spawn_ephemeral': {
      return await handleSpawnOutcome(
        pool, ctx, action, title, description, capability, threadId, outcome,
      )
    }

    case 'blocked_missing_capability': {
      return await handleBlockedOutcome(
        pool, ctx, action, title, description, capability, threadId, outcome,
      )
    }

    case 'blocked_runtime_unavailable': {
      return await handleBlockedOutcome(
        pool, ctx, action, title, description, capability, threadId, outcome,
      )
    }

    default:
      // For investigate or request_user_decision, create a pending work item
      return await handlePendingOutcome(
        pool, ctx, action, title, description, capability, threadId, outcome,
      )
  }
}

async function handleDispatchOutcome(
  pool: pg.Pool,
  ctx: PrimeContext,
  action: PrimeAction,
  title: string,
  description: string,
  capability: string,
  threadId: string | undefined,
  outcome: Extract<RoutingOutcome, { type: 'dispatch_existing' }>,
): Promise<PrimeActionDispatchResult> {
  const coordinatorName = await getCoordinatorName(pool)

  const workItem = await createWorkItem(pool, {
    title,
    description,
    status: 'active',
    lane: 'operations',
    owner_label: coordinatorName,
    thread_id: threadId,
    metadata: {
      source: 'prime-agent',
      action_type: action.type,
      capability,
      reason: action.reason,
      routing_outcome: outcome.type,
    },
  })

  const delegation = await createDelegation(pool, {
    work_item_id: workItem.id,
    to_agent_id: outcome.targetAgent.id,
    capability,
    request: {
      content: description,
      thread_id: threadId,
      source: 'prime-agent',
      target_agent_id: outcome.targetAgent.id,
      payload: action.payload,
    },
  })

  await insertRuntimeEvent(pool, {
    event_type: 'prime.action.delegate',
    actor: coordinatorName,
    thread_id: threadId,
    work_item_id: workItem.id,
    delegation_id: delegation.id,
    payload: {
      capability,
      target_agent_id: outcome.targetAgent.id,
      routing_outcome: outcome.type,
      reason: action.reason,
    },
  })

  return {
    action,
    status: 'dispatched',
    work_item: workItem,
    delegation,
  }
}

async function handleSpawnOutcome(
  pool: pg.Pool,
  ctx: PrimeContext,
  action: PrimeAction,
  title: string,
  description: string,
  capability: string,
  threadId: string | undefined,
  outcome: Extract<RoutingOutcome, { type: 'spawn_ephemeral' }>,
): Promise<PrimeActionDispatchResult> {
  const coordinatorName = await getCoordinatorName(pool)

  const workItem = await createWorkItem(pool, {
    title,
    description,
    status: 'active',
    lane: 'operations',
    owner_label: coordinatorName,
    thread_id: threadId,
    metadata: {
      source: 'prime-agent',
      action_type: action.type,
      capability,
      reason: action.reason,
      routing_outcome: outcome.type,
      template_id: outcome.templateId,
    },
  })

  const delegation = await createDelegation(pool, {
    work_item_id: workItem.id,
    to_agent_id: undefined,
    capability,
    request: {
      content: description,
      thread_id: threadId,
      source: 'prime-agent',
      template_id: outcome.templateId,
      spawn_context: outcome.spawnContext,
      payload: action.payload,
    },
  })

  await insertRuntimeEvent(pool, {
    event_type: 'prime.action.delegate',
    actor: coordinatorName,
    thread_id: threadId,
    work_item_id: workItem.id,
    delegation_id: delegation.id,
    payload: {
      capability,
      routing_outcome: outcome.type,
      template_id: outcome.templateId,
      reason: action.reason,
    },
  })

  return {
    action,
    status: 'dispatched',
    work_item: workItem,
    delegation,
  }
}

async function handleBlockedOutcome(
  pool: pg.Pool,
  ctx: PrimeContext,
  action: PrimeAction,
  title: string,
  description: string,
  capability: string,
  threadId: string | undefined,
  outcome: RoutingOutcome,
): Promise<PrimeActionDispatchResult> {
  const coordinatorName = await getCoordinatorName(pool)

  // Deduplication: check if a pending work item already exists for this blocker (FR-011)
  const existingPendingWorkItem = await findReusablePendingDelegationWorkItem(
    pool,
    { title, capability, threadId },
  )

  const blockerType = 'blockerType' in outcome ? (outcome as { blockerType: string }).blockerType : 'unknown'
  const explanation = 'explanation' in outcome ? (outcome as { explanation?: string }).explanation ?? '' : ''
  const remediations = 'suggestedRemediations' in outcome
    ? (outcome as { suggestedRemediations?: Array<{ action: string; description: string }> }).suggestedRemediations ?? []
    : []

  if (existingPendingWorkItem) {
    await insertRuntimeEvent(pool, {
      event_type: 'prime.action.no_op',
      actor: coordinatorName,
      thread_id: threadId,
      work_item_id: existingPendingWorkItem.id,
      payload: {
        capability,
        routing_outcome: outcome.type,
        blockerType,
        reason: `Routing blocked: ${explanation}. Reusing pending work item ${existingPendingWorkItem.id}.`,
        suggested_remediations: remediations,
      },
    })

    return {
      action: {
        type: 'no_op',
        payload: action.payload,
        reason: `Routing blocked (${outcome.type}): ${explanation} Reusing pending work item ${existingPendingWorkItem.id}.`,
      },
      status: 'dispatched',
      work_item: existingPendingWorkItem,
    }
  }

  // Create a pending work item with structured routing outcome (FR-003, FR-005)
  const pendingWorkItem = await createWorkItem(pool, {
    title,
    description,
    status: 'pending',
    lane: 'operations',
    owner_label: coordinatorName,
    thread_id: threadId,
    metadata: {
      source: 'prime-agent',
      action_type: 'pending_delegation',
      capability,
      routing_outcome: outcome.type,
      blockerType,
      explanation,
      suggested_remediations: remediations,
      requested_target_id: resolveAgentId(ctx, stringField(action.payload, 'target_agent_id')) ?? null,
    },
  })

  await insertRuntimeEvent(pool, {
    event_type: 'prime.action.no_op',
    actor: coordinatorName,
    thread_id: threadId,
    work_item_id: pendingWorkItem.id,
    payload: {
      capability,
      routing_outcome: outcome.type,
      blockerType,
      reason: `Routing blocked: ${explanation} Work item ${pendingWorkItem.id} created in pending state.`,
      suggested_remediations: remediations,
    },
  })

  return {
    action: {
      type: 'no_op',
      payload: action.payload,
      reason: `Routing blocked (${outcome.type}): ${explanation} Work item ${pendingWorkItem.id} created in pending state.`,
    },
    status: 'dispatched',
    work_item: pendingWorkItem,
  }
}

async function handlePendingOutcome(
  pool: pg.Pool,
  ctx: PrimeContext,
  action: PrimeAction,
  title: string,
  description: string,
  capability: string,
  threadId: string | undefined,
  outcome: RoutingOutcome,
): Promise<PrimeActionDispatchResult> {
  const coordinatorName = await getCoordinatorName(pool)

  // For investigate or request_user_decision outcomes, create a pending work item
  const pendingWorkItem = await createWorkItem(pool, {
    title,
    description,
    status: 'pending',
    lane: 'operations',
    owner_label: coordinatorName,
    thread_id: threadId,
    metadata: {
      source: 'prime-agent',
      action_type: 'pending_delegation',
      capability,
      routing_outcome: outcome.type,
      explanation: 'explanation' in outcome ? (outcome as { explanation?: string }).explanation ?? '' : '',
    },
  })

  await insertRuntimeEvent(pool, {
    event_type: 'prime.action.no_op',
    actor: coordinatorName,
    thread_id: threadId,
    work_item_id: pendingWorkItem.id,
    payload: {
      capability,
      routing_outcome: outcome.type,
      reason: `Routing outcome '${outcome.type}' requires manual handling. Work item ${pendingWorkItem.id} created.`,
    },
  })

  return {
    action: {
      type: 'no_op',
      payload: action.payload,
      reason: `Routing outcome '${outcome.type}'. Work item ${pendingWorkItem.id} created for manual handling.`,
    },
    status: 'dispatched',
    work_item: pendingWorkItem,
  }
}

async function dispatchUpdateWorkItem(
  pool: pg.Pool,
  ctx: PrimeContext,
  action: PrimeAction
): Promise<PrimeActionDispatchResult> {
  const coordinatorName = await getCoordinatorName(pool)
  const workItemId = stringField(action.payload, 'work_item_id')
  const resolvedWorkItemId = resolveWorkItemId(ctx, workItemId)
  if (!resolvedWorkItemId) {
    const reason = workItemId
      ? `Cannot update work item: '${workItemId}' did not resolve to a unique known work item.`
      : 'Cannot update work item: action payload did not include work_item_id.'
    await insertRuntimeEvent(pool, {
      event_type: 'prime.action.no_op',
      actor: coordinatorName,
      thread_id: threadIdFromContext(ctx),
      payload: {
        reason,
        action_type: 'update_work_item',
        payload: action.payload,
      },
    })
    return {
      action: {
        type: 'no_op',
        payload: action.payload,
        reason,
      },
      status: 'dispatched',
    }
  }

  const workItem = await updateWorkItem(pool, resolvedWorkItemId, {
    title: stringField(action.payload, 'title'),
    description: stringField(action.payload, 'description'),
    status: stringField(action.payload, 'status'),
    priority: stringField(action.payload, 'priority'),
    lane: stringField(action.payload, 'lane'),
    blocked_by: stringField(action.payload, 'blocked_by'),
    owner_agent_id: resolveAgentId(ctx, stringField(action.payload, 'owner_agent_id')),
    owner_label: stringField(action.payload, 'owner_label'),
    metadata: objectField(action.payload, 'metadata'),
  })

  if (!workItem) {
    throw new Error(`work item not found: ${resolvedWorkItemId}`)
  }

  await insertRuntimeEvent(pool, {
    event_type: 'prime.action.update_work_item',
    actor: coordinatorName,
    work_item_id: workItem.id,
    payload: {
      reason: action.reason,
      status: workItem.status,
    },
  })

  return {
    action,
    status: 'dispatched',
    work_item: workItem,
  }
}

async function dispatchRequestApprovalForAction(
  pool: pg.Pool,
  ctx: PrimeContext,
  action: PrimeAction,
): Promise<PrimeActionDispatchResult> {
  const approvalAction: PrimeAction = {
    type: 'request_approval',
    reason: action.reason,
    payload: {
      ...action.payload,
      title: stringField(action.payload, 'title') ?? 'Approval required before delegated action',
      action: stringField(action.payload, 'description') ?? action.reason,
      risk_summary: stringField(action.payload, 'risk_summary') ?? 'Marked high-impact by planner.',
      goal_id: stringField(action.payload, 'goal_id'),
      gated_action: action,
    },
  }
  return dispatchRequestApproval(pool, ctx, approvalAction)
}

async function dispatchRequestApproval(
  pool: pg.Pool,
  _ctx: PrimeContext,
  action: PrimeAction
): Promise<PrimeActionDispatchResult> {
  const coordinatorName = await getCoordinatorName(pool)

  // Extract structured fields from payload, fall back to reason
  const approvalTitle = normalizedTitle(
    stringField(action.payload, 'title'),
    stringField(action.payload, 'action'),
    stringField(action.payload, 'description'),
    action.reason,
    'Approval request'
  )
  const approvalDescription = stringField(action.payload, 'description')
    || stringField(action.payload, 'reason')
    || action.reason
  const approvalAction = stringField(action.payload, 'action')
    || stringField(action.payload, 'title')
    || action.reason

  if (!approvalAction) {
    throw new Error('request_approval requires action text')
  }

  // Deduplication: check if a similar pending approval already exists
  const normalizedAction = approvalTitle.toLowerCase().replace(/\s+/g, ' ').trim()
  const newKeywords = extractKeywords(normalizedAction)

  const { rows: existingApprovals } = await pool.query(
    `SELECT id AS approval_id,
            COALESCE(action_summary, action) AS action,
            COALESCE(work_item_id, run_id) AS run_id,
            status, created_at::text
     FROM approvals
     WHERE status = 'pending'
     ORDER BY created_at DESC
     LIMIT 20`
  )

  // First try exact match, then fall back to keyword overlap (≥3 shared keywords)
  let existingMatch = existingApprovals.find((a: { action: string }) =>
    a.action.toLowerCase().replace(/\s+/g, ' ').trim() === normalizedAction
  )
  if (!existingMatch) {
    for (const candidate of existingApprovals) {
      const candidateKeywords = extractKeywords(candidate.action.toLowerCase().replace(/\s+/g, ' ').trim())
      const sharedKeywords = newKeywords.filter((kw: string) => candidateKeywords.includes(kw))
      if (sharedKeywords.length >= 3) {
        existingMatch = candidate
        break
      }
    }
  }
  if (existingMatch) {
    // Reuse the existing approval instead of creating a duplicate
    const existingWorkItem = await pool.query(
      `SELECT id, title, description, status, lane, owner_label, metadata, created_at::text, updated_at::text
       FROM work_items WHERE id = $1`,
      [existingMatch.run_id]
    )
    return {
      action,
      status: 'dispatched',
      work_item: existingWorkItem.rows[0] ?? null,
      approval: {
        approval_id: existingMatch.approval_id,
        run_id: existingMatch.run_id,
        action: existingMatch.action,
        status: existingMatch.status,
      },
    }
  }

  const approver = stringField(action.payload, 'approver') || 'human'
  const context = objectField(action.payload, 'context') ?? {}
  const goalId = stringField(action.payload, 'goal_id')
  const riskSummary = stringField(action.payload, 'risk_summary')

  const workItem = await createWorkItem(pool, {
    title: approvalTitle,
    description: approvalDescription,
    lane: 'approval',
    status: 'approval',
    owner_label: approver === 'human' ? 'Human approval' : 'Approval flow',
    metadata: {
      source: 'prime-agent',
      approver,
      context,
      reason: action.reason,
    },
  })

  const approval = await ensurePendingApproval(pool, {
    approval_id: `prime:${workItem.id}`,
    run_id: workItem.id,
    action: approvalTitle,
  })

  await pool.query(
    `INSERT INTO approvals (id, goal_id, work_item_id, requested_by_agent_role, action_summary, risk_summary, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     ON CONFLICT (id) DO UPDATE
       SET action_summary = EXCLUDED.action_summary,
           risk_summary = EXCLUDED.risk_summary,
           status = 'pending'`,
    [approval.approval_id, goalId ?? `goal_${workItem.id}`, workItem.id, 'prime', approvalTitle, riskSummary ?? null],
  ).catch(() => undefined)

  if (goalId) {
    await transitionGoalStatus(pool, goalId, 'awaiting_approval').catch(() => undefined)
  }

  broadcastEvent({
    type: 'approval.requested',
    occurredAt: new Date().toISOString(),
    goalId,
    payload: {
      id: approval.approval_id,
      goalId,
      workItemId: workItem.id,
      requestedByAgentRole: 'prime',
      actionSummary: approvalTitle,
      riskSummary: riskSummary ?? null,
      status: 'pending',
    },
  })

  let delegation: Delegation | undefined
  const targetAgentId = approver === 'human' || approver === 'prime'
    ? undefined
    : resolveAgentId(_ctx, approver)
  if (targetAgentId) {
    delegation = await createDelegation(pool, {
      work_item_id: workItem.id,
      to_agent_id: targetAgentId,
      capability: 'approval',
      request: {
        content: approvalAction,
        context,
        approval_id: approval.approval_id,
        source: 'prime-agent',
      },
    })
  }

  await insertRuntimeEvent(pool, {
    event_type: 'prime.action.request_approval',
    actor: coordinatorName,
    work_item_id: workItem.id,
    delegation_id: delegation?.id,
    payload: {
      approval_id: approval.approval_id,
      approver,
      context,
      reason: action.reason,
    },
  })

  return {
    action,
    status: 'dispatched',
    work_item: workItem,
    delegation,
    approval,
  }
}

async function dispatchNoOp(
  pool: pg.Pool,
  ctx: PrimeContext,
  action: PrimeAction
): Promise<PrimeActionDispatchResult> {
  const coordinatorName = await getCoordinatorName(pool)
  await insertRuntimeEvent(pool, {
    event_type: 'prime.action.no_op',
    actor: coordinatorName,
    thread_id: stringField(action.payload, 'thread_id') ?? threadIdFromContext(ctx),
    payload: {
      reason: action.reason,
      payload: action.payload,
    },
  })

  return {
    action,
    status: 'dispatched',
  }
}

function unifiedDiff(oldText: string, newText: string, label: string): string {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const lines: string[] = [`--- ${label} (current)`, `+++ ${label} (proposed)`]
  for (const line of oldLines) lines.push(`-${line}`)
  for (const line of newLines) lines.push(`+${line}`)
  return lines.join('\n')
}

async function dispatchUpdateProfile(
  pool: pg.Pool,
  ctx: PrimeContext,
  action: PrimeAction,
): Promise<PrimeActionDispatchResult> {
  const sectionKey = stringField(action.payload, 'section_key') as SectionKey | undefined
  const newText = typeof action.payload.new_text === 'string' ? action.payload.new_text : undefined
  if (!sectionKey || !(sectionKey in SECTION_DEFS)) {
    throw new Error(`update_profile: unknown section key ${String(sectionKey)}`)
  }
  if (typeof newText !== 'string') {
    throw new Error('update_profile: new_text required')
  }

  const file = SECTION_DEFS[sectionKey].file
  const heading = SECTION_DEFS[sectionKey].heading
  const current = await readProfileFiles(pool)
  const previous = current[file].sections[sectionKey] ?? ''
  current[file].sections[sectionKey] = newText
  await writeProfileFiles(pool, current)

  const coordinatorName = await getCoordinatorName(pool)
  const threadId = stringField(action.payload, 'thread_id') ?? threadIdFromContext(ctx)
  const diff = unifiedDiff(previous, newText, heading)
  if (threadId) {
    await appendThreadMessage(pool, threadId, {
      role: 'assistant',
      sender: coordinatorName,
      content: [
        `Updated **${heading}**. Reason: ${action.reason}`,
        '',
        '```diff',
        diff,
        '```',
      ].join('\n'),
      metadata: {
        kind: 'profile-update',
        section_key: sectionKey,
        file,
      },
    })
  }

  await insertRuntimeEvent(pool, {
    event_type: 'prime.action.update_profile',
    actor: coordinatorName,
    thread_id: threadId,
    payload: {
      file,
      section_key: sectionKey,
      reason: action.reason,
    },
  })

  return { action, status: 'dispatched' }
}

async function getCoordinatorName(pool: pg.Pool): Promise<string> {
  const primeProfile = await getPrimeProfile(pool)
  return primeProfile.name.trim() || 'Prime'
}

function selectTargetAgent(
  ctx: PrimeContext,
  capability: string,
  requestedTargetId?: string
) {
  if (requestedTargetId) {
    return ctx.fleet.agents.find((agent) => agent.id === requestedTargetId)
  }

  return ctx.fleet.agents.find((agent) =>
    Array.isArray(agent.capabilities) && agent.capabilities.includes(capability)
  )
}

function threadIdFromContext(ctx: PrimeContext): string | undefined {
  return ctx.trigger.type === 'prime.message' ? ctx.trigger.payload.thread_id : undefined
}

function resolveThreadId(ctx: PrimeContext, candidate?: string): string | undefined {
  const fallback = threadIdFromContext(ctx)
  if (!candidate) return fallback
  if (isUuid(candidate)) return candidate
  return fallback && fallback.startsWith(candidate) ? fallback : fallback
}

function resolveAgentId(ctx: PrimeContext, candidate?: string): string | undefined {
  if (!candidate) return undefined
  if (isUuid(candidate)) return candidate

  const normalized = candidate.trim().toLowerCase()
  const matches = ctx.fleet.agents.filter((agent) =>
    agent.id.toLowerCase().startsWith(normalized)
    || agent.name.trim().toLowerCase() === normalized
  )
  return matches.length === 1 ? matches[0].id : undefined
}

function resolveWorkItemId(ctx: PrimeContext, candidate?: string): string | undefined {
  if (!candidate) return undefined
  if (isUuid(candidate)) return candidate

  const normalized = candidate.trim().toLowerCase()
  const matches = ctx.fleet.workItems.filter((workItem) =>
    workItem.id.toLowerCase().startsWith(normalized)
  )
  return matches.length === 1 ? matches[0].id : undefined
}

function fallbackTitle(ctx: PrimeContext, fallback: string): string {
  if (ctx.trigger.type === 'prime.message') {
    return titleFromPrompt(ctx.trigger.payload.content, fallback)
  }
  return fallback
}

async function findReusablePendingDelegationWorkItem(
  pool: pg.Pool,
  input: {
    title: string
    capability: string
    threadId?: string
  }
): Promise<WorkItem | null> {
  const { rows } = await pool.query<WorkItem>(
    `SELECT *
     FROM work_items
     WHERE title = $1
       AND status = 'pending'
       AND lane = 'operations'
       AND COALESCE(thread_id::text, '') = COALESCE($2, '')
       AND metadata->>'action_type' = 'pending_delegation'
       AND metadata->>'capability' = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.title, input.threadId ?? null, input.capability]
  )
  return rows[0] ?? null
}

function missingCapabilityRemediation(ctx: PrimeContext, capability: string): string {
  const availableAgents = ctx.fleet.agents
    .map((agent) => agent.name.trim())
    .filter(Boolean)
    .slice(0, 3)

  if (availableAgents.length === 0) {
    return `Suggested fix: create a new enabled agent that advertises capability '${capability}'.`
  }

  return `Suggested fix: add capability '${capability}' to one of the existing agents (${availableAgents.join(', ')}) or create a new enabled agent for it.`
}

function normalizedTitle(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const normalized = titleFromPrompt(candidate, '')
    if (normalized) return normalized
  }
  return 'Untitled work item'
}

function descriptionLikeField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
}

function titleFromPrompt(prompt: string, fallback: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (!normalized) return fallback
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized
}

function requiresApprovalGate(action: PrimeAction): boolean {
  if (action.type !== 'delegate') return false
  return action.payload.high_impact === true
    || action.payload.irreversible === true
    || action.payload.requires_approval === true
}

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function objectField(payload: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = payload[key]
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'shall', 'can', 'need', 'dare', 'ought', 'used',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'because', 'but', 'and', 'or', 'if', 'while', 'this', 'that', 'these',
  'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its',
  'they', 'them', 'their', 'what', 'which', 'who', 'whom',
  'any', 'must', 'required', 'proceeding', 'proceed', 'proceeds',
  'without', 'explicit', 'user', 'approval', 'standing', 'rules',
  'per', 'mandate', 'require', 'requires', 'prohibit', 'prohibits',
  'initiating', 'initiate', 'initiated', 'cannot',
  'next', 'smallest', 'useful', 'step', 'break', 'logjam', 'efficiently',
  'compliance', 'maintain', 'enable', 'unblock', 'progress',
  'granted', 'yet', 'currently', 'exists', 'exist', 'none',
])

function extractKeywords(text: string): string[] {
  return text
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
}

// ─── Goal lifecycle actions ─────────────────────────────────────

/**
 * Update the current progress summary for an in-progress goal.
 * Broadcasts a goal.updated event.
 */
export async function updateGoalProgress(
  pool: pg.Pool,
  goalId: string,
  summary: string,
): Promise<void> {
  await updateGoal(pool, goalId, { currentSummary: summary });
  broadcastEvent({
    type: 'goal.updated',
    occurredAt: new Date().toISOString(),
    goalId,
    payload: { status: 'in_progress', currentSummary: summary },
  });
}

/**
 * Transition a goal to completed state.
 * Sets result_summary and optional risk_summary.
 * Broadcasts goal.completed and goal.updated events.
 */
export async function completeGoal(
  pool: pg.Pool,
  goalId: string,
  resultSummary: string,
  riskSummary?: string,
): Promise<void> {
  await transitionGoalStatus(pool, goalId, 'completed');
  await updateGoal(pool, goalId, { resultSummary, riskSummary });
  broadcastEvent({
    type: 'goal.completed',
    occurredAt: new Date().toISOString(),
    goalId,
    payload: {
      status: 'completed',
      resultSummary,
      followUpRequired: !!riskSummary,
    },
  });
  const learningRecord = await createLearningRecord(pool, {
    goalId,
    category: LearningCategory.Planning,
    signalType: LearningSignalType.Success,
    observation: resultSummary,
    recommendation: riskSummary ?? 'Re-use this execution pattern for similar goals.',
    confidence: LearningConfidence.Medium,
  })
  broadcastEvent({
    type: 'learning-record.created',
    occurredAt: new Date().toISOString(),
    goalId,
    payload: learningRecord as unknown as Record<string, unknown>,
  })
}

/**
 * Transition a goal to failed state.
 * Sets result_summary with failure reason.
 * Broadcasts a goal.updated event.
 */
export async function failGoal(
  pool: pg.Pool,
  goalId: string,
  failureReason: string,
): Promise<void> {
  const resultSummary = `Failed: ${failureReason}`;
  await transitionGoalStatus(pool, goalId, 'failed');
  await updateGoal(pool, goalId, { resultSummary });
  broadcastEvent({
    type: 'goal.updated',
    occurredAt: new Date().toISOString(),
    goalId,
    payload: { status: 'failed', resultSummary },
  });
  const learningRecord = await createLearningRecord(pool, {
    goalId,
    category: LearningCategory.Recovery,
    signalType: LearningSignalType.Failure,
    observation: failureReason,
    recommendation: 'Review blockers and add preventive checks before delegation.',
    confidence: LearningConfidence.Medium,
  })
  broadcastEvent({
    type: 'learning-record.created',
    occurredAt: new Date().toISOString(),
    goalId,
    payload: learningRecord as unknown as Record<string, unknown>,
  })
}

/**
 * Transition a goal to blocked state.
 * Sets risk_summary with the blocking reason.
 * Broadcasts a goal.updated event.
 */
export async function blockGoal(
  pool: pg.Pool,
  goalId: string,
  reason: string,
): Promise<void> {
  await transitionGoalStatus(pool, goalId, 'blocked');
  await updateGoal(pool, goalId, { riskSummary: reason });
  broadcastEvent({
    type: 'goal.updated',
    occurredAt: new Date().toISOString(),
    goalId,
    payload: { status: 'blocked', riskSummary: reason },
  });
}

/**
 * Goal-level delegation action.
 * Creates a WorkItem linked to a goal, transitions it to in_progress,
 * and broadcasts a work-item.created event.
 */
export interface DelegateAction {
  assignedAgentRole: string;
  domain?: string;
  title: string;
  scope?: string;
  dependsOn?: string[] | null;
}

export async function dispatchDelegate(
  pool: pg.Pool,
  goalId: string,
  delegateAction: DelegateAction,
): Promise<GoalWorkItem> {
  const domain = (delegateAction.domain ?? 'cross_domain') as import('../goals/types.js').Domain
  await assertDomainRoleAssignment(pool, domain, delegateAction.assignedAgentRole)

  // 1. Create Goal work-item in queued state
  const workItem = await createWorkItemGoal(pool, {
    goalId,
    assignedAgentRole: delegateAction.assignedAgentRole,
    domain,
    title: delegateAction.title,
    scope: delegateAction.scope,
    dependsOn: delegateAction.dependsOn,
    status: 'queued',
  });

  const { rows: targetRows } = await pool.query<{ id: string }>(
    `SELECT id
     FROM agents
     WHERE enabled = true
       AND (
         role = $1
         OR lower(name) = lower($1)
       )
     ORDER BY created_at ASC
     LIMIT 1`,
    [delegateAction.assignedAgentRole],
  )
  const targetAgentId = targetRows[0]?.id

  // 2. Link work-item to fleet dispatcher via queued delegation record.
  // TODO(T023): pass richer dispatcher request fields once Prime emits full delegation payload contract.
  await createDelegation(pool, {
    work_item_id: workItem.id,
    to_agent_id: targetAgentId,
    capability: domain,
    request: {
      title: delegateAction.title,
      description: delegateAction.scope ?? delegateAction.title,
      source: 'prime-agent',
      goal_id: goalId,
      assigned_agent_role: delegateAction.assignedAgentRole,
      domain,
    },
  })

  // 3. Broadcast creation for control-plane live updates
  broadcastEvent({
    type: 'work-item.created',
    occurredAt: new Date().toISOString(),
    goalId,
    payload: {
      workItemId: workItem.id,
      assignedAgentRole: delegateAction.assignedAgentRole,
      domain,
      title: delegateAction.title,
      status: 'queued',
    },
  });

  return workItem;
}
