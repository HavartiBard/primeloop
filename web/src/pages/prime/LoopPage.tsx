import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPrimeLoopSessions } from '../../api'
import type { PrimeSession } from '../../types'

type TimeRange = '1h' | '6h' | '24h' | '7d'

const RANGE_MS: Record<TimeRange, number> = {
  '1h':  1 * 60 * 60 * 1000,
  '6h':  6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function isQuiescent(s: PrimeSession): boolean {
  return (s.reasoning_summary ?? '').startsWith('Skipped:')
}

function sessionTokens(s: PrimeSession): number {
  return s.token_count ?? 0
}

function sessionActions(s: PrimeSession): number {
  return Array.isArray(s.actions_taken) ? s.actions_taken.length : 0
}

function statusDot(s: PrimeSession) {
  if (s.status === 'failed') return <span className="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0 mt-0.5" />
  if (isQuiescent(s)) return <span className="h-2 w-2 rounded-full bg-[var(--border-soft)] flex-shrink-0 mt-0.5" />
  return <span className="h-2 w-2 rounded-full bg-indigo-400 flex-shrink-0 mt-0.5" />
}

function statusLabel(s: PrimeSession) {
  if (s.status === 'failed') return <span className="font-semibold text-amber-400">Failed</span>
  if (isQuiescent(s)) return <span className="text-[var(--muted)]">Skipped</span>
  return <span className="font-semibold text-[var(--text)]">Active</span>
}

// ── Bar chart ──────────────────────────────────────────────────────────────

interface Bucket {
  label: string
  tokens: number
  hasActive: boolean
  hasFailed: boolean
  sessions: PrimeSession[]
}

function buildBuckets(sessions: PrimeSession[], range: TimeRange): Bucket[] {
  const bucketCount = range === '1h' ? 12 : range === '6h' ? 12 : range === '24h' ? 48 : 56
  const bucketMs = RANGE_MS[range] / bucketCount
  const now = Date.now()
  const start = now - RANGE_MS[range]

  const buckets: Bucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const bucketStart = start + i * bucketMs
    const bucketEnd = bucketStart + bucketMs
    const midMs = (bucketStart + bucketEnd) / 2
    const midDate = new Date(midMs)
    const label = midDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return { label, tokens: 0, hasActive: false, hasFailed: false, sessions: [] }
  })

  for (const s of sessions) {
    const t = new Date(s.started_at).getTime()
    if (t < start || t > now) continue
    const idx = Math.min(Math.floor((t - start) / bucketMs), bucketCount - 1)
    const b = buckets[idx]
    b.tokens += sessionTokens(s)
    b.sessions.push(s)
    if (s.status === 'failed') b.hasFailed = true
    else if (!isQuiescent(s)) b.hasActive = true
  }

  return buckets
}

// ── Tick detail ────────────────────────────────────────────────────────────

