import type pg from 'pg'

export interface ChiefProfile {
  id: string
  name: string
  persona: string
  operating_policy: string
  delegation_policy: Record<string, unknown>
  default_provider_id?: string
  created_at: string
  updated_at: string
}

export interface RuntimeThread {
  id: string
  title: string
  status: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ThreadMessage {
  id: string
  thread_id: string
  role: string
  sender: string
  content: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface MemoryRecord {
  id: string
  category: string
  content: string
  source_thread_id?: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface WorkItem {
  id: string
  title: string
  description?: string
  status: string
  priority: string
  lane: string
  owner_agent_id?: string
  owner_label: string
  thread_id?: string
  parent_id?: string
  blocked_by?: string
  due_at?: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Delegation {
  id: string
  work_item_id?: string
  from_agent_id?: string
  to_agent_id?: string
  status: string
  capability: string
  request: Record<string, unknown>
  result: Record<string, unknown>
  trace: DelegationTraceEntry[]
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface DelegationTraceEntry {
  step:
    | 'queued'
    | 'claimed'
    | 'prompt_sent'
    | 'wait_returned'
    | 'scope_checked'
    | 'result_routed'
    | 'failed'
  at: string
  completed_at?: string
  actor_agent_id?: string
  tokens?: number
  detail?: Record<string, unknown>
}

export interface AuditLoop {
  id: string
  name: string
  purpose: string
  cadence_cron: string
  enabled: boolean
  config: Record<string, unknown>
  last_run_at?: string
  next_run_at?: string
  created_at: string
  updated_at: string
}

export interface RuntimeEvent {
  id: string
  event_type: string
  actor: string
  thread_id?: string
  work_item_id?: string
  delegation_id?: string
  payload: Record<string, unknown>
  created_at: string
}

export async function ensureRuntimeDefaults(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO chief_profiles (id, name, persona, operating_policy, delegation_policy)
     VALUES ('default', $1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [
      'Chief of Staff',
      'Persistent executive operations agent for homelab coordination.',
      'Maintain memory, coordinate subagents, use scoped tools, request approval for risky actions, and keep concise status updates.',
      JSON.stringify({
        route_by: ['capability', 'runtime_health', 'trust_zone', 'workload'],
        require_trace: true,
        require_approval_for: ['destructive', 'deploy', 'secret', 'broad_filesystem', 'external_write'],
      }),
    ]
  )

  const rules = [
    ['Workspace Writes', 'filesystem', 'scoped', { roots: ['workspace'], approval: false }],
    ['Shell Escalation', 'shell', 'approval', { require_approval: true, allow_prefix_rules: true }],
    ['External Publishing', 'network', 'approval', { actions: ['deploy', 'push', 'publish'] }],
  ]

  for (const [name, scope, mode, rule] of rules) {
    await pool.query(
      `INSERT INTO permission_rules (name, scope, mode, rule)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [name, scope, mode, JSON.stringify(rule)]
    )
  }

  const audits = [
    ['Open Work Audit', 'Check blocked work, pending approvals, stale delegations, and unresolved follow-ups.', '0 * * * *'],
    ['Review Queue Sweep', 'Check PRs, reviews, deployments, and stale verification tasks.', '15 * * * *'],
  ]

  for (const [name, purpose, cadence] of audits) {
    await pool.query(
      `INSERT INTO audit_loops (name, purpose, cadence_cron)
       VALUES ($1, $2, $3)
       ON CONFLICT (name) DO NOTHING`,
      [name, purpose, cadence]
    )
  }
}

export async function getChiefProfile(pool: pg.Pool): Promise<ChiefProfile> {
  await ensureRuntimeDefaults(pool)
  const { rows } = await pool.query(`SELECT * FROM chief_profiles WHERE id = 'default'`)
  return rows[0]
}

async function ensureOnboardingThread(pool: pg.Pool): Promise<void> {
  const { rows: configRows } = await pool.query(
    `SELECT enabled, setup_complete FROM prime_agent_config WHERE id = 'default'`
  )
  const config = configRows[0]
  if (!config?.enabled || !config?.setup_complete) return

  const { rows: threadRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM threads`
  )
  if ((threadRows[0]?.count ?? 0) > 0) return

  const { rows: chiefRows } = await pool.query(
    `SELECT name FROM chief_profiles WHERE id = 'default'`
  )
  const chiefName = chiefRows[0]?.name?.trim() || 'Prime'

  const onboardingThread = await createThread(pool, {
    title: `Getting started with ${chiefName}`,
    metadata: {
      kind: 'onboarding',
      source: 'runtime-bootstrap',
    },
  })

  await appendThreadMessage(pool, onboardingThread.id, {
    role: 'assistant',
    sender: chiefName,
    content: `I'm ${chiefName}. Your control plane is live and ready. Start by telling me the first task, repo, incident, or workflow you want me to handle, and I'll turn this room into the active coordination thread for it.`,
    metadata: {
      kind: 'greeting',
    },
  })
}

export async function listThreads(pool: pg.Pool): Promise<RuntimeThread[]> {
  await ensureOnboardingThread(pool)
  const { rows } = await pool.query(`SELECT * FROM threads ORDER BY updated_at DESC LIMIT 100`)
  return rows
}

export async function createThread(
  pool: pg.Pool,
  data: { title: string; status?: string; metadata?: Record<string, unknown> }
): Promise<RuntimeThread> {
  const { rows } = await pool.query(
    `INSERT INTO threads (title, status, metadata)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.title, data.status ?? 'active', JSON.stringify(data.metadata ?? {})]
  )
  await insertRuntimeEvent(pool, {
    event_type: 'thread.created',
    actor: 'chief-of-staff',
    thread_id: rows[0].id,
    payload: { title: data.title },
  })
  return rows[0]
}

export async function listThreadMessages(pool: pg.Pool, threadId: string): Promise<ThreadMessage[]> {
  const { rows } = await pool.query(
    `SELECT * FROM thread_messages WHERE thread_id = $1 ORDER BY created_at ASC`,
    [threadId]
  )
  return rows
}

export async function appendThreadMessage(
  pool: pg.Pool,
  threadId: string,
  data: { role: string; sender: string; content: string; metadata?: Record<string, unknown> }
): Promise<ThreadMessage> {
  const { rows } = await pool.query(
    `INSERT INTO thread_messages (thread_id, role, sender, content, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [threadId, data.role, data.sender, data.content, JSON.stringify(data.metadata ?? {})]
  )
  await pool.query(`UPDATE threads SET updated_at = now() WHERE id = $1`, [threadId])
  await insertRuntimeEvent(pool, {
    event_type: 'thread.message',
    actor: data.sender,
    thread_id: threadId,
    payload: { role: data.role, message_id: rows[0].id },
  })
  return rows[0]
}

export async function listMemories(pool: pg.Pool, category?: string): Promise<MemoryRecord[]> {
  const values: unknown[] = []
  const where = category ? `WHERE category = $1` : ''
  if (category) values.push(category)
  const { rows } = await pool.query(
    `SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT 200`,
    values
  )
  return rows
}

export async function createMemory(
  pool: pg.Pool,
  data: { category: string; content: string; source_thread_id?: string; metadata?: Record<string, unknown> }
): Promise<MemoryRecord> {
  const { rows } = await pool.query(
    `INSERT INTO memories (category, content, source_thread_id, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.category, data.content, data.source_thread_id ?? null, JSON.stringify(data.metadata ?? {})]
  )
  await insertRuntimeEvent(pool, {
    event_type: 'memory.created',
    actor: 'chief-of-staff',
    thread_id: data.source_thread_id,
    payload: { category: data.category, memory_id: rows[0].id },
  })
  return rows[0]
}

export async function listWorkItems(pool: pg.Pool, status?: string): Promise<WorkItem[]> {
  const values: unknown[] = []
  const where = status ? `WHERE status = $1` : ''
  if (status) values.push(status)
  const { rows } = await pool.query(
    `SELECT * FROM work_items ${where} ORDER BY updated_at DESC LIMIT 200`,
    values
  )
  return rows
}

export async function createWorkItem(
  pool: pg.Pool,
  data: Partial<WorkItem> & { title: string }
): Promise<WorkItem> {
  const ownerLabel = data.owner_label ?? (await getCoordinatorName(pool))
  const { rows } = await pool.query(
    `INSERT INTO work_items (
      title, description, status, priority, lane, owner_agent_id, owner_label,
      thread_id, parent_id, blocked_by, due_at, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    [
      data.title,
      data.description ?? null,
      data.status ?? 'active',
      data.priority ?? 'normal',
      data.lane ?? 'operations',
      data.owner_agent_id ?? null,
      ownerLabel,
      data.thread_id ?? null,
      data.parent_id ?? null,
      data.blocked_by ?? null,
      data.due_at ?? null,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  await insertRuntimeEvent(pool, {
    event_type: 'work.created',
    actor: ownerLabel,
    thread_id: data.thread_id,
    work_item_id: rows[0].id,
    payload: { title: data.title, status: rows[0].status },
  })
  return rows[0]
}

async function getCoordinatorName(pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query(`SELECT name FROM chief_profiles WHERE id = 'default'`)
  return rows[0]?.name?.trim() || 'Prime'
}

export async function updateWorkItem(
  pool: pg.Pool,
  id: string,
  data: Partial<WorkItem>
): Promise<WorkItem | null> {
  const fields: Array<[keyof WorkItem, string, (value: unknown) => unknown]> = [
    ['title', 'title', (value) => value],
    ['description', 'description', (value) => value],
    ['status', 'status', (value) => value],
    ['priority', 'priority', (value) => value],
    ['lane', 'lane', (value) => value],
    ['owner_agent_id', 'owner_agent_id', (value) => value],
    ['owner_label', 'owner_label', (value) => value],
    ['thread_id', 'thread_id', (value) => value],
    ['parent_id', 'parent_id', (value) => value],
    ['blocked_by', 'blocked_by', (value) => value],
    ['due_at', 'due_at', (value) => value],
    ['metadata', 'metadata', (value) => JSON.stringify(value ?? {})],
  ]
  const vals: unknown[] = [id]
  const sets: string[] = []

  for (const [key, col, encode] of fields) {
    if (key in data) {
      vals.push(encode(data[key]))
      sets.push(`${col} = $${vals.length}`)
    }
  }

  if (sets.length === 0) {
    const { rows } = await pool.query(`SELECT * FROM work_items WHERE id = $1`, [id])
    return rows[0] ?? null
  }

  const { rows } = await pool.query(
    `UPDATE work_items SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    vals
  )
  if (!rows[0]) return null
  await insertRuntimeEvent(pool, {
    event_type: 'work.updated',
    actor: 'chief-of-staff',
    thread_id: rows[0].thread_id,
    work_item_id: rows[0].id,
    payload: { status: rows[0].status },
  })
  return rows[0]
}

export async function listDelegations(pool: pg.Pool, status?: string): Promise<Delegation[]> {
  const values: unknown[] = []
  const where = status ? `WHERE status = $1` : ''
  if (status) values.push(status)
  const { rows } = await pool.query(
    `SELECT * FROM delegations ${where} ORDER BY updated_at DESC LIMIT 200`,
    values
  )
  return rows
}

export async function getDelegation(pool: pg.Pool, id: string): Promise<Delegation | null> {
  const { rows } = await pool.query(`SELECT * FROM delegations WHERE id = $1`, [id])
  return rows[0] ?? null
}

export async function createDelegation(
  pool: pg.Pool,
  data: {
    work_item_id?: string
    from_agent_id?: string
    to_agent_id?: string
    status?: string
    capability: string
    request?: Record<string, unknown>
  }
): Promise<Delegation> {
  const { rows } = await pool.query(
    `INSERT INTO delegations (work_item_id, from_agent_id, to_agent_id, status, capability, request)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.work_item_id ?? null,
      data.from_agent_id ?? null,
      data.to_agent_id ?? null,
      data.status ?? 'queued',
      data.capability,
      JSON.stringify(data.request ?? {}),
    ]
  )
  await insertRuntimeEvent(pool, {
    event_type: 'delegation.created',
    actor: 'chief-of-staff',
    work_item_id: data.work_item_id,
    delegation_id: rows[0].id,
    payload: { capability: data.capability, status: rows[0].status, to_agent_id: data.to_agent_id },
  })
  return rows[0]
}

export async function updateDelegation(
  pool: pg.Pool,
  id: string,
  data: Partial<Pick<Delegation, 'status' | 'result' | 'trace' | 'completed_at'>>
): Promise<Delegation | null> {
  const vals: unknown[] = [id]
  const sets: string[] = []

  if ('status' in data) {
    vals.push(data.status)
    sets.push(`status = $${vals.length}`)
  }
  if ('result' in data) {
    vals.push(JSON.stringify(data.result ?? {}))
    sets.push(`result = $${vals.length}`)
  }
  if ('trace' in data) {
    vals.push(JSON.stringify(data.trace ?? []))
    sets.push(`trace = $${vals.length}`)
  }
  if ('completed_at' in data) {
    vals.push(data.completed_at ?? null)
    sets.push(`completed_at = $${vals.length}`)
  }

  if (sets.length === 0) return getDelegation(pool, id)

  const { rows } = await pool.query(
    `UPDATE delegations SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    vals
  )
  return rows[0] ?? null
}

export async function appendDelegationTrace(
  pool: pg.Pool,
  delegation: Delegation,
  entry: DelegationTraceEntry
): Promise<Delegation> {
  const trace = [
    ...(Array.isArray(delegation.trace) ? delegation.trace : []),
    { ...entry, created_at: new Date().toISOString() },
  ]
  const updated = await updateDelegation(pool, delegation.id, { trace })
  return updated ?? { ...delegation, trace }
}

export async function listAuditLoops(pool: pg.Pool): Promise<AuditLoop[]> {
  await ensureRuntimeDefaults(pool)
  const { rows } = await pool.query(`SELECT * FROM audit_loops ORDER BY name`)
  return rows
}

export async function recordAuditRun(
  pool: pg.Pool,
  loopId: string,
  result: Record<string, unknown> = {}
): Promise<{ id: string; status: string; result: Record<string, unknown> }> {
  const { rows } = await pool.query(
    `INSERT INTO audit_runs (audit_loop_id, status, result, finished_at)
     VALUES ($1, 'completed', $2, now())
     RETURNING id, status, result`,
    [loopId, JSON.stringify(result)]
  )
  await pool.query(
    `UPDATE audit_loops SET last_run_at = now(), updated_at = now() WHERE id = $1`,
    [loopId]
  )
  await insertRuntimeEvent(pool, {
    event_type: 'audit.completed',
    actor: 'chief-of-staff',
    payload: { audit_loop_id: loopId, audit_run_id: rows[0].id },
  })
  return rows[0]
}

export async function insertRuntimeEvent(
  pool: pg.Pool,
  data: {
    event_type: string
    actor: string
    thread_id?: string
    work_item_id?: string
    delegation_id?: string
    payload?: Record<string, unknown>
  }
): Promise<RuntimeEvent> {
  const { rows } = await pool.query(
    `INSERT INTO runtime_events (event_type, actor, thread_id, work_item_id, delegation_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      data.event_type,
      data.actor,
      data.thread_id ?? null,
      data.work_item_id ?? null,
      data.delegation_id ?? null,
      JSON.stringify(data.payload ?? {}),
    ]
  )
  return rows[0]
}

export async function listRuntimeEvents(pool: pg.Pool, limit = 100): Promise<RuntimeEvent[]> {
  const { rows } = await pool.query(
    `SELECT * FROM runtime_events ORDER BY created_at DESC LIMIT $1`,
    [Math.max(1, Math.min(limit, 500))]
  )
  return rows
}

export async function getRuntimeOverview(pool: pg.Pool): Promise<Record<string, unknown>> {
  await ensureRuntimeDefaults(pool)
  const [chief, work, delegations, approvals, agents, auditLoops, events] = await Promise.all([
    getChiefProfile(pool),
    pool.query(`SELECT status, count(*)::int AS count FROM work_items GROUP BY status`),
    pool.query(`SELECT status, count(*)::int AS count FROM delegations GROUP BY status`),
    pool.query(`SELECT status, count(*)::int AS count FROM approvals GROUP BY status`),
    pool.query(`SELECT runtime_family, execution_mode, enabled, count(*)::int AS count FROM agents GROUP BY runtime_family, execution_mode, enabled`),
    pool.query(`SELECT count(*)::int AS count FROM audit_loops WHERE enabled = true`),
    listRuntimeEvents(pool, 10),
  ])

  return {
    chief,
    counts: {
      work_items: work.rows,
      delegations: delegations.rows,
      approvals: approvals.rows,
      agents: agents.rows,
      active_audit_loops: auditLoops.rows[0]?.count ?? 0,
    },
    recent_events: events,
  }
}
