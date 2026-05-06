import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchRuntimeAuditLoops,
  fetchRuntimeMemory,
  fetchRuntimeOverview,
} from '../api'
import { useApprovals } from '../hooks/useApprovals'
import type { ChiefProfile, PermissionRule } from '../types'

const DEFAULT_PROFILE: ChiefProfile = {
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
}

const DEFAULT_RULES: PermissionRule[] = [
  { scope: 'Filesystem writes', mode: 'Scoped', note: 'Allow within approved workspace roots only.' },
  { scope: 'Shell escalation', mode: 'Approval', note: 'Require explicit approval before unrestricted execution.' },
  { scope: 'GitHub/Gitea', mode: 'Delegated', note: 'Permit PR, review, and issue actions through tracked work items.' },
  { scope: 'Browser/docs/slides/sheets', mode: 'Open', note: 'Read-first unless a task requires edits or publication.' },
]

function cardClass(extra = '') {
  return `rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] shadow-[0_18px_48px_rgba(2,6,23,0.18)] backdrop-blur ${extra}`.trim()
}

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Waiting'
}

function SectionHeader({
  eyebrow,
  title,
  detail,
}: {
  eyebrow: string
  title: string
  detail?: string
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-medium uppercase tracking-[0.28em] text-[var(--muted)]">{eyebrow}</div>
        <h2 className="mt-1 text-lg font-semibold text-[var(--text)]">{title}</h2>
      </div>
      {detail ? (
        <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-[11px] text-[var(--muted)]">
          {detail}
        </div>
      ) : null}
    </div>
  )
}

export function Governance() {
  const { approvals, approve, deny } = useApprovals()
  const { data: runtimeOverview } = useQuery({
    queryKey: ['runtime-overview'],
    queryFn: fetchRuntimeOverview,
    refetchInterval: 15_000,
  })
  const { data: memories = [] } = useQuery({
    queryKey: ['runtime-memory'],
    queryFn: () => fetchRuntimeMemory(),
    refetchInterval: 30_000,
  })
  const { data: auditLoops = [] } = useQuery({
    queryKey: ['runtime-audit-loops'],
    queryFn: fetchRuntimeAuditLoops,
    refetchInterval: 30_000,
  })

  const profile: ChiefProfile = useMemo(() => {
    const current = runtimeOverview?.chief
      ? {
          name: runtimeOverview.chief.name,
          persona: runtimeOverview.chief.persona,
          policy: runtimeOverview.chief.operating_policy,
          preferences: memories.filter((m) => m.category === 'preference').map((m) => m.content),
          recurringDuties: memories.filter((m) => m.category === 'recurring-duty').map((m) => m.content),
          priorDecisions: memories.filter((m) => m.category === 'prior-decision').map((m) => m.content),
        }
      : { ...DEFAULT_PROFILE, preferences: [], recurringDuties: [], priorDecisions: [] }

    if (current.preferences.length === 0) current.preferences = DEFAULT_PROFILE.preferences
    if (current.recurringDuties.length === 0) current.recurringDuties = DEFAULT_PROFILE.recurringDuties
    if (current.priorDecisions.length === 0) current.priorDecisions = DEFAULT_PROFILE.priorDecisions
    return current
  }, [memories, runtimeOverview?.chief])

  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending')

  return (
    <div className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="grid gap-5">
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Controls" title="Governance" detail={`${DEFAULT_RULES.length} active rules`} />
            <div className="space-y-3">
              {DEFAULT_RULES.map((rule) => (
                <div key={rule.scope} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text)]">{rule.scope}</div>
                    <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">{rule.mode}</div>
                  </div>
                  <div className="mt-2 text-sm text-[var(--text)]">{rule.note}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Approvals" title="Pending Escalations" detail={`${pendingApprovals.length} pending`} />
            <div className="space-y-3">
              {pendingApprovals.map((approval) => (
                <div key={approval.approval_id} className="rounded-[1rem] border border-amber-300/20 bg-amber-300/10 p-4">
                  <div className="text-sm font-medium text-[var(--text)]">{approval.action}</div>
                  <div className="mt-1 text-xs text-amber-50/70">Run {approval.run_id}</div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => approve(approval.approval_id)}
                      className="rounded-full border border-emerald-300/20 bg-emerald-300/12 px-3 py-1.5 text-xs text-emerald-50 transition hover:bg-emerald-300/20"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => deny(approval.approval_id)}
                      className="rounded-full border border-rose-300/20 bg-rose-300/12 px-3 py-1.5 text-xs text-rose-50 transition hover:bg-rose-300/20"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
              {pendingApprovals.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No pending approvals. Escalation lanes are currently clear.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-5">
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Context" title="Persistent Memory" detail={`${profile.preferences.length + profile.recurringDuties.length + profile.priorDecisions.length} entries`} />
            <div className="space-y-4">
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Preferences</div>
                <div className="mt-2 space-y-2 text-sm text-[var(--text)]">
                  {profile.preferences.map((item) => <div key={item}>{item}</div>)}
                </div>
              </div>
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Recurring Duties</div>
                <div className="mt-2 space-y-2 text-sm text-[var(--text)]">
                  {profile.recurringDuties.map((item) => <div key={item}>{item}</div>)}
                </div>
              </div>
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Prior Decisions</div>
                <div className="mt-2 space-y-2 text-sm text-[var(--text)]">
                  {profile.priorDecisions.map((item) => <div key={item}>{item}</div>)}
                </div>
              </div>
            </div>
          </div>

          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Background" title="Audit Loops" detail={`${auditLoops.length} loops`} />
            <div className="space-y-3">
              {auditLoops.map((loop) => (
                <div key={loop.id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text)]">{loop.name}</div>
                    <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">{loop.cadence_cron}</div>
                  </div>
                  <div className="mt-2 text-sm text-[var(--text)]">{loop.purpose}</div>
                  <div className="mt-3 grid gap-2 text-xs text-[var(--muted)] sm:grid-cols-2">
                    <div>Last run: {formatTime(loop.last_run_at)}</div>
                    <div>Next run: {formatTime(loop.next_run_at)}</div>
                  </div>
                </div>
              ))}
              {auditLoops.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No audit loops are configured yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
