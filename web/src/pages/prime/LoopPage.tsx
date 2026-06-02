import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { abortPrimeSession, fetchPrimeLoopSessions, fetchPrimeSession } from '../../api'
import type { AgentEvent, PrimeSession } from '../../types'
import { useLoopStatus } from '../../hooks/useLoopStatus'
import { useWebSocket } from '../../hooks/useWebSocket'

type TimeRange = '1h' | '6h' | '24h' | '7d'

const RANGE_MS: Record<TimeRange, number> = {
  '1h':  1 * 60 * 60 * 1000,
  '6h':  6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
}

const CLOUD_HINTS = ['anthropic', 'openai', 'groq', 'mistral', 'cohere', 'gemini', 'claude', 'gpt', 'o1', 'o3', 'o4']
function isCloudSession(s: PrimeSession): boolean {
  const p = (s.provider_used ?? '').toLowerCase()
  const m = (s.model_used ?? '').toLowerCase()
  return CLOUD_HINTS.some((h) => p.includes(h) || m.includes(h))
}

// Stages that involve the LLM — drives colour scheme
const LLM_STAGES = new Set(['decision', 'action', 'feedback', 'learning'])
function isLlmStep(lastStep: string | null | undefined): boolean {
  if (!lastStep) return false
  const stage = lastStep.replace(/^(module|shadow):/, '').split('.')[0]
  return LLM_STAGES.has(stage)
}

const STEP_LABELS: Record<string, string> = {
  trigger: 'Ingesting', debounce: 'Checking', context: 'Analyzing',
  policy: 'Evaluating', observer: 'Observing',
  decision: 'Thinking', action: 'Delegating', feedback: 'Processing', learning: 'Learning',
}
function stepLabel(lastStep: string | null | undefined): string {
  if (!lastStep) return 'Analyzing'
  const stage = lastStep.replace(/^(module|shadow):/, '').split('.')[0]
  return STEP_LABELS[stage] ?? 'Running'
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
function sessionTokens(s: PrimeSession): number { return s.token_count ?? 0 }
function sessionActions(s: PrimeSession): number {
  return Array.isArray(s.actions_taken) ? s.actions_taken.length : 0
}

// ── Bar chart ─────────────────────────────────────────────────────────────

interface Bucket {
  label: string; tokens: number; hasActive: boolean; hasFailed: boolean; sessions: PrimeSession[]
}

function buildBuckets(sessions: PrimeSession[], range: TimeRange): Bucket[] {
  const bucketCount = range === '1h' ? 12 : range === '6h' ? 12 : range === '24h' ? 48 : 56
  const bucketMs = RANGE_MS[range] / bucketCount
  const now = Date.now(), start = now - RANGE_MS[range]
  const buckets: Bucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const mid = start + i * bucketMs + bucketMs / 2
    return { label: new Date(mid).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), tokens: 0, hasActive: false, hasFailed: false, sessions: [] }
  })
  for (const s of sessions) {
    const t = new Date(s.started_at).getTime()
    if (t < start || t > now) continue
    const b = buckets[Math.min(Math.floor((t - start) / bucketMs), bucketCount - 1)]
    b.tokens += sessionTokens(s); b.sessions.push(s)
    if (s.status === 'failed') b.hasFailed = true
    else if (!isQuiescent(s)) b.hasActive = true
  }
  return buckets
}

// ── Stat tile ─────────────────────────────────────────────────────────────

function StatTile({ label, value, sub, accent, warn }: { label: string; value: string; sub?: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">{label}</div>
      <div className={`mt-1 text-2xl font-bold leading-none ${accent ? 'text-indigo-400' : warn ? 'text-amber-400' : 'text-[var(--text)]'}`}>{value}</div>
      {sub && <div className="mt-1 text-[10px] text-[var(--muted)]">{sub}</div>}
    </div>
  )
}

// ── Token breakdown ───────────────────────────────────────────────────────

