import type pg from 'pg'
import type { AgentEvent } from '../events/types.js'
import { insertEvent as defaultInsertEvent } from '../events/store.js'

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
  insertEvent: (pool: pg.Pool, input: { agent: string; type: string; payload: Record<string, unknown> }) => Promise<AgentEvent>
  broadcast: (event: AgentEvent) => void
  upsertHeartbeat: (pool: pg.Pool, agent: string, healthy: boolean) => Promise<void>
  agentName?: string
  fetch?: typeof globalThis.fetch
}

export interface HermesPollingDeps {
  agentName?: string
  apiUrl: string
  pool: pg.Pool
  broadcast: (event: AgentEvent) => void
  sessionToken?: string
  insertEvent?: (pool: pg.Pool, input: { agent: string; type: string; payload: Record<string, unknown> }) => Promise<AgentEvent>
  upsertHeartbeat?: (pool: pg.Pool, agent: string, healthy: boolean) => Promise<void>
  fetch?: typeof globalThis.fetch
  intervalMs?: number
}

export async function pollRaclette(deps: PollDeps): Promise<void> {
  const fetchFn = deps.fetch ?? fetch
  const agentName = deps.agentName ?? 'raclette'
  try {
    const res = await fetchFn(`${deps.apiUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${deps.sessionToken}` },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { sessions: HermesSession[] }

    for (const session of data.sessions) {
      if (session.is_active) {
        const event = await deps.insertEvent(deps.pool, {
          agent: agentName,
          type: 'session.active',
          payload: session as Record<string, unknown>,
        })
        deps.broadcast(event)
      }
    }
    await deps.upsertHeartbeat(deps.pool, agentName, true)
  } catch (err) {
    console.error(`[${agentName}] poll failed:`, err)
    try {
      await deps.upsertHeartbeat(deps.pool, agentName, false)
    } catch (heartbeatErr) {
      console.error(`[${agentName}] heartbeat upsert failed:`, heartbeatErr)
    }
  }
}

export function startHermesPolling(deps: HermesPollingDeps): NodeJS.Timeout {
  const intervalMs = deps.intervalMs ?? 30_000
  const resolvedDeps: PollDeps = {
    agentName: deps.agentName ?? 'raclette',
    apiUrl: deps.apiUrl,
    pool: deps.pool,
    broadcast: deps.broadcast,
    sessionToken: deps.sessionToken ?? process.env.RACLETTE_SESSION_TOKEN ?? '',
    insertEvent: deps.insertEvent ?? defaultInsertEvent,
    upsertHeartbeat: deps.upsertHeartbeat ?? upsertHeartbeat,
    fetch: deps.fetch,
  }
  return setInterval(() => {
    pollRaclette(resolvedDeps).catch(console.error)
  }, intervalMs)
}

export async function upsertHeartbeat(pool: pg.Pool, agent: string, healthy: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO agent_heartbeat (agent, last_seen, healthy)
     VALUES ($1, now(), $2)
     ON CONFLICT (agent) DO UPDATE SET last_seen = now(), healthy = $2`,
    [agent, healthy]
  )
}
