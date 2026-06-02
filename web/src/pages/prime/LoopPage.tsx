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

// Cloud providers inferred from provider_used / model_used names
const CLOUD_HINTS = ['anthropic', 'openai', 'groq', 'mistral', 'cohere', 'gemini', 'claude', 'gpt', 'o1', 'o3', 'o4']
function isCloudSession(s: PrimeSession): boolean {
  const p = (s.provider_used ?? '').toLowerCase()
  const m = (s.model_used ?? '').toLowerCase()
  return CLOUD_HINTS.some((h) => p.includes(h) || m.includes(h))
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
    const label = new Date(midMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

// ── Token breakdown by model ───────────────────────────────────────────────

function ModelBreakdown({ session }: { session: PrimeSession }) {
  const tokens = sessionTokens(session)
  if (tokens === 0) return null

  const model = session.model_used ?? 'Unknown model'
  const provider = session.provider_used ?? null
  const cloud = isCloudSession(session)

  return (
    <div>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Token usage</div>
      <div className="rounded-md border border-[var(--border-soft)] bg-[var(--panel-subtle)] overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-2">
          <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            cloud
              ? 'bg-amber-400/15 text-amber-300'
              : 'bg-emerald-400/15 text-emerald-300'
          }`}>
            {cloud ? 'cloud' : 'local'}
          </span>
          <span className="flex-1 font-mono text-[11px] text-[var(--text)] truncate">{model}</span>
          {provider && <span className="text-[10px] text-[var(--muted)] flex-shrink-0">{provider}</span>}
          <span className="ml-auto flex-shrink-0 font-semibold text-[var(--text)]">{tokens.toLocaleString()}</span>
          <span className="text-[10px] text-[var(--muted)]">tok</span>
        </div>
      </div>
    </div>
  )
}

// ── Tick detail ────────────────────────────────────────────────────────────

function TickDetail({ session }: { session: PrimeSession }) {
  const actions = Array.isArray(session.actions_taken)
    ? session.actions_taken as Array<{ type?: string; reason?: string }>
    : []
  const failedModules = (session.module_runs ?? []).filter((r) => r.status === 'failed')
  const isFailed = session.status === 'failed'

  return (
    <div className="mt-2 rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] p-3 flex flex-col gap-3 text-xs">
      {/* Meta row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--muted)]">
        <span>{new Date(session.started_at).toLocaleString()}</span>
        {session.last_step && <span>Last step: <span className="font-mono text-[var(--text)]">{session.last_step}</span></span>}
      </div>

      {/* Failure banner — error + failed modules */}
      {isFailed && (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/8 px-3 py-2 flex flex-col gap-1.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Failure detail</div>
          {session.error && (
            <div className="font-mono text-[11px] text-amber-300 break-all">{session.error}</div>
          )}
          {session.reasoning_summary && session.reasoning_summary !== session.error && (
            <div className="text-[11px] text-amber-200/80 leading-relaxed">{session.reasoning_summary}</div>
          )}
          {failedModules.length > 0 && (
            <div className="mt-1 flex flex-col gap-1">
              {failedModules.map((m) => (
                <div key={m.id} className="rounded bg-amber-400/10 px-2 py-1 text-[11px]">
                  <span className="font-semibold text-amber-300">{m.module_id}</span>
                  {m.detail && <span className="ml-2 text-amber-200/70">{m.detail}</span>}
                </div>
              ))}
            </div>
          )}
          {!session.error && !session.reasoning_summary && failedModules.length === 0 && (
            <div className="text-[11px] text-amber-200/60">No error detail recorded. Check backend logs for session {session.id}.</div>
          )}
        </div>
      )}

      {/* Reasoning (non-failed sessions) */}
      {!isFailed && session.reasoning_summary && (
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Reasoning</div>
          <div className="text-[var(--text)] leading-relaxed">{session.reasoning_summary}</div>
        </div>
      )}

      {/* Token breakdown */}
      <ModelBreakdown session={session} />

      {/* Actions */}
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

      {actions.length === 0 && !isQuiescent(session) && !isFailed && (
        <div className="text-[var(--muted)]">No actions dispatched this tick.</div>
      )}
    </div>
  )
}

// ── Stat tile ──────────────────────────────────────────────────────────────

function StatTile({ label, value, sub, accent, warn }: {
  label: string
  value: string
  sub?: string
  accent?: boolean
  warn?: boolean
}) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{label}</div>
      <div className={`mt-1 text-2xl font-bold leading-none ${accent ? 'text-indigo-400' : warn ? 'text-amber-400' : 'text-[var(--text)]'}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[10px] text-[var(--muted)]">{sub}</div>}
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
    const failed = sessions.filter((s) => s.status === 'failed').length
    const actions = sessions.reduce((n, s) => n + sessionActions(s), 0)

    // Cloud vs local token split
    const cloudTokens = sessions
      .filter((s) => !isQuiescent(s) && isCloudSession(s))
      .reduce((n, s) => n + sessionTokens(s), 0)
    const localTokens = sessions
      .filter((s) => !isQuiescent(s) && !isCloudSession(s) && sessionTokens(s) > 0)
      .reduce((n, s) => n + sessionTokens(s), 0)

    return { total, skipped, failed, actions, cloudTokens, localTokens }
  }, [sessions])

  const buckets = useMemo(() => buildBuckets(sessions, range), [sessions, range])
  const maxTokens = useMemo(() => Math.max(...buckets.map((b) => b.tokens), 1), [buckets])

  const RANGES: TimeRange[] = ['1h', '6h', '24h', '7d']

  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Ticks" value={stats.total.toLocaleString()} />
        <StatTile
          label="Skipped"
          value={stats.total > 0 ? stats.skipped.toLocaleString() : '—'}
          sub={stats.total > 0 ? `${Math.round((stats.skipped / stats.total) * 100)}%` : undefined}
          accent
        />
        <StatTile
          label="Failed"
          value={stats.failed > 0 ? stats.failed.toLocaleString() : '0'}
          warn={stats.failed > 0}
        />
        <StatTile label="Actions" value={stats.actions.toLocaleString()} />
        <StatTile
          label="Cloud tokens"
          value={stats.cloudTokens > 0 ? stats.cloudTokens.toLocaleString() : '—'}
          sub="Anthropic · OpenAI"
        />
        <StatTile
          label="Local tokens"
          value={stats.localTokens > 0 ? stats.localTokens.toLocaleString() : '—'}
          sub="Ollama · LiteLLM"
        />
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

      {/* Tick list — fixed height with scroll */}
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] flex flex-col min-h-0">
        <div className="border-b border-[var(--border-soft)] px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] flex-shrink-0">
          Recent ticks
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: 480 }}>
          {isLoading && (
            <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">Loading…</div>
          )}
          {!isLoading && displaySessions.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">No ticks in this range.</div>
          )}
          <div className="divide-y divide-[var(--border-soft)]">
            {displaySessions.map((s) => {
              const quiescent = isQuiescent(s)
              const failed = s.status === 'failed'
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
                    {/* Failed: show last_step as a hint in the row */}
                    {failed && s.last_step && (
                      <span className="text-[10px] text-amber-400/70 font-mono ml-1">@ {s.last_step}</span>
                    )}
                    {!quiescent && sessionTokens(s) > 0 && (
                      <span className="ml-auto text-[var(--muted)]">{sessionTokens(s).toLocaleString()} tok</span>
                    )}
                    {sessionActions(s) > 0 && (
                      <span className="ml-2 rounded-full bg-indigo-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
                        {sessionActions(s)}↗
                      </span>
                    )}
                    {quiescent && (
                      <span className="ml-auto text-[10px] text-[var(--muted)]">quiescent</span>
                    )}
                    {/* Model badge on active rows */}
                    {!quiescent && !failed && s.model_used && (
                      <span className="ml-2 hidden sm:inline text-[10px] text-[var(--muted)] font-mono truncate max-w-[120px]">{s.model_used}</span>
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
    </div>
  )
}