function TickDetail({ session }: { session: PrimeSession }) {
  const actions = Array.isArray(session.actions_taken) ? session.actions_taken as Array<{ type?: string; reason?: string }> : []
  return (
    <div className="mt-2 rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] p-3 flex flex-col gap-3 text-xs">
      <div className="flex gap-4 text-[var(--muted)]">
        <span>{new Date(session.started_at).toLocaleString()}</span>
        {session.model_used && <span>Model: {session.model_used}</span>}
        {sessionTokens(session) > 0 && <span>{sessionTokens(session).toLocaleString()} tokens</span>}
      </div>

      {session.reasoning_summary && (
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Reasoning</div>
          <div className="text-[var(--text)] leading-relaxed">{session.reasoning_summary}</div>
        </div>
      )}

      {actions.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Actions ({actions.length})</div>
          <div className="flex flex-col gap-1">
            {actions.map((a, i) => (
              <div key={i} className="rounded-md bg-[var(--panel-subtle)] px-2.5 py-1.5">
                <span className="font-semibold text-[var(--text)]">{a.type ?? '?'}</span>
                {a.reason && <span className="text-[var(--muted)] ml-2">{a.reason}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {actions.length === 0 && !isQuiescent(session) && session.status !== 'failed' && (
        <div className="text-[var(--muted)]">No actions dispatched this tick.</div>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────

export function LoopPage() {
  const savedRange = (typeof window !== 'undefined'
    ? window.localStorage.getItem('prime-loop-time-range')
    : null) as TimeRange | null
  const [range, setRange] = useState<TimeRange>(savedRange ?? '24h')
  const [activeOnly, setActiveOnly] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  function changeRange(r: TimeRange) {
    setRange(r)
    window.localStorage.setItem('prime-loop-time-range', r)
  }

  const limit = range === '7d' ? 2500 : 500
  const { data: allSessions = [], isLoading } = useQuery({
    queryKey: ['prime-loop-sessions', limit],
    queryFn: () => fetchPrimeLoopSessions(limit),
    refetchInterval: 30_000,
  })

  const sessions = useMemo(() => {
    const cutoff = Date.now() - RANGE_MS[range]
    return allSessions.filter((s) => new Date(s.started_at).getTime() >= cutoff)
  }, [allSessions, range])

  const displaySessions = useMemo(
    () => activeOnly ? sessions.filter((s) => !isQuiescent(s)) : sessions,
    [sessions, activeOnly]
  )

  const stats = useMemo(() => {
    const total = sessions.length
    const skipped = sessions.filter(isQuiescent).length
    const tokens = sessions.reduce((n, s) => n + sessionTokens(s), 0)
    const actions = sessions.reduce((n, s) => n + sessionActions(s), 0)
    return { total, skipped, tokens, actions }
  }, [sessions])

  const buckets = useMemo(() => buildBuckets(sessions, range), [sessions, range])
  const maxTokens = useMemo(() => Math.max(...buckets.map((b) => b.tokens), 1), [buckets])

  const RANGES: TimeRange[] = ['1h', '6h', '24h', '7d']

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Ticks', value: stats.total.toLocaleString() },
          {
            label: 'Skipped',
            value: stats.total > 0
              ? `${stats.skipped.toLocaleString()} (${Math.round((stats.skipped / stats.total) * 100)}%)`
              : '—',
            accent: true,
          },
          { label: 'Tokens used', value: stats.tokens > 0 ? stats.tokens.toLocaleString() : '—' },
          { label: 'Actions taken', value: stats.actions.toLocaleString() },
        ].map(({ label, value, accent }) => (
          <div key={label} className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{label}</div>
            <div className={`mt-1 text-2xl font-bold ${accent ? 'text-indigo-400' : 'text-[var(--text)]'}`}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Time range + filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => changeRange(r)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                range === r
                  ? 'border-indigo-400 bg-indigo-400/15 text-indigo-300'
                  : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="accent-indigo-400"
          />
          Active only
        </label>
        <span className="ml-auto text-xs text-[var(--muted)]">
          {isLoading ? 'Loading…' : `${displaySessions.length} ticks`}
        </span>
      </div>

      {/* Activity bar chart */}
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] p-4">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          Activity — {range} (each bar = {range === '7d' ? '3h' : range === '24h' ? '30 min' : '5 min'})
        </div>
        <div className="flex items-end gap-px" style={{ height: 56 }}>
          {buckets.map((b, i) => {
            const heightPct = b.tokens > 0 ? Math.max(8, Math.round((b.tokens / maxTokens) * 100)) : 6
            const color = b.hasFailed
              ? 'bg-amber-400'
              : b.hasActive
                ? 'bg-indigo-400'
                : 'bg-[var(--border-soft)]'
            const title = `${b.label} · ${b.sessions.length} tick${b.sessions.length !== 1 ? 's' : ''} · ${b.tokens.toLocaleString()} tokens`
            return (
              <div
                key={i}
                title={title}
                className={`flex-1 rounded-sm transition-all ${color}`}
                style={{ height: `${heightPct}%` }}
              />
            )
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
          <span>{range} ago</span>
          <span>now</span>
        </div>
        <div className="mt-2 flex gap-4 text-[10px] text-[var(--muted)]">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-indigo-400" />Active</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-[var(--border-soft)]" />Skipped</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-amber-400" />Failed</span>
        </div>
      </div>

      {/* Tick list */}
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel)]">
        <div className="border-b border-[var(--border-soft)] px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          Recent ticks
        </div>
        {isLoading && (
          <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">Loading…</div>
        )}
        {!isLoading && displaySessions.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">No ticks in this range.</div>
        )}
        <div className="divide-y divide-[var(--border-soft)]">
          {displaySessions.map((s) => {
            const quiescent = isQuiescent(s)
            const isOpen = expanded === s.id
            return (
              <div key={s.id}>
                <button
                  onClick={() => setExpanded(isOpen ? null : s.id)}
                  className={`w-full flex items-start gap-3 px-4 py-2.5 text-left text-xs transition hover:bg-[var(--panel-subtle)] ${quiescent ? 'opacity-50 hover:opacity-100' : ''}`}
                >
                  {statusDot(s)}
                  <span className="w-20 shrink-0 text-[var(--muted)]">{relativeTime(s.started_at)}</span>
                  {statusLabel(s)}
                  {!quiescent && sessionTokens(s) > 0 && (
                    <span className="ml-auto text-[var(--muted)]">{sessionTokens(s).toLocaleString()} tokens</span>
                  )}
                  {sessionActions(s) > 0 && (
                    <span className="ml-2 rounded-full bg-indigo-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
                      {sessionActions(s)} action{sessionActions(s) !== 1 ? 's' : ''}
                    </span>
                  )}
                  {quiescent && (
                    <span className="ml-auto text-[10px] text-[var(--muted)]">quiescent</span>
                  )}
                </button>
                {isOpen && (
                  <div className="px-4 pb-3">
                    <TickDetail session={s} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
