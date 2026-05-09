import { Router } from 'express'
import type pg from 'pg'
import { authenticateAgentToken, callControlPlaneTool, listControlPlaneTools } from '../mcp/service.js'

function parseBearerToken(header: string | undefined): string {
  if (!header) return ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? ''
}

export function createControlPlaneRouter({ pool }: { pool: pg.Pool }) {
  const router = Router()

  router.use(async (req, res, next) => {
    try {
      const token = parseBearerToken(req.header('authorization'))
      if (!token) return res.status(401).json({ error: 'bearer token required' })
      const auth = await authenticateAgentToken(pool, token)
      if (!auth) return res.status(401).json({ error: 'invalid agent token' })
      res.locals.agentAuth = auth
      next()
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/tools', async (_req, res) => {
    try {
      res.json({ tools: await listControlPlaneTools() })
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/tools/:name', async (req, res) => {
    try {
      const args = typeof req.body?.arguments === 'object' && req.body?.arguments && !Array.isArray(req.body.arguments)
        ? req.body.arguments as Record<string, unknown>
        : {}
      const result = await callControlPlaneTool(pool, res.locals.agentAuth, req.params.name, args)
      res.json({
        tool: req.params.name,
        structuredContent: result,
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      if (message.startsWith('unknown tool:')) return res.status(404).json({ error: message })
      if (message.startsWith('arguments.') || message.includes('required') || message.includes('must be ')) {
        return res.status(400).json({ error: message })
      }
      if (message === 'forbidden: prime capability required') return res.status(403).json({ error: message })
      res.status(500).json({ error: message })
    }
  })

  return router
}
