// canvas.route.test.ts - Backend route tests for canvas layout endpoints

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { createCanvasRouter } from '../src/routes/canvas.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('Canvas Layout Routes', () => {
  let app: express.Application
  let db: pg.Pool

  beforeAll(async () => {
    db = createPool(TEST_DB)
    await runMigrations(db)
    app = express()
    app.use(express.json())
    app.use('/api/canvas', createCanvasRouter({ pool: db }))
  })

  beforeEach(async () => {
    await db.query('DELETE FROM canvas_layouts')
  })

  afterAll(async () => {
    await db.query('DELETE FROM canvas_layouts')
    await db.end()
  })

  describe('GET /api/canvas/layout', () => {
    it('should return empty positions when no layout exists', async () => {
      const res = await request(app).get('/api/canvas/layout')
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ positions: {} })
    })

    it('should return saved positions', async () => {
      await db.query(
        `INSERT INTO canvas_layouts (canvas_key, card_id, x, y, updated_at)
         VALUES ('default', 'card-1', 100, 200, now()),
                ('default', 'card-2', 300, 400, now())`,
      )
      const res = await request(app).get('/api/canvas/layout')
      expect(res.status).toBe(200)
      expect(res.body.positions).toEqual({
        'card-1': { x: 100, y: 200 },
        'card-2': { x: 300, y: 400 },
      })
    })
  })

  describe('PUT /api/canvas/layout', () => {
    it('should return 400 for invalid request body', async () => {
      const res = await request(app)
        .put('/api/canvas/layout')
        .send({ positions: 'invalid' })
      expect(res.status).toBe(400)
      expect(res.body.error).toBeDefined()
    })

    it('should upsert card positions', async () => {
      const res = await request(app)
        .put('/api/canvas/layout')
        .send({
          positions: {
            'card-1': { x: 150, y: 250 },
          },
        })
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      const { rows } = await db.query(
        `SELECT card_id, x, y FROM canvas_layouts WHERE card_id = 'card-1'`,
      )
      expect(rows.length).toBe(1)
      expect(rows[0]).toEqual({
        card_id: 'card-1',
        x: 150,
        y: 250,
      })
    })

    it('should update existing positions', async () => {
      await db.query(
        `INSERT INTO canvas_layouts (canvas_key, card_id, x, y, updated_at)
         VALUES ('default', 'card-1', 100, 200, now())`,
      )
      const res = await request(app)
        .put('/api/canvas/layout')
        .send({
          positions: {
            'card-1': { x: 180, y: 280 },
          },
        })
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      const { rows } = await db.query(
        `SELECT card_id, x, y FROM canvas_layouts WHERE card_id = 'card-1'`,
      )
      expect(rows[0].x).toBe(180)
      expect(rows[0].y).toBe(280)
    })

    it('should handle multiple positions in one request', async () => {
      const res = await request(app)
        .put('/api/canvas/layout')
        .send({
          positions: {
            'card-1': { x: 100, y: 100 },
            'card-2': { x: 200, y: 200 },
            'card-3': { x: 300, y: 300 },
          },
        })
      expect(res.status).toBe(200)
      expect(res.body.ok).toBe(true)

      const { rows } = await db.query(
        `SELECT card_id, x, y FROM canvas_layouts ORDER BY card_id`,
      )
      expect(rows.length).toBe(3)
      expect(rows[0].card_id).toBe('card-1')
      expect(rows[1].card_id).toBe('card-2')
      expect(rows[2].card_id).toBe('card-3')
    })
  })
})
