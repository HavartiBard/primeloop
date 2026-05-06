import type pg from 'pg'

export interface WorkItem {
  id: string
  title: string
  status: 'active' | 'blocked' | 'approval' | 'review' | 'deploy' | 'follow-up'
  owner: string
  lane: string
  updated_at: string
}

export interface StatusUpdate {
  id: string
  text: string
  created_at: string
}

export interface ChiefProfile {
  name: string
  persona: string
  policy: string
  preferences: string[]
  recurringDuties: string[]
  priorDecisions: string[]
}

export interface PermissionRule {
  scope: string
  mode: string
  note: string
}

export interface AuditLoop {
  id: string
  name: string
  cadence: string
  lastRun: string
  nextRun: string
  purpose: string
}

export interface PortalState {
  chief_profile: ChiefProfile
  work_items: WorkItem[]
  status_updates: StatusUpdate[]
  permission_rules: PermissionRule[]
  audit_loops: AuditLoop[]
  updated_at?: string
}

export const DEFAULT_PORTAL_STATE: PortalState = {
  chief_profile: {
    name: 'Chief of Staff',
    persona: 'Pragmatic executive operations agent for homelab planning, delegation, and approvals.',
    policy: 'Keep work moving with bounded delegation, durable memory, scoped escalation, and concise status reporting.',
    preferences: [
      'Prefer direct execution over excessive planning.',
      'Route risky actions through explicit approval lanes.',
      'Surface blockers and stale work before opening new threads.',
    ],
    recurringDuties: [
      'Review open work hourly.',
      'Audit stale approvals and blocked tasks.',
      'Track PRs, reviews, deployments, and follow-ups through completion.',
    ],
    priorDecisions: [
      'Use a single persistent coordinator rather than stateless chat.',
      'Keep subagents specialist and bounded by scope.',
      'Preserve concise human-readable status updates in the portal.',
    ],
  },
  work_items: [
    {
      id: 'wk-1',
      title: 'Rework dashboard into executive multi-agent portal',
      status: 'active',
      owner: 'Chief of Staff',
      lane: 'Implementation',
      updated_at: new Date(0).toISOString(),
    },
    {
      id: 'wk-2',
      title: 'Define scoped command rules for homelab operations',
      status: 'approval',
      owner: 'Governance Agent',
      lane: 'Approvals',
      updated_at: new Date(0).toISOString(),
    },
    {
      id: 'wk-3',
      title: 'Audit stale issues, PRs, and follow-up queue',
      status: 'follow-up',
      owner: 'Audit Agent',
      lane: 'Operations',
      updated_at: new Date(0).toISOString(),
    },
  ],
  status_updates: [
    {
      id: 'su-1',
      text: 'Portal bootstrap started. Chief of Staff is assembling live context from agents, tools, and approvals.',
      created_at: new Date(0).toISOString(),
    },
  ],
  permission_rules: [
    { scope: 'Filesystem writes', mode: 'Scoped', note: 'Allow within approved workspace roots only.' },
    { scope: 'Shell escalation', mode: 'Approval', note: 'Require explicit approval before unrestricted execution.' },
    { scope: 'GitHub/Gitea', mode: 'Delegated', note: 'Permit PR, review, and issue actions through tracked work items.' },
    { scope: 'Browser/docs/slides/sheets', mode: 'Open', note: 'Read-first unless a task requires edits or publication.' },
  ],
  audit_loops: [
    {
      id: 'audit-1',
      name: 'Open Work Audit',
      cadence: 'Hourly',
      lastRun: new Date(0).toISOString(),
      nextRun: new Date(0).toISOString(),
      purpose: 'Check blocked work, approvals, and stale handoffs.',
    },
    {
      id: 'audit-2',
      name: 'Review Queue Sweep',
      cadence: 'Hourly',
      lastRun: new Date(0).toISOString(),
      nextRun: new Date(0).toISOString(),
      purpose: 'Inspect PRs, pending reviews, and unresolved follow-ups.',
    },
  ],
}

interface PortalRow {
  chief_profile: ChiefProfile
  work_items: WorkItem[]
  status_updates: StatusUpdate[]
  permission_rules: PermissionRule[]
  audit_loops: AuditLoop[]
  updated_at: string
}

export async function ensurePortalState(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO portal_state (
      singleton_key,
      chief_profile,
      work_items,
      status_updates,
      permission_rules,
      audit_loops
    )
    VALUES ('default', $1, $2, $3, $4, $5)
    ON CONFLICT (singleton_key) DO NOTHING`,
    [
      JSON.stringify(DEFAULT_PORTAL_STATE.chief_profile),
      JSON.stringify(DEFAULT_PORTAL_STATE.work_items),
      JSON.stringify(DEFAULT_PORTAL_STATE.status_updates),
      JSON.stringify(DEFAULT_PORTAL_STATE.permission_rules),
      JSON.stringify(DEFAULT_PORTAL_STATE.audit_loops),
    ]
  )
}

export async function getPortalState(pool: pg.Pool): Promise<PortalState> {
  await ensurePortalState(pool)
  const result = await pool.query<PortalRow>(
    `SELECT chief_profile, work_items, status_updates, permission_rules, audit_loops, updated_at::text
     FROM portal_state
     WHERE singleton_key = 'default'`
  )

  const row = result.rows[0]
  return {
    chief_profile: row.chief_profile,
    work_items: row.work_items,
    status_updates: row.status_updates,
    permission_rules: row.permission_rules,
    audit_loops: row.audit_loops,
    updated_at: row.updated_at,
  }
}

export async function updatePortalState(pool: pg.Pool, state: PortalState): Promise<PortalState> {
  await ensurePortalState(pool)
  const result = await pool.query<PortalRow>(
    `UPDATE portal_state
     SET chief_profile = $1,
         work_items = $2,
         status_updates = $3,
         permission_rules = $4,
         audit_loops = $5,
         updated_at = now()
     WHERE singleton_key = 'default'
     RETURNING chief_profile, work_items, status_updates, permission_rules, audit_loops, updated_at::text`,
    [
      JSON.stringify(state.chief_profile),
      JSON.stringify(state.work_items),
      JSON.stringify(state.status_updates),
      JSON.stringify(state.permission_rules),
      JSON.stringify(state.audit_loops),
    ]
  )

  const row = result.rows[0]
  return {
    chief_profile: row.chief_profile,
    work_items: row.work_items,
    status_updates: row.status_updates,
    permission_rules: row.permission_rules,
    audit_loops: row.audit_loops,
    updated_at: row.updated_at,
  }
}