function ModelBreakdown({ session }: { session: PrimeSession }) {
  const tokens = sessionTokens(session)
  if (tokens === 0) return null
  const model = session.model_used ?? 'Unknown model'
  const cloud = isCloudSession(session)
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Token usage</div>
      <div className="rounded-md border border-[var(--border-soft)] bg-[var(--panel-subtle)] overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-2">
          <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${cloud ? 'bg-amber-400/15 text-amber-300' : 'bg-emerald-400/15 text-emerald-300'}`}>{cloud ? 'cloud' : 'local'}</span>
          <span className="flex-1 font-mono text-[11px] text-[var(--text)] truncate">{model}</span>
          {session.provider_used && <span className="text-[10px] text-[var(--muted)] flex-shrink-0">{session.provider_used}</span>}
          <span className="ml-auto flex-shrink-0 font-semibold text-[var(--text)]">{tokens.toLocaleString()}</span>
          <span className="text-[10px] text-[var(--muted)]">tok</span>
        </div>
      </div>
    </div>
  )
}

// ── Tick detail (completed sessions) ─────────────────────────────────────

function TickDetail({ session }: { session: PrimeSession }) {
  const actions = Array.isArray(session.actions_taken) ? session.actions_taken as Array<{ type?: string; reason?: string }> : []
  const failedModules = (session.module_runs ?? []).filter((r) => r.status === 'failed')
  const isFailed = session.status === 'failed'
  return (
    <div className="mt-2 rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] p-3 flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--muted)]">
        <span>{new Date(session.started_at).toLocaleString()}</span>
        {session.last_step && <span>Last step: <span className="font-mono text-[var(--text)]">{session.last_step}</span></span>}
      </div>
      {isFailed && (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/8 px-3 py-2 flex flex-col gap-1.5">
          <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Failure detail</div>
          {session.error && <div className="font-mono text-[11px] text-amber-300 break-all">{session.error}</div>}
          {session.reasoning_summary && session.reasoning_summary !== session.error && <div className="text-[11px] text-amber-200/80 leading-relaxed">{session.reasoning_summary}</div>}
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
            <div className="text-[11px] text-amber-200/60">No error detail. Check backend logs for session {session.id}.</div>
          )}
        </div>
      )}
      {!isFailed && session.reasoning_summary && (
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Reasoning</div>
          <div className="text-[var(--text)] leading-relaxed">{session.reasoning_summary}</div>
        </div>
      )}
      <ModelBreakdown session={session} />
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
      {actions.length === 0 && !isQuiescent(session) && !isFailed && <div className="text-[var(--muted)]">No actions dispatched this tick.</div>}
    </div>
  )
}

// ── Live session banner ───────────────────────────────────────────────────

interface LiveStepEvent {
  module_id: string; stage: string; status: string; detail?: string; mode?: string
}

function LiveSessionBanner({ session, label, elapsedSeconds, wsEvents }: {
  session: PrimeSession
  label: string
  elapsedSeconds: number | null
  wsEvents: AgentEvent[]
}) {
  const [open, setOpen] = useState(true)
  const [killing, setKilling] = useState(false)
  const qc = useQueryClient()
  const isLlm = isLlmStep(session.last_step)

  // Poll session detail while running — gives us historical module_runs that
  // fired before this page was opened (WS only has events since connect time)
  const { data: sessionDetail } = useQuery({
    queryKey: ['prime-live-session', session.id],
    queryFn: () => fetchPrimeSession(session.id),
    refetchInterval: 3_000,
    staleTime: 0,
  })

  // Seed from module_runs (historical), then overlay WS events (real-time)
  const liveSteps = useMemo<LiveStepEvent[]>(() => {
    // Build map from module_runs first (authoritative history)
    const byKey = new Map<string, LiveStepEvent>()
    for (const r of sessionDetail?.module_runs ?? []) {
      const key = `${r.module_id}:${r.status}`
      if (!byKey.has(key)) {
        byKey.set(key, {
          module_id: r.module_id,
          stage: r.module_id.split('.')[0],
          status: r.status,
          detail: r.detail,
          mode: undefined,
        })
      }
    }
    // Overlay WS events (may include in-progress steps not yet in module_runs)
    for (const ev of [...wsEvents].reverse()) {
      if (ev.agent !== 'prime' || ev.type !== 'prime.turn.step') continue
      if (ev.payload['session_id'] !== session.id) continue
      const mid = ev.payload['module_id'] as string
      const status = ev.payload['status'] as string
      const key = `${mid}:${status}`
      if (!byKey.has(key)) {
        byKey.set(key, {
          module_id: mid,
          stage: ev.payload['stage'] as string,
          status,
          detail: ev.payload['detail'] as string | undefined,
          mode: ev.payload['mode'] as string | undefined,
        })
      }
    }
    return [...byKey.values()]
  }, [sessionDetail?.module_runs, wsEvents, session.id])

  const liveReasoning = useMemo(() => {
    for (const ev of wsEvents) {
      if (ev.agent === 'prime' && ev.type === 'prime.turn.reasoning' && ev.payload['session_id'] === session.id) {
        return ev.payload['reasoning'] as string | undefined
      }
    }
    return undefined
  }, [wsEvents, session.id])

  const liveModel = useMemo(() => {
    for (const ev of wsEvents) {
      if (ev.agent === 'prime' && ev.type === 'prime.turn.reasoning' && ev.payload['session_id'] === session.id) {
        const m = ev.payload['model_used'] as string | undefined
        const p = ev.payload['provider_used'] as string | undefined
        return { model: m, provider: p }
      }
    }
    return null
  }, [wsEvents, session.id])

  const liveActions = useMemo(() => {
    for (const ev of wsEvents) {
      if (ev.agent === 'prime' && ev.type === 'prime.turn.actions' && ev.payload['session_id'] === session.id) {
        return (ev.payload['actions'] as Array<{ type?: string; reason?: string }> | undefined) ?? []
      }
    }
    return []
  }, [wsEvents, session.id])

  const elapsed = elapsedSeconds ?? Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000)
  const elapsedStr = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  const kill = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (killing) return
    setKilling(true)
    try {
      await abortPrimeSession(session.id)
      await qc.invalidateQueries({ queryKey: ['prime-loop-status-sessions'] })
      await qc.invalidateQueries({ queryKey: ['prime-loop-sessions'] })
    } catch { /* chip will update on next poll */ }
    finally { setKilling(false) }
  }, [session.id, killing, qc])

  const borderCls = isLlm ? 'border-emerald-400/40 bg-emerald-400/5' : 'border-sky-400/40 bg-sky-400/5'
  const dotCls = isLlm ? 'bg-emerald-400' : 'bg-sky-400'
  const textCls = isLlm ? 'text-emerald-300' : 'text-sky-300'
  const mutedCls = isLlm ? 'text-emerald-300/60' : 'text-sky-300/60'

  return (
    <div className={`rounded-xl border ${borderCls}`}>
      {/* Header row */}
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 text-left text-xs">
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotCls} opacity-60`} />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${dotCls}`} />
        </span>
        <span className={`font-semibold ${textCls}`}>Live</span>
        <span className={`font-medium ${textCls}`}>{label}</span>
        {session.last_step && <span className={`font-mono text-[10px] ${mutedCls}`}>{session.last_step}</span>}
        {/* Model badge from live WS events or session */}
        {(liveModel?.model ?? session.model_used) && (
          <span className={`hidden sm:inline font-mono text-[10px] ${mutedCls} truncate max-w-[140px]`}>
            {liveModel?.model ?? session.model_used}
          </span>
        )}
        <span className={`ml-auto font-mono tabular-nums ${mutedCls}`}>{elapsedStr}</span>
        <button type="button" onClick={kill} disabled={killing} title="Kill this session"
          className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold opacity-50 hover:opacity-100 hover:text-rose-400 hover:bg-rose-400/10 transition disabled:opacity-30 ${textCls}`}>
          {killing ? '…' : 'Kill'}
        </button>
        <span className={mutedCls}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className={`border-t px-4 py-3 flex flex-col gap-3 ${isLlm ? 'border-emerald-400/20' : 'border-sky-400/20'}`}>

          {/* Provider / model */}
          {(liveModel?.model || liveModel?.provider || session.model_used || session.provider_used) && (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="font-bold uppercase tracking-widest text-[var(--muted)]">Model</span>
              <span className={`font-mono ${textCls}`}>{liveModel?.model ?? session.model_used ?? '—'}</span>
              {(liveModel?.provider ?? session.provider_used) && (
                <span className={`${mutedCls}`}>via {liveModel?.provider ?? session.provider_used}</span>
              )}
            </div>
          )}

          {/* Step pipeline */}
          {liveSteps.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Pipeline</div>
              {liveSteps.map((step, i) => {
                const done = step.status === 'completed'
                const failed = step.status === 'failed'
                const shadow = step.mode === 'shadow'
                return (
                  <div key={i} className={`flex items-start gap-2 text-[11px] ${shadow ? 'opacity-50' : ''}`}>
                    <span className="flex-shrink-0 mt-0.5">
                      {failed ? <span className="text-amber-400">✕</span>
                        : done ? <span className={textCls}>✓</span>
                          : <span className={`inline-block h-2 w-2 rounded-full animate-pulse ${dotCls} mt-0.5`} />}
                    </span>
                    <span className={`font-mono ${done ? 'text-[var(--muted)]' : failed ? 'text-amber-300' : textCls}`}>{step.module_id}</span>
                    {step.detail && <span className="text-[var(--muted)] truncate">{step.detail}</span>}
                    {shadow && <span className="text-[10px] text-[var(--muted)]">(shadow)</span>}
                  </div>
                )
              })}
              {/* Running indicator for current step */}
              {session.last_step && !liveSteps.some(s => s.module_id === session.last_step?.replace(/^(module|shadow):/, '') && s.status === 'completed') && (
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`inline-block h-2 w-2 rounded-full animate-pulse ${dotCls} flex-shrink-0`} />
                  <span className={`font-mono ${textCls}`}>{session.last_step.replace(/^(module|shadow):/, '')}</span>
                  <span className={`${mutedCls} animate-pulse`}>{isLlm ? 'waiting for LLM...' : 'processing...'}</span>
                </div>
              )}
            </div>
          )}

          {/* Live reasoning (appears when prime.turn.reasoning fires) */}
          {liveReasoning && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Reasoning</div>
              <div className={`leading-relaxed text-[11px] ${textCls} opacity-90`}>{liveReasoning}</div>
            </div>
          )}

          {/* Live actions (appears when prime.turn.actions fires) */}
          {liveActions.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Actions dispatched ({liveActions.length})</div>
              <div className="flex flex-col gap-1">
                {liveActions.map((a, i) => (
                  <div key={i} className={`rounded-md px-2.5 py-1.5 text-[11px] ${isLlm ? 'bg-emerald-400/8 border border-emerald-400/20' : 'bg-sky-400/8 border border-sky-400/20'}`}>
                    <span className={`font-semibold ${textCls}`}>{a.type ?? '?'}</span>
                    {a.reason && <span className={`ml-2 ${mutedCls}`}>{a.reason}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Waiting state */}
          {liveSteps.length === 0 && !liveReasoning && (
            <div className={`text-[11px] ${mutedCls} animate-pulse`}>Waiting for pipeline events...</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────

export function LoopPage() {
  const savedRange = (typeof window !== 'undefined' ? window.localStorage.getItem('prime-loop-time-range') : null) as TimeRange | null
  const [range, setRange] = useState<TimeRange>(savedRange ?? '24h')
  const [activeOnly, setActiveOnly] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const loopStatus = useLoopStatus()
  const { events: wsEvents } = useWebSocket('/ws')

  // Elapsed counter for live banner
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (elapsedRef.current) clearInterval(elapsedRef.current)
    if (!loopStatus.currentSession) { setElapsedSeconds(null); return }
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - new Date(loopStatus.currentSession!.started_at).getTime()) / 1000))
    tick()
    elapsedRef.current = setInterval(tick, 1000)
    return () => { if (elapsedRef.current) clearInterval(elapsedRef.current) }
  }, [loopStatus.currentSession?.id])

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
    const cloudTokens = sessions.filter((s) => !isQuiescent(s) && isCloudSession(s)).reduce((n, s) => n + sessionTokens(s), 0)
    const localTokens = sessions.filter((s) => !isQuiescent(s) && !isCloudSession(s) && sessionTokens(s) > 0).reduce((n, s) => n + sessionTokens(s), 0)
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
        <StatTile label="Skipped" value={stats.total > 0 ? stats.skipped.toLocaleString() : '—'} sub={stats.total > 0 ? `${Math.round((stats.skipped / stats.total) * 100)}%` : undefined} accent />
        <StatTile label="Failed" value={stats.failed > 0 ? stats.failed.toLocaleString() : '0'} warn={stats.failed > 0} />
        <StatTile label="Actions" value={stats.actions.toLocaleString()} />
        <StatTile label="Cloud tokens" value={stats.cloudTokens > 0 ? stats.cloudTokens.toLocaleString() : '—'} sub="Anthropic · OpenAI" />
        <StatTile label="Local tokens" value={stats.localTokens > 0 ? stats.localTokens.toLocaleString() : '—'} sub="Ollama · LiteLLM" />
      </div>

      {/* Time range + filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => changeRange(r)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${range === r ? 'border-indigo-400 bg-indigo-400/15 text-indigo-300' : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)] hover:text-[var(--text)]'}`}>
              {r}
            </button>
          ))}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} className="accent-indigo-400" />
          Active only
        </label>
        <span className="ml-auto text-xs text-[var(--muted)]">{isLoading ? 'Loading…' : `${displaySessions.length} ticks`}</span>
      </div>

      {/* Activity bar chart */}
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] p-4">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          Activity — {range} (each bar = {range === '7d' ? '3h' : range === '24h' ? '30 min' : '5 min'})
        </div>
        <div className="flex items-end gap-px" style={{ height: 56 }}>
          {buckets.map((b, i) => {
            const heightPct = b.tokens > 0 ? Math.max(8, Math.round((b.tokens / maxTokens) * 100)) : 6
            const color = b.hasFailed ? 'bg-amber-400' : b.hasActive ? 'bg-indigo-400' : 'bg-[var(--border-soft)]'
            return <div key={i} title={`${b.label} · ${b.sessions.length} tick${b.sessions.length !== 1 ? 's' : ''} · ${b.tokens.toLocaleString()} tokens`} className={`flex-1 rounded-sm transition-all ${color}`} style={{ height: `${heightPct}%` }} />
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]"><span>{range} ago</span><span>now</span></div>
        <div className="mt-2 flex gap-4 text-[10px] text-[var(--muted)]">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-indigo-400" />Active</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-[var(--border-soft)]" />Skipped</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-sm bg-amber-400" />Failed</span>
        </div>
      </div>

      {/* Live session banner */}
      {loopStatus.currentSession && (
        <LiveSessionBanner
          session={loopStatus.currentSession}
          label={loopStatus.label}
          elapsedSeconds={elapsedSeconds}
          wsEvents={wsEvents}
        />
      )}

      {/* Tick list */}
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] flex flex-col min-h-0">
        <div className="border-b border-[var(--border-soft)] px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] flex-shrink-0">Recent ticks</div>
        <div className="overflow-y-auto" style={{ maxHeight: 480 }}>
          {isLoading && <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">Loading…</div>}
          {!isLoading && displaySessions.length === 0 && <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">No ticks in this range.</div>}
          <div className="divide-y divide-[var(--border-soft)]">
            {displaySessions.map((s) => {
              const quiescent = isQuiescent(s)
              const failed = s.status === 'failed'
              const isOpen = expanded === s.id
              // Colour active (completed) sessions by whether they used LLM
              const hadLlm = (s.module_runs ?? []).some(r => LLM_STAGES.has(r.module_id.split('.')[0]))
              const activeDot = hadLlm
                ? <span className="h-2 w-2 rounded-full bg-emerald-400 flex-shrink-0 mt-0.5" />
                : <span className="h-2 w-2 rounded-full bg-sky-400 flex-shrink-0 mt-0.5" />
              const dot = failed
                ? <span className="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0 mt-0.5" />
                : quiescent
                  ? <span className="h-2 w-2 rounded-full bg-[var(--border-soft)] flex-shrink-0 mt-0.5" />
                  : activeDot
              return (
                <div key={s.id}>
                  <button onClick={() => setExpanded(isOpen ? null : s.id)}
                    className={`w-full flex items-start gap-3 px-4 py-2.5 text-left text-xs transition hover:bg-[var(--panel-subtle)] ${quiescent ? 'opacity-50 hover:opacity-100' : ''}`}>
                    {dot}
                    <span className="w-20 shrink-0 text-[var(--muted)]">{relativeTime(s.started_at)}</span>
                    {failed ? <span className="font-semibold text-amber-400">Failed</span>
                      : quiescent ? <span className="text-[var(--muted)]">Skipped</span>
                        : <span className={`font-semibold ${hadLlm ? 'text-emerald-300' : 'text-sky-300'}`}>Active</span>}
                    {failed && s.last_step && <span className="text-[10px] text-amber-400/70 font-mono ml-1">@ {s.last_step}</span>}
                    {!quiescent && sessionTokens(s) > 0 && <span className="ml-auto text-[var(--muted)]">{sessionTokens(s).toLocaleString()} tok</span>}
                    {sessionActions(s) > 0 && <span className="ml-2 rounded-full bg-indigo-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">{sessionActions(s)}↗</span>}
                    {quiescent && <span className="ml-auto text-[10px] text-[var(--muted)]">quiescent</span>}
                    {!quiescent && !failed && s.model_used && <span className="ml-2 hidden sm:inline text-[10px] text-[var(--muted)] font-mono truncate max-w-[120px]">{s.model_used}</span>}
                  </button>
                  {isOpen && <div className="px-4 pb-3"><TickDetail session={s} /></div>}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
