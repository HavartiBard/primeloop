import { Router } from 'express'
import type pg from 'pg'
import { getPortalState, updatePortalState } from '../portal.js'

export function createPortalRouter({ pool }: { pool: pg.Pool }) {
  const router = Router()

  router.get('/state', async (_req, res) => {
    try {
      const state = await getPortalState(pool)
      res.json(state)
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.put('/state', async (req, res) => {
    const { chief_profile, work_items, status_updates, permission_rules, audit_loops } = req.body ?? {}
    if (!chief_profile || !work_items || !status_updates || !permission_rules || !audit_loops) {
      return res.status(400).json({ error: 'complete portal state required' })
    }

    try {
      const state = await updatePortalState(pool, {
        chief_profile,
        work_items,
        status_updates,
        permission_rules,
        audit_loops,
      })
      res.json(state)
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  return router
}
