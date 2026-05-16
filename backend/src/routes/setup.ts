import { Router } from 'express'
import type pg from 'pg'
import { encrypt } from '../crypto.js'

export function createSetupRouter({ pool }: { pool: pg.Pool }) {
  const router = Router()

  router.get('/status', async (_req, res) => {
    try {
      const { rows: providerRows } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM providers'
      )
      if (providerRows[0].count > 0) {
        return res.json({ complete: true })
      }
      const { rows } = await pool.query(
        "SELECT setup_complete FROM prime_agent_config WHERE id = 'default'"
      )
      res.json({ complete: rows[0]?.setup_complete ?? false })
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/ollama-models', async (req, res) => {
    const base_url = req.query.base_url as string | undefined
    if (!base_url) {
      return res.status(400).json({ error: 'base_url query param required' })
    }
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3_000)
      const upstream = await fetch(`${base_url}/api/tags`, { signal: controller.signal })
      clearTimeout(timeout)
      const data = await upstream.json()
      res.json(data)
    } catch {
      res.json({ error: 'unreachable' })
    }
  })

  return router
}
