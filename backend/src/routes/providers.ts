import { Router } from 'express'
import type pg from 'pg'
import { listProviders, insertProvider, updateProvider, deleteProvider } from '../registry.js'

export function createProvidersRouter({ pool }: { pool: pg.Pool }) {
  const router = Router()

  router.get('/', async (_req, res) => {
    try {
      const providers = await listProviders(pool)
      res.json(providers)
    } catch (err) {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/', async (req, res) => {
    const { name, type, base_url, api_key, model } = req.body
    if (!name || !type || !base_url) {
      return res.status(400).json({ error: 'name, type, base_url required' })
    }
    try {
      const provider = await insertProvider(pool, { name, type, base_url, api_key, model })
      res.status(201).json(provider)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === '23505') {
        return res.status(409).json({ error: 'provider name already exists' })
      }
      res.status(500).json({ error: (err as Error).message || 'internal error' })
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const provider = await updateProvider(pool, req.params.id, req.body)
      res.json(provider)
    } catch (err) {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      await deleteProvider(pool, req.params.id)
      res.status(204).send()
    } catch (err) {
      res.status(500).json({ error: 'internal error' })
    }
  })

  return router
}
