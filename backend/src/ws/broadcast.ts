import type WebSocket from 'ws'
import type { AgentEvent } from '../events/types.js'

interface Broadcaster {
  broadcast: (event: AgentEvent) => void
  addClient: (ws: WebSocket) => void
  clientCount: () => number
}

export function createBroadcaster(): Broadcaster {
  const clients = new Set<WebSocket>()

  function broadcast(event: AgentEvent): void {
    const msg = JSON.stringify(event)
    for (const client of clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(msg)
      } else {
        clients.delete(client)
      }
    }
  }

  function addClient(ws: WebSocket): void {
    clients.add(ws)
    ws.on('close', () => clients.delete(ws))
  }

  return { broadcast, addClient, clientCount: () => clients.size }
}
