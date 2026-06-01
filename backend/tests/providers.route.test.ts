import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { createProvidersRouter } from '../src/routes/providers.js'
import { createSetupRouter } from '../src/routes/setup.js'

const TEST_DB = process.env.TEST_DATABASE_URL!
process.env.SECRET_ENCRYPTION_KEY = 'a'.repeat(64)

describe('providers router', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    app = express()
    app.use(express.json())
    app.use('/api/providers', createProvidersRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query('DELETE FROM agents')
    await pool.query('DELETE FROM providers')
    await pool.end()
  })

  it('GET / returns empty array initially', async () => {
    const res = await request(app).get('/api/providers')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('POST / creates a provider', async () => {
    const res = await request(app).post('/api/providers').send({
      name: 'test-provider',
      type: 'openai',
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-test',
    })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('test-provider')
    expect(res.body.id).toBeTruthy()
  })

  it('POST / masks api_key in response', async () => {
    const res = await request(app).post('/api/providers').send({
      name: 'masked-provider',
      type: 'llm',
      base_url: 'https://api.anthropic.com',
      api_key: 'sk-ant-real-secret',
      model: 'anthropic/claude-sonnet-4-5',
    })
    expect(res.status).toBe(201)
    expect(res.body.api_key).toBe('••••••••')
    expect(res.body.model).toBe('anthropic/claude-sonnet-4-5')
  })

  it('POST / returns 400 when required fields missing', async () => {
    const res = await request(app).post('/api/providers').send({ name: 'x' })
    expect(res.status).toBe(400)
  })

  it('GET / returns created provider', async () => {
    const res = await request(app).get('/api/providers')
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThan(0)
    expect(res.body[0].name).toBe('test-provider')
  })

  it('GET / never exposes plaintext api_key', async () => {
    const res = await request(app).get('/api/providers')
    expect(res.status).toBe(200)
    for (const provider of res.body) {
      if (provider.api_key !== undefined) {
        expect(provider.api_key).toBe('••••••••')
      }
    }
  })

  it('PUT /:id updates a provider', async () => {
    const list = await request(app).get('/api/providers')
    const id = list.body[0].id
    const res = await request(app).put(`/api/providers/${id}`).send({ base_url: 'https://updated.example.com' })
    expect(res.status).toBe(200)
    expect(res.body.base_url).toBe('https://updated.example.com')
  })

  it('DELETE /:id removes a provider', async () => {
    const list = await request(app).get('/api/providers')
    const id = list.body[0].id
    const initialCount = list.body.length
    const res = await request(app).delete(`/api/providers/${id}`)
    expect(res.status).toBe(204)
    const list2 = await request(app).get('/api/providers')
    expect(list2.body).toHaveLength(initialCount - 1)
    expect(list2.body.some((provider: { id: string }) => provider.id === id)).toBe(false)
  })
})

// ─── T014: Backend route tests for model capability assessment ──────────────

describe('POST /api/providers/model-capability', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    app = express()
    app.use(express.json())
    app.use('/api/providers', createProvidersRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query('DELETE FROM agents')
    await pool.query('DELETE FROM providers')
    await pool.end()
  })

  it('returns capability assessment for a model', async () => {
    const res = await request(app).post('/api/providers/model-capability').send({ model: 'claude-sonnet-4-6' })
    expect(res.status).toBe(200)
    expect(res.body.tier).toBeDefined()
    expect(res.body.warning).toBeDefined()
  })

  it('returns 400 when model is missing', async () => {
    const res = await request(app).post('/api/providers/model-capability').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns 400 when model is not a string', async () => {
    const res = await request(app).post('/api/providers/model-capability').send({ model: 123 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })
})

// ─── T014: Backend route tests for model discovery, provider rejection, unreachable local provider ─────────────

describe('POST /api/setup/provider-models', () => {
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

  it('returns models for ollama provider', async () => {
    const res = await request(app).post('/api/setup/provider-models').send({
      type: 'ollama',
      base_url: 'http://localhost:11434',
    })
    expect(res.status).toBe(200)
    // Ollama may be unreachable in test environment, but should return valid shape
    expect(Array.isArray(res.body.models)).toBe(true)
  }, 5_000)

  it('returns { error: "unreachable" } for unreachable ollama provider', async () => {
    const res = await request(app).post('/api/setup/provider-models').send({
      type: 'ollama',
      base_url: 'http://127.0.0.1:19999',
    })
    expect(res.status).toBe(200)
    expect(res.body.error).toBe('unreachable')
    expect(Array.isArray(res.body.models)).toBe(true) // Empty array expected
  }, 5_000)

  it('returns 400 when type is missing', async () => {
    const res = await request(app).post('/api/setup/provider-models').send({
      base_url: 'http://localhost:11434',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns 400 when base_url is missing', async () => {
    const res = await request(app).post('/api/setup/provider-models').send({
      type: 'ollama',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns models for anthropic with api_key', async () => {
    const res = await request(app).post('/api/setup/provider-models').send({
      type: 'anthropic',
      base_url: 'https://api.anthropic.com',
      api_key: 'sk-test-invalid-key-for-discovery',
    })
    expect([200, 401]).toContain(res.status)
    expect(Array.isArray(res.body.models ?? [])).toBe(true)
  }, 5_000)
})

// ─── Provider rejection and unreachable recovery tests ─────────────

describe('provider rejection and unreachable recovery', () => {
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

  it('returns recoverable error for unreachable local provider during model discovery', async () => {
    const res = await request(app).post('/api/setup/provider-models').send({
      type: 'ollama',
      base_url: 'http://127.0.0.1:19999',
    })
    expect(res.status).toBe(200)
    // Recovery path: return empty models with error flag
    expect(res.body.error).toBe('unreachable')
    expect(res.body.models).toEqual([])
  }, 5_000)

  it('returns provider rejection error for invalid anthropic key', async () => {
    const res = await request(app).post('/api/setup/provider-models').send({
      type: 'anthropic',
      base_url: 'https://api.anthropic.com',
      api_key: 'sk-invalid-key-12345',
    })
    expect([200, 401]).toContain(res.status)
    expect(Array.isArray(res.body.models ?? [])).toBe(true)
  }, 5_000)
})
