import type pg from 'pg'

export interface LoopWarning {
  id: string
  agent_id: string
  kind: 'repeated-failure' | 'prompt-loop' | 'stall-retry' | 'approval-churn'
  severity: 'info' | 'warn' | 'error'
  summary: string
  evidence: Record<string, unknown>
  created_at: string
}

export interface LoopWarningDrilldownDelegation extends DelegationRecord {
  work_item_id?: string
  created_at: string
  completed_at?: string
  from_agent_name?: string
  to_agent_name?: string
}

export interface LoopWarningDrilldownWorkItem {
  id: string
  title: string
  status: string
  priority: string
  lane: string
  owner_agent_id?: string
  owner_label: string
  blocked_by?: string
  updated_at: string
}

export interface LoopWarningDrilldownApproval extends ApprovalRecord {}

export interface LoopWarningDrilldownEvent extends RuntimeEventRecord {
  actor: string
  work_item_id?: string
}

export interface LoopWarningDrilldown {
  warning: LoopWarning
  delegations: LoopWarningDrilldownDelegation[]
  work_items: LoopWarningDrilldownWorkItem[]
  approvals: LoopWarningDrilldownApproval[]
  events: LoopWarningDrilldownEvent[]
}

interface DelegationRecord {
  id: string
  work_item_id?: string
  from_agent_id?: string
  to_agent_id?: string
  capability: string
  status: string
  request: Record<string, unknown>
  result: Record<string, unknown>
  created_at: string
  updated_at: string
  completed_at?: string
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
  actor: string
  work_item_id?: string
  delegation_id?: string
  payload: Record<string, unknown>
  created_at: string
}

interface AgentNameRecord {
  id: string
  name: string
}

interface WorkItemRecord {
  id: string
  title: string
  status: string
  priority: string
  lane: string
  owner_agent_id?: string
  owner_label: string
  blocked_by?: string
  updated_at: string
}

function warningFingerprint(kind: LoopWarning['kind'], createdAt: string, evidence: Record<string, unknown>): string {
  const parts = [kind, createdAt]
  const delegationIds = Array.isArray(evidence['delegation_ids']) ? evidence['delegation_ids'] : []
  const approvalIds = Array.isArray(evidence['approval_ids']) ? evidence['approval_ids'] : []
  const delegationId = typeof evidence['delegation_id'] === 'string' ? evidence['delegation_id'] : ''
  const capability = typeof evidence['capability'] === 'string' ? evidence['capability'] : ''
  const prompt = typeof evidence['prompt'] === 'string' ? evidence['prompt'] : ''
  const action = typeof evidence['action'] === 'string' ? evidence['action'] : ''
  parts.push(delegationIds.map(String).join(','))
  parts.push(approvalIds.map(String).join(','))
  parts.push(delegationId)
  parts.push(capability)
  parts.push(prompt)
  parts.push(action)

  let hash = 0
  const input = parts.join('|')
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index)
    hash |= 0
  }
  return `loop-${Math.abs(hash).toString(36)}`
}

function withWarningId(warning: Omit<LoopWarning, 'id'>): LoopWarning {
  return {
    ...warning,
    id: warningFingerprint(warning.kind, warning.created_at, warning.evidence),
  }
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
      `SELECT id, work_item_id, from_agent_id, to_agent_id, capability, status, request, result, created_at::text, updated_at::text, completed_at::text
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
      `SELECT id, event_type, actor, work_item_id, delegation_id, payload, created_at::text
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
        id: '',
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
        id: '',
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
        id: '',
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
        id: '',
        agent_id: agentId,
        kind: 'approval-churn',
        severity: approvals.some((item) => item.status === 'denied') ? 'warn' : 'info',
        summary: summarizeApprovalChurn(action, approvals.length),
        evidence: {
          action,
          approval_ids: approvals.map((item) => item.approval_id),
          run_ids: approvals.map((item) => item.run_id),
          statuses: approvals.map((item) => item.status),
        },
        created_at: approvals[0]?.created_at ?? new Date().toISOString(),
      })
    }
  }

  return warnings
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
    .map((warning) => withWarningId({
      agent_id: warning.agent_id,
      kind: warning.kind,
      severity: warning.severity,
      summary: warning.summary,
      evidence: warning.evidence,
      created_at: warning.created_at,
    }))
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

