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
    try {
      const { type, payload } = req.body as { type?: string; payload?: Record<string, unknown> }
      if (!type || !payload) {
        res.status(400).json({ error: 'type and payload are required' })
        return
      }
      const event = await deps.insertEvent(deps.pool, { agent: 'langgraph', type, payload })
      deps.broadcast(event)
      res.json({ ok: true })
    } catch (err) {
      console.error('[langgraph] POST / error:', err)
      res.status(500).json({ error: 'internal server error' })
    }
  })

  router.get('/approvals/pending', async (_req, res) => {
    try {
      const upstream = await fetchFn(`${apiUrl}/approvals/pending`, {
        headers: { 'Content-Type': 'application/json' },
      })
      const data = await upstream.json()
      res.status(upstream.status).json(data)
    } catch (err) {
      console.error('[langgraph] GET /approvals/pending error:', err)
      res.status(502).json({ error: 'upstream error' })
    }
  })

  router.post('/approvals/:id/:decision(approve|deny)', async (req, res) => {
    try {
      const { id, decision } = req.params as unknown as { id: string; decision: string }
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
    } catch (err) {
      console.error('[langgraph] POST /approvals/:id/:decision error:', err)
      res.status(502).json({ error: 'upstream error' })
    }
  })

  return router
}
