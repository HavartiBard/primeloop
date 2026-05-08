import type pg from 'pg'

export interface LoopWarning {
  agent_id: string
  kind: 'repeated-failure' | 'prompt-loop' | 'stall-retry' | 'approval-churn'
  severity: 'info' | 'warn' | 'error'
  summary: string
  evidence: Record<string, unknown>
  created_at: string
}

interface DelegationRecord {
  id: string
  from_agent_id?: string
  to_agent_id?: string
  capability: string
  status: string
  request: Record<string, unknown>
  result: Record<string, unknown>
  updated_at: string
}

interface ApprovalRecord {
  approval_id: string
  run_id: string
  action: string
  status: string
  created_at: string
}

interface RuntimeEventRecord {
  id: string
  event_type: string
  delegation_id?: string
  payload: Record<string, unknown>
  created_at: string
}

function normalizePrompt(request: Record<string, unknown>): string {
  const content = typeof request['content'] === 'string'
    ? request['content']
    : typeof request['prompt'] === 'string'
      ? request['prompt']
      : ''
  return content.trim().replace(/\s+/g, ' ').toLowerCase()
}

function summarizePromptLoop(capability: string, prompt: string, count: number): string {
  const excerpt = prompt.length > 72 ? `${prompt.slice(0, 69)}...` : prompt
  return `Repeated prompt loop detected for ${capability} (${count} similar attempts): ${excerpt || 'empty prompt'}`
}

function summarizeRepeatedFailure(capability: string, count: number): string {
  return `${count} recent failed delegations for capability ${capability}`
}

function summarizeStallRetry(capability: string, count: number): string {
  return `${count} retry/stall events detected for capability ${capability}`
}

function summarizeApprovalChurn(action: string, count: number): string {
  const excerpt = action.length > 72 ? `${action.slice(0, 69)}...` : action
  return `${count} approval requests repeated for the same action: ${excerpt}`
}

export async function detectLoopWarnings(
  pool: pg.Pool,
  agentId: string,
  options: { limit?: number } = {},
): Promise<LoopWarning[]> {
  const limit = Math.max(10, Math.min(options.limit ?? 50, 200))

  const [delegationRes, approvalRes, eventRes] = await Promise.all([
    pool.query<DelegationRecord>(
      `SELECT id, from_agent_id, to_agent_id, capability, status, request, result, updated_at::text
       FROM delegations
       WHERE from_agent_id = $1 OR to_agent_id = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [agentId, limit],
    ),
    pool.query<ApprovalRecord>(
      `SELECT approval_id, run_id, action, status, created_at::text
       FROM approvals
       WHERE run_id IN (
         SELECT id
         FROM delegations
         WHERE from_agent_id = $1 OR to_agent_id = $1
         ORDER BY updated_at DESC
         LIMIT $2
       )
       ORDER BY created_at DESC`,
      [agentId, limit],
    ),
    pool.query<RuntimeEventRecord>(
      `SELECT id, event_type, delegation_id, payload, created_at::text
       FROM runtime_events
       WHERE delegation_id IN (
         SELECT id
         FROM delegations
         WHERE from_agent_id = $1 OR to_agent_id = $1
         ORDER BY updated_at DESC
         LIMIT $2
       )
       ORDER BY created_at DESC
       LIMIT $2`,
      [agentId, limit],
    ),
  ])

  const warnings: LoopWarning[] = []
  const delegations = delegationRes.rows

  const failuresByCapability = new Map<string, DelegationRecord[]>()
  const promptsBySignature = new Map<string, DelegationRecord[]>()

  for (const delegation of delegations) {
    if (delegation.status === 'failed') {
      const key = delegation.capability
      failuresByCapability.set(key, [...(failuresByCapability.get(key) ?? []), delegation])
    }

    const prompt = normalizePrompt(delegation.request)
    if (prompt) {
      const signature = `${delegation.capability}::${prompt}`
      promptsBySignature.set(signature, [...(promptsBySignature.get(signature) ?? []), delegation])
    }
  }

  for (const [capability, failures] of failuresByCapability.entries()) {
    if (failures.length >= 2) {
      warnings.push({
        agent_id: agentId,
        kind: 'repeated-failure',
        severity: failures.length >= 3 ? 'error' : 'warn',
        summary: summarizeRepeatedFailure(capability, failures.length),
        evidence: {
          capability,
          delegation_ids: failures.map((item) => item.id),
          statuses: failures.map((item) => item.status),
        },
        created_at: failures[0]?.updated_at ?? new Date().toISOString(),
      })
    }
  }

  for (const [signature, items] of promptsBySignature.entries()) {
    if (items.length >= 2) {
      const [capability, prompt] = signature.split('::', 2)
      warnings.push({
        agent_id: agentId,
        kind: 'prompt-loop',
        severity: items.length >= 3 ? 'error' : 'warn',
        summary: summarizePromptLoop(capability, prompt ?? '', items.length),
        evidence: {
          capability,
          prompt,
          delegation_ids: items.map((item) => item.id),
        },
        created_at: items[0]?.updated_at ?? new Date().toISOString(),
      })
    }
  }

  const eventsByDelegation = new Map<string, RuntimeEventRecord[]>()
  for (const event of eventRes.rows) {
    if (!event.delegation_id) continue
    eventsByDelegation.set(event.delegation_id, [...(eventsByDelegation.get(event.delegation_id) ?? []), event])
  }

  for (const delegation of delegations) {
    const related = eventsByDelegation.get(delegation.id) ?? []
    const retries = related.filter((event) =>
      event.event_type === 'delegation.failed' || event.event_type === 'adapter.task.failed',
    )
    const deltas = related.filter((event) => event.event_type === 'adapter.message.part.delta')
    if (retries.length >= 2 && deltas.length === 0) {
      warnings.push({
        agent_id: agentId,
        kind: 'stall-retry',
        severity: 'warn',
        summary: summarizeStallRetry(delegation.capability, retries.length),
        evidence: {
          capability: delegation.capability,
          delegation_id: delegation.id,
          retry_events: retries.map((event) => event.id),
        },
        created_at: retries[0]?.created_at ?? delegation.updated_at,
      })
    }
  }

  const approvalsByAction = new Map<string, ApprovalRecord[]>()
  for (const approval of approvalRes.rows) {
    approvalsByAction.set(approval.action, [...(approvalsByAction.get(approval.action) ?? []), approval])
  }
  for (const [action, approvals] of approvalsByAction.entries()) {
    if (approvals.length >= 2) {
      warnings.push({
        agent_id: agentId,
        kind: 'approval-churn',
        severity: approvals.some((item) => item.status === 'denied') ? 'warn' : 'info',
        summary: summarizeApprovalChurn(action, approvals.length),
        evidence: {
          action,
          approval_ids: approvals.map((item) => item.approval_id),
          statuses: approvals.map((item) => item.status),
        },
        created_at: approvals[0]?.created_at ?? new Date().toISOString(),
      })
    }
  }

  return warnings
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
}
