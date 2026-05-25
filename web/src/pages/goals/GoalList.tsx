// GoalList — Agentic Control Plane (spec 016, T017)
// Lists all goals with status, priority, and progress summary.

import { useQuery } from '@tanstack/react-query'

const API_ORIGIN = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '')
const ROOT_BASE = API_ORIGIN || ''

export interface GoalSummary {
  id: string
  title: string
  status: string
  priority: 'low' | 'normal' | 'high'
  currentSummary: string
  updatedAt: string
}

async function fetchGoals(): Promise<GoalSummary[]> {
  const res = await fetch(`${ROOT_BASE}/api/control-plane/goals`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<GoalSummary[]>
}

// ── Badge helpers ────────────────────────────────────────────────

function statusBadge(status: string) {
  const map: Record<string, { dot: string; label: string; text: string }> = {
    draft:             { dot: 'bg-slate-400/60', label: 'draft', text: 'text-[var(--muted)]' },
    queued:            { dot: 'bg-blue-400', label: 'queued', text: 'text-blue-400' },
    in_progress:       { dot: 'bg-[var(--s-run-bd)]', label: 'in progress', text: 'text-[var(--s-run-tx)]' },
    awaiting_approval: { dot: 'bg-amber-400', label: 'awaiting approval', text: 'text-amber-400' },
    blocked:           { dot: 'bg-[var(--s-blk-bd)]', label: 'blocked', text: 'text-[var(--s-blk-tx)]' },
    completed:         { dot: 'bg-[var(--s-ok-bd)]', label: 'completed', text: 'text-[var(--s-ok-tx)]' },
    failed:            { dot: 'bg-rose-400', label: 'failed', text: 'text-rose-400' },
    cancelled:         { dot: 'bg-slate-500/60', label: 'cancelled', text: 'text-[var(--muted)]' },
  }
  return map[status] ?? { dot: 'bg-slate-500/60', label: status, text: 'text-[var(--muted)]' }
}

function priorityLabel(priority: string) {
  switch (priority) {
    case 'high':   return { label: 'high', cls: 'text-rose-400' }
    case 'normal': return { label: 'normal', cls: 'text-[var(--muted)]' }
    case 'low':    return { label: 'low', cls: 'text-blue-300/70' }
    default:       return { label: priority, cls: 'text-[var(--muted)]' }
  }
}

function formatTime(iso?: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return d.toLocaleDateString()
}

// ── Skeleton ─────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel)] p-4 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2 flex-1">
          <div className="h-4 w-48 rounded bg-[var(--panel-subtle)]" />
          <div className="h-3 w-full max-w-md rounded bg-[var(--panel-subtle)]" />
        </div>
        <div className="h-5 w-20 rounded bg-[var(--panel-subtle)]" />
      </div>
      <div className="mt-3 flex gap-4">
        <div className="h-3 w-16 rounded bg-[var(--panel-subtle)]" />
        <div className="h-3 w-12 rounded bg-[var(--panel-subtle)]" />
      </div>
    </div>
  )
}

// ── Goal card ────────────────────────────────────────────────────

function GoalCard({ goal, onNavigate }: { goal: GoalSummary; onNavigate: (id: string) => void }) {
  const badge = statusBadge(goal.status)
  const prio = priorityLabel(goal.priority)

  return (
    <button
      type="button"
      onClick={() => onNavigate(goal.id)}
      className="w-full text-left rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel)] p-4 transition hover:bg-[var(--panel-subtle)] hover:border-[var(--sel-bd)]/50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[var(--text)] truncate">{goal.title}</div>
          {goal.currentSummary && (
            <div className="mt-1 text-xs text-[var(--muted)] line-clamp-2">{goal.currentSummary}</div>
          )}
        </div>
        <div className={`shrink-0 flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-medium ${badge.text}`}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${badge.dot}`} />
          {badge.label}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-4 text-[11px]">
        <span className={`${prio.cls}`}>priority: {prio.label}</span>
        <span className="text-[var(--muted)]">updated {formatTime(goal.updatedAt)}</span>
      </div>
    </button>
  )
}

// ── Main page ────────────────────────────────────────────────────

export function GoalList() {
  const { data: goals, isLoading, isError } = useQuery({
    queryKey: ['goals'],
    queryFn: fetchGoals,
    refetchInterval: 30_000,
  })

  return (
    <div className="p-4">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-sm text-[var(--muted)]">Goals</h2>
      </div>

      {isError && <p className="text-[var(--s-blk-tx)] text-sm mb-3">Failed to load goals.</p>}

      {isLoading ? (
        <div className="space-y-3">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : !goals || goals.length === 0 ? (
        <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-8 text-center">
          <p className="text-sm text-[var(--muted)]">No goals yet.</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Goals will appear here once created through the control plane API.</p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="goal-list">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onNavigate={(id) => {
                window.location.hash = `/goals/${id}`
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
