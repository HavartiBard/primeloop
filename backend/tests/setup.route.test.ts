import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { createSetupRouter } from '../src/routes/setup.js'

const TEST_DB = process.env.TEST_DATABASE_URL!
process.env.SECRET_ENCRYPTION_KEY = 'a'.repeat(64)

describe('GET /api/setup/status', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await pool.query('DELETE FROM providers')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false WHERE id='default'")
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query('DELETE FROM providers')
    await pool.end()
  })

  it('returns complete: false when no providers and setup_complete=false', async () => {
    const res = await request(app).get('/api/setup/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ complete: false })
  })

  it('returns complete: true when providers table is non-empty', async () => {
    await pool.query(
      "INSERT INTO providers (name, type, base_url) VALUES ('test', 'anthropic', 'https://api.anthropic.com')"
    )
    const res = await request(app).get('/api/setup/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ complete: true })
    await pool.query("DELETE FROM providers WHERE name='test'")
  })

  it('returns complete: true when setup_complete=true even with no providers', async () => {
    await pool.query("UPDATE prime_agent_config SET setup_complete=true WHERE id='default'")
    const res = await request(app).get('/api/setup/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ complete: true })
    await pool.query("UPDATE prime_agent_config SET setup_complete=false WHERE id='default'")
  })
})

describe('GET /api/setup/ollama-models', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.end()
  })

  it('returns 400 when base_url is missing', async () => {
    const res = await request(app).get('/api/setup/ollama-models')
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns { error: "unreachable" } when host is unreachable', async () => {
    const res = await request(app).get('/api/setup/ollama-models?base_url=http://127.0.0.1:19999')
    expect(res.status).toBe(200)
    expect(res.body.error).toBe('unreachable')
  }, 5_000)
})
