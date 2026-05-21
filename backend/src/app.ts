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
import { createControlPlaneRouter } from './routes/control-plane.js'
import { createMcpServersRouter } from './routes/mcp-servers.js'
import { createPrimeAgentRouter } from './routes/prime-agent.js'
import { createSetupRouter } from './routes/setup.js'
import { createPrimeProfileRouter } from './routes/prime-profile.js'
import type { PrimeQueue } from './prime-agent/queue.js'
import type { RegistryAgent } from './registry.js'
import type WebSocket from 'ws'

interface AppDeps {
  pool: pg.Pool
  broadcast: (event: AgentEvent) => void
  addClient: (ws: WebSocket) => void
  langgraphApiUrl: string
  sshKeyPath: string
  sshUser: string
  primeQueue: PrimeQueue
  onPrimeConfigUpdated?: () => Promise<void> | void
  onSetupCompleted?: () => Promise<void> | void
  onAgentCreated: (agent: RegistryAgent) => void
  onAgentUpdated?: (agent: RegistryAgent) => void
  onAgentDeleted: (id: string) => void
}

export function createApp(deps: AppDeps): express.Express {
  const app = express()

  const allowedOrigins = getAllowedCorsOrigins()

  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin && allowedOrigins.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin)
      res.header('Vary', 'Origin')
      res.header('Access-Control-Allow-Credentials', 'true')
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    }

    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }

    next()
  })

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
  app.use('/api/mcp-servers', createMcpServersRouter({ pool: deps.pool }))

  app.use('/api/agents', createAgentsRouter({
    pool: deps.pool,
    sshKeyPath: deps.sshKeyPath,
    sshUser: deps.sshUser,
    onAgentCreated: deps.onAgentCreated,
    onAgentUpdated: deps.onAgentUpdated,
    onAgentDeleted: deps.onAgentDeleted,
  }))

  app.use('/api/portal', createPortalRouter({ pool: deps.pool }))
  app.use('/api/approvals', createApprovalsRouter({ pool: deps.pool }))
  app.use('/api/control-plane', createControlPlaneRouter({ pool: deps.pool }))
  app.use('/api/prime-agent', createPrimeAgentRouter({
    pool: deps.pool,
    queue: deps.primeQueue,
    onConfigUpdated: deps.onPrimeConfigUpdated,
  }))
  app.use('/api/prime-agent/profile', createPrimeProfileRouter({ pool: deps.pool }))
  app.use('/api/setup', createSetupRouter({
    pool: deps.pool,
    onSetupCompleted: deps.onSetupCompleted,
  }))
  app.use('/api', createRuntimeRouter({ pool: deps.pool }))

  // Serve React SPA — must come after all API routes
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const uiDir = path.join(__dirname, '..', 'public')
  app.use(express.static(uiDir))
  app.get('*', (_req, res) => res.sendFile(path.join(uiDir, 'index.html')))

  return app
}

function getAllowedCorsOrigins(): Set<string> {
  const configured = process.env['ACP_CORS_ORIGINS']
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  return new Set(
    configured && configured.length > 0
      ? configured
      : [
          'http://192.168.20.60:4176',
          'http://localhost:4176',
        ]
  )
}
