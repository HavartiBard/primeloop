import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPrimeConfig, fetchPrimeSessions } from '../api'
import type { PrimeSession } from '../types'

export type LoopPhase = 'idle' | 'running' | 'error' | 'skipped' | 'stopped'

export interface LoopStatus {
  phase: LoopPhase
  label: string
  /** true when the current step involves an LLM call (decision, action, feedback, learning) */
  isLlmPhase: boolean
  secondsLeft: number | null
  elapsedSeconds: number | null
  currentSession: PrimeSession | null
  lastError: string | null
  intervalSeconds: number
}

// Stages that involve an LLM call — chip turns green for these
const LLM_STAGES = new Set(['decision', 'action', 'feedback', 'learning'])

const STEP_LABELS: Record<string, string> = {
  'trigger':  'Ingesting',
  'debounce': 'Checking',
  'context':  'Analyzing',
  'policy':   'Evaluating',
  'observer': 'Observing',
  'decision': 'Thinking',
  'action':   'Delegating',
  'feedback': 'Processing',
  'learning': 'Learning',
}

function parseStep(lastStep: string | null | undefined): { label: string; isLlm: boolean } {
  if (!lastStep) return { label: 'Analyzing', isLlm: false }
  const moduleId = lastStep.replace(/^(module|shadow):/, '')
  const stage = moduleId.split('.')[0]
  return {
    label: STEP_LABELS[stage] ?? 'Running',
    isLlm: LLM_STAGES.has(stage),
  }
}

export function useLoopStatus(): LoopStatus {
  const { data: config } = useQuery({
    queryKey: ['prime-config-interval'],
    queryFn: fetchPrimeConfig,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const intervalSeconds = config?.cron_fast_interval_seconds ?? 300
  const primeEnabled = config?.enabled !== false  // default true while loading
  const intervalMs = intervalSeconds * 1000

  const { data: sessions } = useQuery({
    queryKey: ['prime-loop-status-sessions'],
    queryFn: () => fetchPrimeSessions(10),
    refetchInterval: (query) => {
      const data = query.state.data as PrimeSession[] | undefined
      const hasRunning = data?.some((s) => s.status === 'running')
      return hasRunning ? 3_000 : 15_000
    },
  })

  const cronSessions = useMemo(
    () => (sessions ?? []).filter((s) => s.trigger_type === 'cron_fast'),
    [sessions],
  )

  const running = cronSessions.find((s) => s.status === 'running') ?? null
  const latest = cronSessions[0] ?? null

  // Baseline for countdown: prefer completed_at of last finished session
  const lastFinished = cronSessions.find((s) => s.completed_at)
  const nextTickMs = useMemo(() => {
    if (!lastFinished) return null
    return new Date(lastFinished.completed_at!).getTime() + intervalMs
  }, [lastFinished, intervalMs])

  // Live elapsed timer (seconds since running session started)
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)

    const tick = () => {
      const now = Date.now()
      if (running) {
        setElapsedSeconds(Math.floor((now - new Date(running.started_at).getTime()) / 1000))
        setSecondsLeft(null)
      } else if (nextTickMs !== null) {
        setElapsedSeconds(null)
        setSecondsLeft(Math.max(0, Math.ceil((nextTickMs - now) / 1000)))
      } else {
        setElapsedSeconds(null)
        setSecondsLeft(null)
      }
    }

    tick()
    timerRef.current = setInterval(tick, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [running, nextTickMs])

  // Determine phase and label
  if (!primeEnabled) {
    return {
      phase: 'stopped',
      label: 'Stopped',
      isLlmPhase: false,
      secondsLeft: null,
      elapsedSeconds: null,
      currentSession: null,
      lastError: null,
      intervalSeconds,
    }
  }

  if (running) {
    const runningElapsed = Math.floor((Date.now() - new Date(running.started_at).getTime()) / 1000)
    const stalled = runningElapsed > intervalSeconds
    const { label, isLlm } = stalled
      ? { label: 'Stalled?', isLlm: false }
      : parseStep(running.last_step)
    return {
      phase: 'running',
      label,
      isLlmPhase: isLlm,
      secondsLeft: null,
      elapsedSeconds,
      currentSession: running,
      lastError: null,
      intervalSeconds,
    }
  }

  if (latest?.status === 'failed') {
    return {
      phase: 'error',
      label: 'Error',
      isLlmPhase: false,
      secondsLeft,
      elapsedSeconds: null,
      currentSession: null,
      lastError: latest.error ?? latest.reasoning_summary ?? 'Unknown error',
      intervalSeconds,
    }
  }

  if (latest?.reasoning_summary?.startsWith('Skipped:')) {
    return {
      phase: 'skipped',
      label: secondsLeft !== null
        ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
        : `${intervalSeconds}s`,
      isLlmPhase: false,
      secondsLeft,
      elapsedSeconds: null,
      currentSession: null,
      lastError: null,
      intervalSeconds,
    }
  }

  return {
    phase: 'idle',
    label: secondsLeft !== null
      ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
      : `${intervalSeconds}s`,
    isLlmPhase: false,
    secondsLeft,
    elapsedSeconds: null,
    currentSession: null,
    lastError: null,
    intervalSeconds,
  }
}
