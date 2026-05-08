import { Router } from 'express'
import type pg from 'pg'
import {
  deleteMcpServer,
  insertMcpServer,
  listMcpServers,
  updateMcpServer,
} from '../mcp-registry.js'

export function createMcpServersRouter({ pool }: { pool: pg.Pool }) {
  const router = Router()

  router.get('/', async (_req, res) => {
    try {
      res.json(await listMcpServers(pool))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/', async (req, res) => {
    if (!req.body?.name || !req.body?.type) {
      return res.status(400).json({ error: 'name and type required' })
    }
    try {
      const server = await insertMcpServer(pool, {
        name: req.body.name,
        description: req.body.description,
        type: req.body.type,
        url: req.body.url,
        command: req.body.command,
        args: Array.isArray(req.body.args) ? req.body.args : undefined,
        env_vars: req.body.env_vars,
      })
      res.status(201).json(server)
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const server = await updateMcpServer(pool, req.params.id, {
        name: req.body.name,
        description: req.body.description,
        type: req.body.type,
        url: req.body.url,
        command: req.body.command,
        args: Array.isArray(req.body.args) ? req.body.args : undefined,
        ...(Object.prototype.hasOwnProperty.call(req.body, 'env_vars') ? { env_vars: req.body.env_vars } : {}),
      })
      res.json(server)
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      await deleteMcpServer(pool, req.params.id)
      res.status(204).send()
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  return router
}
