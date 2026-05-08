import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchFleetLoopWarnings,
  fetchFleetLearnings,
  fetchFleetPatterns,
  fetchFleetSnapshots,
  fetchRuntimeAuditLoops,
  fetchRuntimeMemory,
  fetchRuntimeOverview,
  publishFleetPattern,
  resolveApprovalAsPrime,
} from '../api'
import { useAgentRegistry } from '../hooks/useAgentRegistry'
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
  const queryClient = useQueryClient()
  const { approvals } = useApprovals()
  const { agents } = useAgentRegistry()
  const [patternDraft, setPatternDraft] = useState({
    type: 'best_practice',
    severity: 'info',
    content: '',
    source_agent_id: '',
  })
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
  const { data: patterns = [] } = useQuery({
    queryKey: ['fleet-patterns'],
    queryFn: () => fetchFleetPatterns(),
    refetchInterval: 30_000,
  })
  const { data: learnings = [] } = useQuery({
    queryKey: ['fleet-learnings'],
    queryFn: () => fetchFleetLearnings({ limit: 12 }),
    refetchInterval: 30_000,
  })
  const { data: loopWarnings = [] } = useQuery({
    queryKey: ['fleet-loop-warnings'],
    queryFn: () => fetchFleetLoopWarnings({ limit: 12 }),
    refetchInterval: 30_000,
  })
  const { data: snapshots = [] } = useQuery({
    queryKey: ['fleet-snapshots'],
    queryFn: () => fetchFleetSnapshots({ limit: 8 }),
    refetchInterval: 30_000,
  })
  const publishPatternMutation = useMutation({
    mutationFn: publishFleetPattern,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet-patterns'] })
      setPatternDraft((current) => ({ ...current, content: '' }))
    },
  })
  const resolveApprovalMutation = useMutation({
    mutationFn: ({ approvalId, decision }: { approvalId: string; decision: 'approved' | 'denied' }) =>
      resolveApprovalAsPrime(approvalId, decision),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approvals'] })
      void queryClient.invalidateQueries({ queryKey: ['runtime-overview'] })
    },
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
  const primeAgents = agents.filter((agent) => agent.capabilities.includes('prime'))

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
                      onClick={() => resolveApprovalMutation.mutate({ approvalId: approval.approval_id, decision: 'approved' })}
                      disabled={resolveApprovalMutation.isPending}
                      className="rounded-full border border-emerald-300/20 bg-emerald-300/12 px-3 py-1.5 text-xs text-emerald-50 transition hover:bg-emerald-300/20"
                    >
                      Approve Via Prime
                    </button>
                    <button
                      onClick={() => resolveApprovalMutation.mutate({ approvalId: approval.approval_id, decision: 'denied' })}
                      disabled={resolveApprovalMutation.isPending}
                      className="rounded-full border border-rose-300/20 bg-rose-300/12 px-3 py-1.5 text-xs text-rose-50 transition hover:bg-rose-300/20"
                    >
                      Deny Via Prime
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
            <SectionHeader eyebrow="Fleet" title="Pattern Library" detail={`${patterns.length} patterns`} />
            <div className="mb-4 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
              <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Publish Pattern</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <select
                  value={patternDraft.type}
                  onChange={(e) => setPatternDraft((current) => ({ ...current, type: e.target.value }))}
                  className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                >
                  <option value="best_practice">Best practice</option>
                  <option value="antipattern">Antipattern</option>
                </select>
                <select
                  value={patternDraft.severity}
                  onChange={(e) => setPatternDraft((current) => ({ ...current, severity: e.target.value }))}
                  className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
                >
                  <option value="info">Info</option>
                  <option value="warn">Warn</option>
                  <option value="error">Error</option>
                </select>
              </div>
              <select
                value={patternDraft.source_agent_id}
                onChange={(e) => setPatternDraft((current) => ({ ...current, source_agent_id: e.target.value }))}
                className="mt-3 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
              >
                <option value="">Source agent: Prime default</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                ))}
              </select>
              <textarea
                value={patternDraft.content}
                onChange={(e) => setPatternDraft((current) => ({ ...current, content: e.target.value }))}
                rows={4}
                placeholder="Capture a reusable best practice or antipattern for the fleet."
                className="mt-3 w-full rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--text)]"
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-[var(--muted)]">
                  {primeAgents.length > 0 ? `${primeAgents.length} prime-capable agent${primeAgents.length === 1 ? '' : 's'} available` : 'No prime-capable agent registered'}
                </div>
                <button
                  onClick={() => publishPatternMutation.mutate({
                    type: patternDraft.type as 'best_practice' | 'antipattern',
                    severity: patternDraft.severity,
                    content: patternDraft.content,
                    ...(patternDraft.source_agent_id ? { source_agent_id: patternDraft.source_agent_id } : {}),
                  })}
                  disabled={publishPatternMutation.isPending || !patternDraft.content.trim() || primeAgents.length === 0}
                  className="rounded-full border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-4 py-1.5 text-xs text-blue-300 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Publish Pattern
                </button>
              </div>
            </div>
            <div className="space-y-3">
              {patterns.slice(0, 8).map((pattern) => (
                <div key={pattern.id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text)]">
                      {pattern.type === 'antipattern' ? 'Antipattern' : 'Best Practice'}
                    </div>
                    <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
                      {pattern.severity}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-[var(--text)]">{pattern.content}</div>
                  <div className="mt-2 text-xs text-[var(--muted)]">
                    {pattern.source_agent_name ? `Source ${pattern.source_agent_name}` : 'Fleet pattern'}
                  </div>
                </div>
              ))}
              {patterns.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No published patterns yet.
                </div>
              )}
            </div>
          </div>

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

          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Fleet" title="Loop Monitor" detail={`${loopWarnings.length} warnings`} />
            <div className="space-y-3">
              {loopWarnings.map((warning, index) => (
                <div key={`${warning.kind}:${warning.created_at}:${index}`} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text)]">{warning.summary}</div>
                    <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
                      {warning.severity}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-[var(--muted)]">{warning.agent_name} · {warning.kind}</div>
                </div>
              ))}
              {loopWarnings.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No loop warnings detected yet.
                </div>
              )}
            </div>
          </div>

          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Fleet" title="Recent Learnings" detail={`${learnings.length} entries`} />
            <div className="space-y-3">
              {learnings.map((entry) => (
                <div key={`${entry.kind}:${entry.id}`} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-[var(--text)]">
                      {entry.agent_name} · {entry.kind}
                    </div>
                    <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1 text-xs text-[var(--muted)]">
                      {entry.category ?? 'general'}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-[var(--text)]">{entry.content}</div>
                  <div className="mt-2 text-xs text-[var(--muted)]">
                    {entry.kind === 'lesson'
                      ? (entry.context ? `Context: ${entry.context}` : entry.severity ?? 'lesson')
                      : (entry.importance != null ? `Importance ${entry.importance}` : 'memory')}
                  </div>
                  <div className="mt-3">
                    <button
                      onClick={() => setPatternDraft({
                        type: entry.kind === 'lesson' && entry.severity === 'error' ? 'antipattern' : 'best_practice',
                        severity: entry.kind === 'lesson' ? (entry.severity ?? 'info') : (entry.importance != null && entry.importance >= 4 ? 'warn' : 'info'),
                        content: entry.content,
                        source_agent_id: entry.agent_id,
                      })}
                      className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-1.5 text-xs text-[var(--text)] transition hover:bg-[var(--panel-subtle)]"
                    >
                      Seed Pattern Draft
                    </button>
                  </div>
                </div>
              ))}
              {learnings.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No fleet learnings logged yet.
                </div>
              )}
            </div>
          </div>

          <div className={`${cardClass()} p-5 sm:p-6`}>
            <SectionHeader eyebrow="Recovery" title="Recent Snapshots" detail={`${snapshots.length} snapshots`} />
            <div className="space-y-3">
              {snapshots.map((snapshot) => (
                <div key={snapshot.id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="text-sm font-semibold text-[var(--text)]">{snapshot.title}</div>
                  {snapshot.summary && <div className="mt-2 text-sm text-[var(--text)]">{snapshot.summary}</div>}
                  <div className="mt-2 text-xs text-[var(--muted)]">{snapshot.agent_name} · {formatTime(snapshot.created_at)}</div>
                </div>
              ))}
              {snapshots.length === 0 && (
                <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
                  No snapshots created yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
