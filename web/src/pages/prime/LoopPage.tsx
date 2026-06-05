import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  abortPrimeSession,
  appendThreadMessage,
  createRuntimeWorkItem,
  createThread,
  fetchPrimeLoopSessions,
  sendPrimeMessage,
  fetchPrimeSession,
  fetchRuntimeWorkItems,
  fetchSessionTimeline,
  fetchThreads,
} from '../../api'
import type { AgentEvent, PrimeSession, RuntimeThread, RuntimeWorkItem, SessionTimelineEvent } from '../../types'
import { useLoopStatus } from '../../hooks/useLoopStatus'
import { useWebSocket } from '../../hooks/useWebSocket'

type TimeRange = '1h' | '6h' | '24h' | '7d'

const FOCUSED_ROOM_STORAGE_KEY = 'primeloop:focus-room-id'

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

function summarizeTimelinePayload(payload: Record<string, unknown>): string {
  if (typeof payload['content'] === 'string') return String(payload['content'])
  if (typeof payload['step'] === 'string') return String(payload['step'])
  if (typeof payload['status'] === 'string') return String(payload['status'])
  return JSON.stringify(payload)
}

function isQuiescent(s: PrimeSession): boolean {
  return (s.reasoning_summary ?? '').startsWith('Skipped:')
}

