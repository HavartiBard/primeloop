import { Router } from 'express'
import type pg from 'pg'

export function createCanvasRouter({ pool }: { pool: pg.Pool }) {
  const router = Router()

  // GET /api/canvas/layout — load all card positions for default canvas
  router.get('/layout', async (_req, res) => {
    try {
      const { rows } = await pool.query<{ card_id: string; x: number; y: number }>(
        `SELECT card_id, x, y FROM canvas_layouts WHERE canvas_key = 'default'`,
      )
      const positions: Record<string, { x: number; y: number }> = {}
      for (const row of rows) {
        positions[row.card_id] = { x: row.x, y: row.y }
      }
      res.json({ positions })
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  // PUT /api/canvas/layout — upsert card positions (partial update)
  router.put('/layout', async (req, res) => {
    const body = req.body as { positions?: Record<string, { x: number; y: number }> }
    if (!body?.positions || typeof body.positions !== 'object') {
      return res.status(400).json({ error: 'positions object required' })
    }
    try {
      const entries = Object.entries(body.positions)
      if (entries.length > 0) {
        await Promise.all(
          entries.map(([card_id, { x, y }]) =>
            pool.query(
              `INSERT INTO canvas_layouts (canvas_key, card_id, x, y, updated_at)
               VALUES ('default', $1, $2, $3, now())
               ON CONFLICT (canvas_key, card_id) DO UPDATE
               SET x = EXCLUDED.x, y = EXCLUDED.y, updated_at = now()`,
              [card_id, x, y],
            ),
          ),
        )
      }
      res.json({ ok: true })
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  return router
}
