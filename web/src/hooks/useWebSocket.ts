import { useEffect, useState } from 'react'
import type { AgentEvent } from '../types'
import { getApiOrigin } from '../api'

const MAX_EVENTS = 200

export function useWebSocket(url: string) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const apiOrigin = getApiOrigin()
    const wsBase = ((import.meta.env.VITE_WS_BASE as string | undefined) ?? '').replace(/\/+$/, '')
    const derivedBase = wsBase
      || (apiOrigin ? apiOrigin.replace(/^http/, 'ws') : `${scheme}://${window.location.host}`)
    const ws = new WebSocket(url.startsWith('ws') ? url : `${derivedBase}${url}`)

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as AgentEvent
        setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS))
      } catch { /* ignore malformed */ }
    }

    return () => ws.close()
  }, [url])

  return { events, connected }
}
