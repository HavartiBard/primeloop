import type pg from 'pg'
import type { AgentEvent } from '../events/types.js'

interface HermesSession {
  id: string
  source: string
  user_id: string
  is_active: boolean
  [key: string]: unknown
}

interface PollDeps {
  apiUrl: string
  sessionToken: string
  pool: pg.Pool
  insertEvent: (pool: pg.Pool, input: { agent: 'langgraph' | 'raclette'; type: string; payload: Record<string, unknown> }) => Promise<AgentEvent>
  broadcast: (event: AgentEvent) => void
  upsertHeartbeat: (pool: pg.Pool, agent: string, healthy: boolean) => Promise<void>
  fetch?: typeof globalThis.fetch
}

export async function pollRaclette(deps: PollDeps): Promise<void> {
  const fetchFn = deps.fetch ?? fetch
  try {
    const res = await fetchFn(`${deps.apiUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${deps.sessionToken}` },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { sessions: HermesSession[] }

    for (const session of data.sessions) {
      if (session.is_active) {
        const event = await deps.insertEvent(deps.pool, {
          agent: 'raclette',
          type: 'session.active',
          payload: session as Record<string, unknown>,
        })
        deps.broadcast(event)
      }
    }
    await deps.upsertHeartbeat(deps.pool, 'raclette', true)
  } catch {
    await deps.upsertHeartbeat(deps.pool, 'raclette', false)
  }
}

export async function upsertHeartbeat(pool: pg.Pool, agent: string, healthy: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO agent_heartbeat (agent, last_seen, healthy)
     VALUES ($1, now(), $2)
     ON CONFLICT (agent) DO UPDATE SET last_seen = now(), healthy = $2`,
    [agent, healthy]
  )
}