function truncateForTitle(value: string, max = 72): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 1)}…`
}

function errorSignature(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, '<uuid>')
    .replace(/\s+/g, ' ')
    .trim()
}

function investigationSummary(session: PrimeSession): string {
  return session.error?.trim() || session.reasoning_summary?.trim() || `Prime control-loop session ${session.id} failed`
}

function findExistingInvestigation(
  failureSignature: string,
  threads: RuntimeThread[],
  workItems: RuntimeWorkItem[],
): { thread: RuntimeThread | null; workItem: RuntimeWorkItem | null } {
  const workItem = workItems.find((item) => {
    const metadata = item.metadata ?? {}
    return metadata['failure_signature'] === failureSignature
      && metadata['investigation_status'] === 'open'
      && !['completed', 'failed', 'cancelled'].includes(item.status)
  }) ?? null

  const threadFromWorkItem = workItem?.thread_id
    ? threads.find((thread) => thread.id === workItem.thread_id) ?? null
    : null

  const thread = threadFromWorkItem ?? threads.find((item) => {
    const metadata = item.metadata ?? {}
    return metadata['failure_signature'] === failureSignature
      && metadata['kind'] === 'investigation'
      && item.status !== 'closed'
  }) ?? null

  return { thread, workItem }
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

function PipelineRuns({ session }: { session: PrimeSession }) {
  const runs = session.module_runs ?? []
  if (runs.length === 0) return null
  const hadLlm = runs.some(r => LLM_STAGES.has(r.module_id.split('.')[0]))
  const textCls = hadLlm ? 'text-emerald-300' : 'text-sky-300'
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Pipeline</div>
      <div className="flex flex-col gap-1">
        {runs.map((r) => (
          <div key={r.id} className="flex items-start gap-2 text-[11px]">
            <span className="flex-shrink-0 mt-0.5">
              {r.status === 'failed'
                ? <span className="text-amber-400">✕</span>
                : <span className={textCls}>✓</span>}
            </span>
            <span className={`font-mono ${r.status === 'failed' ? 'text-amber-300' : 'text-[var(--muted)]'}`}>{r.module_id}</span>
            {r.detail && <span className="text-[var(--muted)] truncate">{r.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

function TickDetail({
  session,
  onStartInvestigation,
  investigation,
}: {
  session: PrimeSession
  onStartInvestigation: (session: PrimeSession) => Promise<void>
  investigation?: { loading?: boolean; threadId?: string; workItemId?: string; error?: string }
}) {
  const actions = Array.isArray(session.actions_taken) ? session.actions_taken as Array<{ type?: string; reason?: string }> : []
  const failedModules = (session.module_runs ?? []).filter((r) => r.status === 'failed')
  const isFailed = session.status === 'failed'
  return (
    <div className="mt-2 rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] p-3 flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[var(--muted)]">
        <span>{new Date(session.started_at).toLocaleString()}</span>
        {session.model_used && <span className="font-mono">{session.model_used}</span>}
        {session.provider_used && <span className="opacity-60">via {session.provider_used}</span>}
      </div>

      {/* Failure banner */}
      {isFailed && (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/8 px-3 py-2 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Failure detail</div>
            <button
              type="button"
              onClick={() => { void onStartInvestigation(session) }}
              disabled={investigation?.loading}
              className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200 transition hover:bg-amber-400/20 disabled:cursor-wait disabled:opacity-60"
            >
              {investigation?.loading ? 'Starting…' : investigation?.threadId ? 'Open room' : 'Start investigation'}
            </button>
          </div>
          {session.error && <div className="font-mono text-[11px] text-amber-300 break-all">{session.error}</div>}
          {session.reasoning_summary && session.reasoning_summary !== session.error && <div className="text-[11px] text-amber-200/80 leading-relaxed">{session.reasoning_summary}</div>}
          {failedModules.length === 0 && !session.error && !session.reasoning_summary && (
            <div className="text-[11px] text-amber-200/60">No error detail recorded. Check backend logs for session {session.id}.</div>
          )}
          {investigation?.threadId && (
            <div className="text-[11px] text-amber-200/80">
              Investigation room ready{investigation.workItemId ? ` · work item ${investigation.workItemId}` : ''}.
            </div>
          )}
          {investigation?.error && (
            <div className="text-[11px] text-rose-200">{investigation.error}</div>
          )}
        </div>
      )}

      {/* Pipeline run history */}
      <PipelineRuns session={session} />

      {/* Reasoning */}
      {!isFailed && session.reasoning_summary && (
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Reasoning</div>
          <div className="text-[var(--text)] leading-relaxed">{session.reasoning_summary}</div>
        </div>
      )}

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
      {actions.length === 0 && !isQuiescent(session) && !isFailed && <div className="text-[var(--muted)]">No actions dispatched this tick.</div>}
    </div>
  )
}

// ── Live session banner ───────────────────────────────────────────────────

interface LiveStepEvent {
  module_id: string; stage: string; status: string; detail?: string; mode?: string
}

function LiveTickRow({ session, label, isLlmPhase, elapsedSeconds, wsEvents }: {
  session: PrimeSession
  label: string
  isLlmPhase: boolean
  elapsedSeconds: number | null
  wsEvents: AgentEvent[]
}) {
  const [open, setOpen] = useState(true)
  const [killing, setKilling] = useState(false)
  const qc = useQueryClient()
  const isLlm = isLlmPhase

  // Poll session detail while running — gives us historical module_runs that
  // fired before this page was opened (WS only has events since connect time)
  const { data: sessionDetail } = useQuery({
    queryKey: ['prime-live-session', session.id],
    queryFn: () => fetchPrimeSession(session.id),
    refetchInterval: 3_000,
    staleTime: 0,
  })

  // Seed from module_runs (historical), then overlay WS events (real-time).
  // Keyed by module_id only — "completed/failed" overwrites "started" so
  // each module appears as a single row, not one for start + one for finish.
  const STATUS_RANK: Record<string, number> = { started: 0, completed: 1, failed: 1 }
  const liveSteps = useMemo<LiveStepEvent[]>(() => {
    const byModule = new Map<string, LiveStepEvent>()

    const upsert = (step: LiveStepEvent) => {
      const existing = byModule.get(step.module_id)
      const rank = (s: string) => STATUS_RANK[s] ?? 0
      if (!existing || rank(step.status) >= rank(existing.status)) {
        byModule.set(step.module_id, step)
      }
    }

    // Historical module_runs first
    for (const r of sessionDetail?.module_runs ?? []) {
      upsert({ module_id: r.module_id, stage: r.module_id.split('.')[0], status: r.status, detail: r.detail, mode: undefined })
    }
    // Live WS events on top (iterate oldest→newest so completed wins over started)
    const relevant = [...wsEvents].reverse().filter(ev => ev.agent === 'prime' && ev.type === 'prime.turn.step' && ev.payload['session_id'] === session.id)
    for (const ev of relevant) {
      upsert({
        module_id: ev.payload['module_id'] as string,
        stage: ev.payload['stage'] as string,
        status: ev.payload['status'] as string,
        detail: ev.payload['detail'] as string | undefined,
        mode: ev.payload['mode'] as string | undefined,
      })
    }
    return [...byModule.values()]
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

  const dotCls = isLlm ? 'bg-emerald-400' : 'bg-sky-400'
  const textCls = isLlm ? 'text-emerald-300' : 'text-sky-300'
  const mutedCls = isLlm ? 'text-emerald-300/60' : 'text-sky-300/60'
  const rowBg = isLlm ? 'bg-emerald-400/5' : 'bg-sky-400/5'

  return (
    <div className={rowBg}>
      {/* Row header — same layout as completed tick rows */}
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-xs hover:brightness-110 transition">
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotCls} opacity-60`} />
          <span className={`relative inline-flex h-2 w-2 rounded-full ${dotCls}`} />
        </span>
        <span className="w-20 shrink-0 text-[var(--muted)]">{relativeTime(session.started_at)}</span>
        <span className={`shrink-0 font-semibold ${textCls}`}>{label}</span>
        <span className="hidden min-w-0 flex-1 sm:block">
          {(liveModel?.model ?? session.model_used) && (
            <span className={`block truncate font-mono text-[10px] ${mutedCls}`}>
              {liveModel?.model ?? session.model_used}
            </span>
          )}
        </span>
        <span className={`w-20 shrink-0 text-right font-mono tabular-nums text-[11px] ${mutedCls}`}>{sessionTokens(session).toLocaleString()} tok</span>
        <span className={`w-12 shrink-0 text-right font-mono text-[10px] ${liveActions.length > 0 ? 'text-indigo-300' : mutedCls}`}>{liveActions.length}↗</span>
        <span className={`w-12 shrink-0 text-right font-mono tabular-nums text-[11px] ${mutedCls}`}>{elapsedStr}</span>
        <button type="button" onClick={kill} disabled={killing} title="Kill this session"
          className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold opacity-50 hover:opacity-100 hover:text-rose-400 hover:bg-rose-400/10 transition disabled:opacity-30 ${textCls}`}>
          {killing ? '…' : 'Kill'}
        </button>
        <span className={`ml-1 ${mutedCls}`}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-3 flex flex-col gap-3">

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
              {/* Current in-progress step — only shown if not already in list */}
              {session.last_step && (() => {
                const currentId = session.last_step.replace(/^(module|shadow):/, '')
                if (liveSteps.some(s => s.module_id === currentId)) return null
                return (
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className={`inline-block h-2 w-2 rounded-full animate-pulse ${dotCls} flex-shrink-0`} />
                    <span className={`font-mono ${textCls}`}>{currentId}</span>
                    <span className={`${mutedCls} animate-pulse`}>{isLlm ? 'waiting for LLM...' : 'processing...'}</span>
                  </div>
                )
              })()}
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

function SessionTimelineInspector({
  threads,
}: {
  threads: RuntimeThread[]
}) {
  const [sessionId, setSessionId] = useState('')
  const [last, setLast] = useState(50)

  useEffect(() => {
    if (sessionId || threads.length === 0) return
    const focused = typeof window !== 'undefined' ? window.sessionStorage.getItem(FOCUSED_ROOM_STORAGE_KEY) : null
    setSessionId(focused && threads.some((thread) => thread.id === focused) ? focused : threads[0].id)
  }, [sessionId, threads])

  const timeline = useQuery({
    queryKey: ['session-timeline', sessionId, last],
    queryFn: () => fetchSessionTimeline(sessionId, { last }),
    enabled: sessionId.length > 0,
    staleTime: 5_000,
  })

  return (
    <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] flex flex-col min-h-0">
      <div className="border-b border-[var(--border-soft)] px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Session timeline</div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[var(--border-soft)] bg-[var(--panel-subtle)]">
        <label className="flex min-w-[280px] flex-1 flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          Session
          <input
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            list="prime-loop-session-options"
            placeholder="Paste a thread/delegation/session id"
            className="rounded-md border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-xs font-normal text-[var(--text)] outline-none focus:border-indigo-400"
          />
          <datalist id="prime-loop-session-options">
            {threads.map((thread) => (
              <option key={thread.id} value={thread.id}>{thread.title}</option>
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
          Window
          <select
            value={last}
            onChange={(event) => setLast(Number(event.target.value))}
            className="rounded-md border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-xs font-normal text-[var(--text)] outline-none focus:border-indigo-400"
          >
            {[20, 50, 100, 200].map((size) => (
              <option key={size} value={size}>Last {size}</option>
            ))}
          </select>
        </label>
      </div>

      {!sessionId && <div className="px-4 py-6 text-sm text-[var(--muted)]">Choose a session to inspect.</div>}
      {sessionId && timeline.isLoading && <div className="px-4 py-6 text-sm text-[var(--muted)]">Loading timeline…</div>}
      {sessionId && timeline.isError && <div className="px-4 py-6 text-sm text-rose-300">{timeline.error instanceof Error ? timeline.error.message : 'Failed to load timeline.'}</div>}
      {timeline.data && (
        <>
          <div className="px-4 py-2 text-[11px] text-[var(--muted)] border-b border-[var(--border-soft)]">
            {timeline.data.session.owner_type} · seq {timeline.data.session.first_seq}–{timeline.data.session.last_seq} · showing {timeline.data.events.length}
          </div>
          <div className="max-h-96 overflow-y-auto divide-y divide-[var(--border-soft)]">
            {timeline.data.events.length === 0 && (
              <div className="px-4 py-6 text-sm text-[var(--muted)]">No timeline events in this slice.</div>
            )}
            {timeline.data.events.map((event: SessionTimelineEvent) => (
              <div key={`${event.session_id}:${event.seq}:${event.event_type}`} className="px-4 py-3 text-xs">
                <div className="flex items-center gap-3">
                  <span className="w-12 shrink-0 font-mono text-[var(--muted)]">#{event.seq}</span>
                  <span className="rounded-full border border-[var(--border-soft)] px-2 py-0.5 font-mono text-[10px] text-[var(--text)]">{event.event_type}</span>
                  <span className="font-mono text-[10px] text-indigo-300">{event.actor}</span>
                  <span className="ml-auto text-[10px] text-[var(--muted)]">{relativeTime(event.created_at)}</span>
                </div>
                <div className="mt-1 pl-12 text-[var(--muted)] break-all">{summarizeTimelinePayload(event.payload)}</div>
              </div>
            ))}
          </div>
        </>
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
  const qcMain = useQueryClient()

  // When a new prime turn starts, immediately invalidate the status query so
  // the live banner appears within seconds rather than waiting 15s for the
  // next idle poll (non-LLM pipeline stages are done in a few seconds).
  const latestWsId = wsEvents[0]?.id
  useEffect(() => {
    const ev = wsEvents[0]
    if (ev?.agent === 'prime' && ev.type === 'prime.turn.started') {
      void qcMain.invalidateQueries({ queryKey: ['prime-loop-status-sessions'] })
    }
  }, [latestWsId])

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

  const { data: threads = [] } = useQuery({
    queryKey: ['threads'],
    queryFn: fetchThreads,
    staleTime: 5_000,
  })

  const { data: workItems = [] } = useQuery({
    queryKey: ['runtime-work-items'],
    queryFn: () => fetchRuntimeWorkItems(),
    staleTime: 5_000,
  })

  const [investigationState, setInvestigationState] = useState<Record<string, {
    loading?: boolean
    threadId?: string
    workItemId?: string
    error?: string
  }>>({})

  const startInvestigation = useCallback(async (session: PrimeSession) => {
    const summary = investigationSummary(session)
    const failureSignature = errorSignature(summary)

    const existing = findExistingInvestigation(failureSignature, threads, workItems)
    if (existing.thread) {
      window.sessionStorage.setItem(FOCUSED_ROOM_STORAGE_KEY, existing.thread.id)
      setInvestigationState((current) => ({
        ...current,
        [session.id]: { threadId: existing.thread!.id, workItemId: existing.workItem?.id },
      }))
      window.location.assign('/')
      return
    }

    setInvestigationState((current) => ({
      ...current,
      [session.id]: { ...current[session.id], loading: true, error: undefined },
    }))

    try {
      const title = `Investigate control-loop failure: ${truncateForTitle(summary)}`
      const description = [
        `Prime control-loop session ${session.id} failed.`,
        `Started: ${session.started_at}`,
        session.completed_at ? `Completed: ${session.completed_at}` : null,
        session.last_step ? `Last step: ${session.last_step}` : null,
        session.error ? `Failure: ${session.error}` : null,
        session.reasoning_summary && session.reasoning_summary !== session.error ? `Summary: ${session.reasoning_summary}` : null,
      ].filter(Boolean).join('\n')

      const thread = await createThread({
        title,
        metadata: {
          kind: 'investigation',
          source: 'prime-loop-ui',
          failure_signature: failureSignature,
          source_session_id: session.id,
        },
      })

      const workItem = existing.workItem ?? await createRuntimeWorkItem({
        title,
        description,
        status: 'active',
        lane: 'operations',
        owner_label: 'Prime',
        thread_id: thread.id,
        metadata: {
          source: 'prime-loop-ui',
          action_type: 'control_loop_failure_investigation',
          failure_signature: failureSignature,
          source_session_id: session.id,
          latest_session_id: session.id,
          error: session.error ?? summary,
          investigation_status: 'open',
        },
      })

      await appendThreadMessage(thread.id, {
        role: 'system',
        sender: 'Prime',
        content: description,
        metadata: {
          investigation: {
            source: 'prime-loop-ui',
            source_session_id: session.id,
            work_item_id: workItem.id,
            failure_signature: failureSignature,
          },
        },
      })

      await sendPrimeMessage(thread.id, {
        content: [
          `Start investigation for Prime control-loop failure session ${session.id}.`,
          `Work item: ${workItem.id}.`,
          session.last_step ? `Last step: ${session.last_step}.` : null,
          session.error ? `Failure: ${session.error}` : null,
          session.reasoning_summary && session.reasoning_summary !== session.error ? `Summary: ${session.reasoning_summary}` : null,
          'Please investigate the failure, identify likely root cause, and propose or take the next remediation step.',
        ].filter(Boolean).join(' '),
        sender: 'operator',
      })

      await Promise.all([
        qcMain.invalidateQueries({ queryKey: ['threads'] }),
        qcMain.invalidateQueries({ queryKey: ['runtime-work-items'] }),
      ])

      window.sessionStorage.setItem(FOCUSED_ROOM_STORAGE_KEY, thread.id)
      setInvestigationState((current) => ({
        ...current,
        [session.id]: { loading: false, threadId: thread.id, workItemId: workItem.id },
      }))
      window.location.assign('/')
    } catch (error) {
      setInvestigationState((current) => ({
        ...current,
        [session.id]: {
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to start investigation',
        },
      }))
    }
  }, [qcMain, threads, workItems])

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

      <SessionTimelineInspector threads={threads} />

      {/* Tick list — live session injected at top when running */}
      <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] flex flex-col min-h-0">
        <div className="border-b border-[var(--border-soft)] px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)] flex-shrink-0">Recent ticks</div>
        <div className="overflow-y-auto" style={{ maxHeight: 520 }}>
          {isLoading && !loopStatus.currentSession && <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">Loading…</div>}
          {!isLoading && !loopStatus.currentSession && displaySessions.length === 0 && <div className="px-4 py-6 text-center text-sm text-[var(--muted)]">No ticks in this range.</div>}
          <div className="divide-y divide-[var(--border-soft)]">

            {/* Live in-progress row at top */}
            {loopStatus.currentSession && (
              <LiveTickRow
                session={loopStatus.currentSession}
                label={loopStatus.label}
                isLlmPhase={loopStatus.isLlmPhase}
                elapsedSeconds={elapsedSeconds}
                wsEvents={wsEvents}
              />
            )}

            {/* Completed / historical rows */}
            {displaySessions
              .filter((s) => s.id !== loopStatus.currentSession?.id)
              .map((s) => {
                const quiescent = isQuiescent(s)
                const failed = s.status === 'failed'
                const isOpen = expanded === s.id
                const hadLlm = sessionTokens(s) > 0
                const dot = failed
                  ? <span className="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0 mt-0.5" />
                  : quiescent
                    ? <span className="h-2 w-2 rounded-full bg-[var(--border-soft)] flex-shrink-0 mt-0.5" />
                    : hadLlm
                      ? <span className="h-2 w-2 rounded-full bg-emerald-400 flex-shrink-0 mt-0.5" />
                      : <span className="h-2 w-2 rounded-full bg-sky-400 flex-shrink-0 mt-0.5" />
                return (
                  <div key={s.id}>
                    <button onClick={() => setExpanded(isOpen ? null : s.id)}
                      className={`w-full flex items-start gap-3 px-4 py-2.5 text-left text-xs transition hover:bg-[var(--panel-subtle)] ${quiescent ? 'opacity-50 hover:opacity-100' : ''}`}>
                      {dot}
                      <span className="w-20 shrink-0 text-[var(--muted)]">{relativeTime(s.started_at)}</span>
                      {failed
                        ? <span className="shrink-0 font-semibold text-amber-400">Failed</span>
                        : quiescent
                          ? <span className="shrink-0 text-[var(--muted)]">Skipped</span>
                          : <span className={`shrink-0 font-semibold ${hadLlm ? 'text-emerald-300' : 'text-sky-300'}`}>Done</span>}
                      <span className="hidden min-w-0 flex-1 sm:block">
                        {failed && s.last_step && <span className="font-mono text-[10px] text-amber-400/70">@ {s.last_step}</span>}
                        {!quiescent && !failed && s.model_used && <span className="block truncate font-mono text-[10px] text-[var(--muted)]">{s.model_used}</span>}
                        {quiescent && <span className="text-[10px] text-[var(--muted)]">quiescent</span>}
                      </span>
                      <span className="w-20 shrink-0 text-right font-mono tabular-nums text-[11px] text-[var(--muted)]">{quiescent ? '—' : `${sessionTokens(s).toLocaleString()} tok`}</span>
                      <span className={`w-12 shrink-0 text-right font-mono text-[10px] ${sessionActions(s) > 0 ? 'text-indigo-300' : 'text-[var(--muted)]'}`}>{sessionActions(s)}↗</span>
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-3">
                        <TickDetail
                          session={s}
                          onStartInvestigation={startInvestigation}
                          investigation={investigationState[s.id]}
                        />
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
