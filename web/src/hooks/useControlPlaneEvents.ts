import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getApiOrigin } from '../api'

// ─── Types (mirrors backend ws/control-plane-events.ts) ──────────────

export interface ControlPlaneEvent {
  type: string
  occurredAt: string
  goalId?: string
  payload: Record<string, unknown>
}

export type ControlPlaneEventType =
  | 'goal.created'
  | 'goal.updated'
  | 'work-item.created'
  | 'work-item.updated'
  | 'approval.requested'
  | 'approval.resolved'
  | 'recovery.recorded'
  | 'learning-record.created'
  | 'goal.completed'

export interface UseControlPlaneEventsReturn {
  isConnected: boolean
  lastEvent: ControlPlaneEvent | null
  error: string | null
}

// ─── Reconnection config ─────────────────────────────────────────────

const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000

// ─── Hook ────────────────────────────────────────────────────────────

export function useControlPlaneEvents(): UseControlPlaneEventsReturn {
  const queryClient = useQueryClient()
  const [isConnected, setIsConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<ControlPlaneEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Mutable refs so the effect callback can mutate without re-running.
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)

  useEffect(() => {
    let isMounted = true

    function connect(): void {
      if (!isMounted) return

      // Derive WS base using the same logic as useWebSocket.ts
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const apiOrigin = getApiOrigin()
      const wsBase = ((import.meta.env.VITE_WS_BASE as string | undefined) ?? '').replace(/\/+$/, '')
      const derivedBase = wsBase
        || (apiOrigin ? apiOrigin.replace(/^http/, 'ws') : `${scheme}://${window.location.host}`)

      const ws = new WebSocket(`${derivedBase}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        if (!isMounted) return
        setIsConnected(true)
        setError(null)
        reconnectAttemptsRef.current = 0
      }

      ws.onclose = (event) => {
        if (!isMounted) return
        setIsConnected(false)
        wsRef.current = null

        // Only attempt reconnection for abnormal closures or if we were connected.
        // Normal closures (code 1000) from cleanup don't reconnect.
        if (event.code === 1000) return

        // Exponential backoff with jitter
        const attempts = Math.min(reconnectAttemptsRef.current + 1, 8)
        const delay = Math.min(
          RECONNECT_MIN_MS * 2 ** (attempts - 1) + Math.random() * 500,
          RECONNECT_MAX_MS,
        )
        reconnectAttemptsRef.current = attempts

        reconnectTimerRef.current = setTimeout(() => {
          if (isMounted) connect()
        }, delay)
      }

      ws.onerror = (event) => {
        if (!isMounted) return
        // Extract error message if available, otherwise use a generic one.
        const msg = (event as Event & { target?: { error?: { message?: string } } })
          ?.target?.error?.message
        setError(msg ?? 'WebSocket connection failed')
      }

      ws.onmessage = (rawEvent) => {
        try {
          const event = JSON.parse(rawEvent.data as string) as ControlPlaneEvent
          if (!isMounted) return
          setLastEvent(event)

          // Invalidate TanStack Query cache based on event type
          handleEvent(event)
        } catch {
          // Ignore malformed messages (same as useWebSocket.ts)
        }
      }
    }

    function handleEvent(event: ControlPlaneEvent): void {
      switch (event.type) {
        case 'goal.created':
          // Invalidate goals list so the new goal appears
          queryClient.invalidateQueries({ queryKey: ['goals'] })
          break

        case 'goal.updated':
          // Invalidate specific goal detail
          if (event.goalId) {
            queryClient.invalidateQueries({ queryKey: ['goal', event.goalId] })
          }
          break

        case 'work-item.created':
        case 'work-item.updated':
          // Work item changes affect the parent goal's data
          if (event.goalId) {
            queryClient.invalidateQueries({ queryKey: ['goal', event.goalId] })
          }
          break

        case 'goal.completed':
          // Invalidate both the specific goal and the goals list
          if (event.goalId) {
            queryClient.invalidateQueries({ queryKey: ['goal', event.goalId] })
          }
          queryClient.invalidateQueries({ queryKey: ['goals'] })
          break

        case 'approval.requested':
        case 'approval.resolved':
          // Approvals may be displayed in the top bar badge
          queryClient.invalidateQueries({ queryKey: ['approvals'] })
          break

        default:
          // recovery.recorded, learning-record.created — no specific cache invalidation needed
          break
      }
    }

    connect()

    return () => {
      isMounted = false
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close(1000, 'Component unmounted')
        wsRef.current = null
      }
    }
  }, [queryClient])

  return { isConnected, lastEvent, error }
}
