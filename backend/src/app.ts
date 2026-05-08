import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import type pg from 'pg'
import { insertEvent, listEvents } from './events/store.js'
import type { AgentEvent } from './events/types.js'
import { createLanggraphRouter } from './agents/langgraph.js'
import { createProvidersRouter } from './routes/providers.js'
import { createAgentsRouter } from './routes/agents.js'
import { createPortalRouter } from './routes/portal.js'
import { createRuntimeRouter } from './routes/runtime.js'
import { createApprovalsRouter } from './routes/approvals.js'
import { createCodexAuthRouter } from './routes/codex-auth.js'
import type { RegistryAgent } from './registry.js'
import type WebSocket from 'ws'

interface AppDeps {
  pool: pg.Pool
  broadcast: (event: AgentEvent) => void
  addClient: (ws: WebSocket) => void
  langgraphApiUrl: string
  sshKeyPath: string
  sshUser: string
  onAgentCreated: (agent: RegistryAgent) => void
  onAgentDeleted: (id: string) => void
}

export function createApp(deps: AppDeps): express.Express {
  const app = express()
  app.use(express.json())

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.get('/events', async (req, res) => {
    try {
      const { agent, type, limit, before } = req.query as Record<string, string>
      const parsedLimit = limit ? parseInt(limit, 10) : undefined
      if (parsedLimit !== undefined && isNaN(parsedLimit)) {
        res.status(400).json({ error: 'limit must be a number' })
        return
      }
      const events = await listEvents(deps.pool, {
        agent,
        type,
        limit: parsedLimit,
        before,
      })
      res.json(events)
    } catch (err) {
      res.status(500).json({ error: 'internal server error' })
    }
  })

  app.get('/agents', async (_req, res) => {
    try {
      const result = await deps.pool.query(
        `SELECT agent, last_seen::text, healthy FROM agent_heartbeat ORDER BY agent`
      )
      res.json(result.rows)
    } catch (err) {
      res.status(500).json({ error: 'internal server error' })
    }
  })

  app.use(
    '/webhook/langgraph',
    createLanggraphRouter({
      pool: deps.pool,
      insertEvent,
      broadcast: deps.broadcast,
      langgraphApiUrl: deps.langgraphApiUrl,
    })
  )

  app.use('/api/providers', createProvidersRouter({ pool: deps.pool }))
  app.use('/api/providers/:providerId/codex/auth', createCodexAuthRouter())

  app.use('/api/agents', createAgentsRouter({
    pool: deps.pool,
    sshKeyPath: deps.sshKeyPath,
    sshUser: deps.sshUser,
    onAgentCreated: deps.onAgentCreated,
    onAgentDeleted: deps.onAgentDeleted,
  }))

  app.use('/api/portal', createPortalRouter({ pool: deps.pool }))
  app.use('/api/approvals', createApprovalsRouter({ pool: deps.pool }))
  app.use('/api', createRuntimeRouter({ pool: deps.pool }))

  // Serve React SPA — must come after all API routes
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const uiDir = path.join(__dirname, '..', 'public')
  app.use(express.static(uiDir))
  app.get('*', (_req, res) => res.sendFile(path.join(uiDir, 'index.html')))

  return app
}
