import { useEffect, useState } from 'react'
import type { AgentEvent } from '../types'

const MAX_EVENTS = 200

export function useWebSocket(url: string) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(url.startsWith('ws') ? url : `${scheme}://${window.location.host}${url}`)

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