export async function getLoopWarningDrilldown(
  pool: pg.Pool,
  agentId: string,
  warningId: string,
): Promise<LoopWarningDrilldown | null> {
  const warnings = await detectLoopWarnings(pool, agentId, { limit: 200 })
  const warning = warnings.find((item) => item.id === warningId)
  if (!warning) return null

  const evidence = warning.evidence
  const delegationIds = uniqueStrings([
    ...(Array.isArray(evidence['delegation_ids']) ? evidence['delegation_ids'].map(String) : []),
    typeof evidence['delegation_id'] === 'string' ? evidence['delegation_id'] : undefined,
    ...(Array.isArray(evidence['run_ids']) ? evidence['run_ids'].map(String) : []),
  ])
  const approvalIds = uniqueStrings(
    Array.isArray(evidence['approval_ids']) ? evidence['approval_ids'].map(String) : [],
  )

  const [delegationRes, approvalRes, eventRes] = await Promise.all([
    delegationIds.length > 0
      ? pool.query<DelegationRecord>(
          `SELECT id, work_item_id, from_agent_id, to_agent_id, capability, status, request, result, created_at::text, updated_at::text, completed_at::text
           FROM delegations
           WHERE id::text = ANY($1::text[])
           ORDER BY updated_at DESC`,
          [delegationIds],
        )
      : Promise.resolve({ rows: [] as DelegationRecord[] }),
    approvalIds.length > 0
      ? pool.query<ApprovalRecord>(
          `SELECT approval_id, run_id, action, status, created_at::text
           FROM approvals
           WHERE approval_id = ANY($1::text[])
           ORDER BY created_at DESC`,
          [approvalIds],
        )
      : delegationIds.length > 0
        ? pool.query<ApprovalRecord>(
            `SELECT approval_id, run_id, action, status, created_at::text
             FROM approvals
             WHERE run_id::text = ANY($1::text[])
             ORDER BY created_at DESC`,
            [delegationIds],
          )
        : Promise.resolve({ rows: [] as ApprovalRecord[] }),
    delegationIds.length > 0
      ? pool.query<RuntimeEventRecord>(
          `SELECT id, event_type, actor, work_item_id, delegation_id, payload, created_at::text
           FROM runtime_events
           WHERE delegation_id::text = ANY($1::text[])
           ORDER BY created_at DESC
           LIMIT 40`,
          [delegationIds],
        )
      : Promise.resolve({ rows: [] as RuntimeEventRecord[] }),
  ])

  const workItemIds = uniqueStrings([
    ...delegationRes.rows.map((item) => item.work_item_id),
    ...eventRes.rows.map((item) => item.work_item_id),
  ])
  const agentIds = uniqueStrings([
    ...delegationRes.rows.map((item) => item.from_agent_id),
    ...delegationRes.rows.map((item) => item.to_agent_id),
  ])

  const [workItemRes, agentRes] = await Promise.all([
    workItemIds.length > 0
      ? pool.query<WorkItemRecord>(
          `SELECT id, title, status, priority, lane, owner_agent_id, owner_label, blocked_by, updated_at::text
           FROM work_items
           WHERE id::text = ANY($1::text[])
           ORDER BY updated_at DESC`,
          [workItemIds],
        )
      : Promise.resolve({ rows: [] as WorkItemRecord[] }),
    agentIds.length > 0
      ? pool.query<AgentNameRecord>(
          `SELECT id::text, name
           FROM agents
           WHERE id::text = ANY($1::text[])`,
          [agentIds],
        )
      : Promise.resolve({ rows: [] as AgentNameRecord[] }),
  ])

  const agentNames = new Map(agentRes.rows.map((item) => [item.id, item.name]))
  return {
    warning,
    delegations: delegationRes.rows.map((item) => ({
      ...item,
      from_agent_name: item.from_agent_id ? agentNames.get(item.from_agent_id) : undefined,
      to_agent_name: item.to_agent_id ? agentNames.get(item.to_agent_id) : undefined,
    })),
    work_items: workItemRes.rows,
    approvals: approvalRes.rows,
    events: eventRes.rows,
  }
}
