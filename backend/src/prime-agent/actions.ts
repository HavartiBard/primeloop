import type pg from 'pg'
import { ensurePendingApproval } from '../approvals.js'
import {
  createDelegation,
  createWorkItem,
  getPrimeProfile,
  insertRuntimeEvent,
  updateWorkItem,
  type Delegation,
  type WorkItem,
} from '../runtime.js'
import type { PrimeContext } from './context.js'
import type { PrimeAction, PrimeDecision } from './llm-router.js'

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
  decision: PrimeDecision
): Promise<PrimeActionDispatchResult[]> {
  const results: PrimeActionDispatchResult[] = []

  for (const action of decision.actions) {
    switch (action.type) {
      case 'delegate':
        results.push(await dispatchDelegate(pool, ctx, action))
        break
      case 'update_work_item':
        results.push(await dispatchUpdateWorkItem(pool, ctx, action))
        break
      case 'request_approval':
        results.push(await dispatchRequestApproval(pool, ctx, action))
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

async function dispatchDelegate(
  pool: pg.Pool,
  ctx: PrimeContext,
  action: PrimeAction
): Promise<PrimeActionDispatchResult> {
  const coordinatorName = await getCoordinatorName(pool)
  const title = stringField(action.payload, 'title') || fallbackTitle(ctx, 'Prime delegation')
  const description = stringField(action.payload, 'description') || action.reason
  const capability = stringField(action.payload, 'capability') || 'general'
  const threadId = stringField(action.payload, 'thread_id')
  const requestedTargetId = stringField(action.payload, 'target_agent_id')
  const targetAgent = selectTargetAgent(ctx, capability, requestedTargetId)

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
    },
  })

  const delegation = await createDelegation(pool, {
    work_item_id: workItem.id,
    to_agent_id: targetAgent?.id,
    capability,
    request: {
      content: description,
      thread_id: threadId,
      source: 'prime-agent',
      target_agent_id: targetAgent?.id,
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
      target_agent_id: targetAgent?.id,
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

async function dispatchUpdateWorkItem(
  pool: pg.Pool,
  _ctx: PrimeContext,
  action: PrimeAction
): Promise<PrimeActionDispatchResult> {
  const coordinatorName = await getCoordinatorName(pool)
  const workItemId = stringField(action.payload, 'work_item_id')
  if (!workItemId) {
    throw new Error('update_work_item requires work_item_id')
  }

  const workItem = await updateWorkItem(pool, workItemId, {
    title: stringField(action.payload, 'title'),
    description: stringField(action.payload, 'description'),
    status: stringField(action.payload, 'status'),
    priority: stringField(action.payload, 'priority'),
    lane: stringField(action.payload, 'lane'),
    blocked_by: stringField(action.payload, 'blocked_by'),
    owner_agent_id: stringField(action.payload, 'owner_agent_id'),
    owner_label: stringField(action.payload, 'owner_label'),
    metadata: objectField(action.payload, 'metadata'),
  })

  if (!workItem) {
    throw new Error(`work item not found: ${workItemId}`)
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

async function dispatchRequestApproval(
  pool: pg.Pool,
  _ctx: PrimeContext,
  action: PrimeAction
): Promise<PrimeActionDispatchResult> {
  const coordinatorName = await getCoordinatorName(pool)
  const approvalAction = stringField(action.payload, 'action') || action.reason
  if (!approvalAction) {
    throw new Error('request_approval requires action text')
  }

  const approver = stringField(action.payload, 'approver') || 'human'
  const context = objectField(action.payload, 'context') ?? {}

  const workItem = await createWorkItem(pool, {
    title: titleFromPrompt(approvalAction, 'Approval request'),
    description: approvalAction,
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
    action: approvalAction,
  })

  let delegation: Delegation | undefined
  const targetAgentId = approver === 'human' || approver === 'prime' ? undefined : approver
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

function fallbackTitle(ctx: PrimeContext, fallback: string): string {
  if (ctx.trigger.type === 'prime.message') {
    return titleFromPrompt(ctx.trigger.payload.content, fallback)
  }
  return fallback
}

function titleFromPrompt(prompt: string, fallback: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (!normalized) return fallback
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized
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
