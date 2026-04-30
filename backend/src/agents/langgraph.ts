import { Router } from 'express'
import type pg from 'pg'
import type { AgentEvent } from '../events/types.js'

interface Deps {
  pool: pg.Pool
  insertEvent: (pool: pg.Pool, input: { agent: 'langgraph' | 'raclette'; type: string; payload: Record<string, unknown> }) => Promise<AgentEvent>
  broadcast: (event: AgentEvent) => void
  langgraphApiUrl?: string
  fetch?: typeof globalThis.fetch
}

export function createLanggraphRouter(deps: Deps): Router {
  const router = Router()
  const fetchFn = deps.fetch ?? fetch
  const apiUrl = deps.langgraphApiUrl ?? ''

  router.post('/', async (req, res) => {
    const { type, payload } = req.body as { type?: string; payload?: Record<string, unknown> }
    if (!type || !payload) {
      res.status(400).json({ error: 'type and payload are required' })
      return
    }
    const event = await deps.insertEvent(deps.pool, { agent: 'langgraph', type, payload })
    deps.broadcast(event)
    res.json({ ok: true })
  })

  router.get('/approvals/pending', async (_req, res) => {
    const upstream = await fetchFn(`${apiUrl}/approvals/pending`, {
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await upstream.json()
    res.status(upstream.status).json(data)
  })

  router.post('/approvals/:id/:decision(approve|deny)', async (req, res) => {
    const params = req.params as Record<string, string>
    const { id } = params
    const decision = params['decision(approve|deny)'] ?? params['decision']
    const upstream = await fetchFn(`${apiUrl}/approvals/${id}/${decision}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const data = await upstream.json() as { action?: string; run_id?: string }
    if (upstream.ok) {
      const event = await deps.insertEvent(deps.pool, {
        agent: 'langgraph',
        type: 'approval.decided',
        payload: { approval_id: id, decision, action: data.action, run_id: data.run_id },
      })
      deps.broadcast(event)
    }
    res.status(upstream.status).json(data)
  })

  return router
}
