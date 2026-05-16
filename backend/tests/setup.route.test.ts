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

describe('POST /api/setup/complete', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await pool.query('DELETE FROM providers')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false, enabled=false WHERE id='default'")
    await pool.query("DELETE FROM chief_profiles")
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query('DELETE FROM providers')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false, enabled=false WHERE id='default'")
    await pool.query("DELETE FROM chief_profiles")
    await pool.end()
  })

  const validPayload = {
    providers: [
      {
        name: 'anthropic-main',
        type: 'anthropic',
        base_url: 'https://api.anthropic.com',
        api_key: 'sk-ant-test',
        model: 'claude-sonnet-4-6',
      },
    ],
    routing: {
      planning: [{ provider_name: 'anthropic-main', model: 'claude-sonnet-4-6' }],
      dispatching: [],
      discussion: [],
    },
    persona: {
      name: 'Prime',
      focus: 'Senior backend engineer',
      tone: 'direct',
      instructions: '',
    },
    rules: { presets: ['no_force_push'], custom: '' },
    cost_controls: { monthly_token_budget: 0 },
    launch: true,
  }

  it('returns ok: true and sets setup_complete=true', async () => {
    const res = await request(app).post('/api/setup/complete').send(validPayload)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })

    const { rows } = await pool.query(
      "SELECT setup_complete, enabled FROM prime_agent_config WHERE id='default'"
    )
    expect(rows[0].setup_complete).toBe(true)
    expect(rows[0].enabled).toBe(true)
  })

  it('inserts provider with encrypted api_key', async () => {
    const { rows } = await pool.query("SELECT * FROM providers WHERE name='anthropic-main'")
    expect(rows).toHaveLength(1)
    expect(rows[0].api_key).not.toBe('sk-ant-test')
    expect(rows[0].type).toBe('anthropic')
    expect(rows[0].model).toBe('claude-sonnet-4-6')
  })

  it('writes provider_routing with resolved provider_id', async () => {
    const { rows: prov } = await pool.query("SELECT id FROM providers WHERE name='anthropic-main'")
    const providerId = prov[0].id
    const { rows } = await pool.query(
      "SELECT provider_routing FROM prime_agent_config WHERE id='default'"
    )
    expect(rows[0].provider_routing.planning[0].provider_id).toBe(providerId)
    expect(rows[0].provider_routing.planning[0].model).toBe('claude-sonnet-4-6')
  })

  it('omits empty route arrays from provider_routing', async () => {
    const { rows } = await pool.query(
      "SELECT provider_routing FROM prime_agent_config WHERE id='default'"
    )
    expect(rows[0].provider_routing.dispatching).toBeUndefined()
    expect(rows[0].provider_routing.discussion).toBeUndefined()
  })

  it('upserts chief_profiles with persona and operating_policy', async () => {
    const { rows } = await pool.query(
      "SELECT persona, operating_policy, name FROM chief_profiles WHERE id='default'"
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Prime')
    expect(rows[0].persona).toContain('You are Prime, Senior backend engineer.')
    expect(rows[0].persona).toContain('Direct & concise')
    expect(rows[0].operating_policy).toContain('Never force-push to main or protected branches')
  })

  it('skips re-inserting a pre-created provider when id is in payload', async () => {
    const { rows: existing } = await pool.query("SELECT id FROM providers WHERE name='anthropic-main'")
    const preCreatedId = existing[0].id

    const res = await request(app).post('/api/setup/complete').send({
      ...validPayload,
      providers: [{ ...validPayload.providers[0], id: preCreatedId }],
    })
    expect(res.status).toBe(200)

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int as count FROM providers WHERE name='anthropic-main'"
    )
    expect(rows[0].count).toBe(1)
  })

  it('updates existing provider by name on retry (idempotent)', async () => {
    const res = await request(app).post('/api/setup/complete').send({
      ...validPayload,
      providers: [{ ...validPayload.providers[0], model: 'claude-opus-4-7' }],
    })
    expect(res.status).toBe(200)
    const { rows } = await pool.query("SELECT model FROM providers WHERE name='anthropic-main'")
    expect(rows[0].model).toBe('claude-opus-4-7')
  })

  it('sets enabled=false when launch: false', async () => {
    await pool.query("UPDATE prime_agent_config SET enabled=false WHERE id='default'")
    await request(app).post('/api/setup/complete').send({ ...validPayload, launch: false })
    const { rows } = await pool.query(
      "SELECT enabled FROM prime_agent_config WHERE id='default'"
    )
    expect(rows[0].enabled).toBe(false)
  })

  it('returns 400 when providers array is missing', async () => {
    const { providers: _p, ...rest } = validPayload
    const res = await request(app).post('/api/setup/complete').send(rest)
    expect(res.status).toBe(400)
  })
})
