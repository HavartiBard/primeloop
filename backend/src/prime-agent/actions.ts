import type pg from 'pg'
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
import type { PrimeContext } from './context.js'
import type { PrimeAction, PrimeDecision } from './llm-router.js'
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

  // Extract structured fields from payload, fall back to reason
  const approvalTitle = stringField(action.payload, 'title')
    || stringField(action.payload, 'action')
    || titleFromPrompt(action.reason, 'Approval request')
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
    `SELECT approval_id, action, run_id, status, created_at::text
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

