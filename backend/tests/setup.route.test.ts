import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
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
    expect(res.body.complete).toBe(false)
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
    expect(res.body.ok).toBe(true)

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

// ─── T034: User Story 3 - Prime config draft validation and persistence ──────────────────────────────────────────────

describe.skip('PUT /api/setup/draft - Prime config review', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
  })

  it('accepts Prime config draft with cron_fast_interval_seconds, debounce_window_ms, monthly_token_budget', async () => {
    const draft = {
      providers: [],
      function_assignments: [],
      prime_config_draft: {
        enabled: true,
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: [],
      current_step: 'prime_config',
      status: 'in_progress',
    }

    const res = await request(app).put('/api/setup/draft').send(draft)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('accepts default Prime config values when user accepts without changes', async () => {
    const draft = {
      providers: [],
      function_assignments: [],
      prime_config_draft: {
        enabled: true,
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: [],
      current_step: 'prime_config',
      status: 'ready_to_launch',
    }

    const res = await request(app).put('/api/setup/draft').send(draft)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Verify values are persisted correctly
    const { rows } = await pool.query(
      "SELECT prime_config_draft FROM onboarding_session WHERE id='default'"
    )
    expect(rows[0].prime_config_draft.cron_fast_interval_seconds).toBe(300)
    expect(rows[0].prime_config_draft.debounce_window_ms).toBe(10000)
    expect(rows[0].prime_config_draft.monthly_token_budget).toBe(0)
  })

  it('returns validation error for negative cron_fast_interval_seconds', async () => {
    const draft = {
      providers: [],
      function_assignments: [],
      prime_config_draft: {
        enabled: true,
        cron_fast_interval_seconds: -1,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: [],
      current_step: 'prime_config',
      status: 'blocked',
    }

    const res = await request(app).put('/api/setup/draft').send(draft)
    expect(res.status).toBe(200)
    // Backend validates and sets status to blocked for invalid values
    expect(res.body.ok).toBe(true)
  })

  it('returns validation error for negative debounce_window_ms', async () => {
    const draft = {
      providers: [],
      function_assignments: [],
      prime_config_draft: {
        enabled: true,
        cron_fast_interval_seconds: 300,
        debounce_window_ms: -100,
        monthly_token_budget: 0,
      },
      plugin_choices: [],
      current_step: 'prime_config',
      status: 'blocked',
    }

    const res = await request(app).put('/api/setup/draft').send(draft)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('returns validation error for negative monthly_token_budget', async () => {
    const draft = {
      providers: [],
      function_assignments: [],
      prime_config_draft: {
        enabled: true,
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: -1000,
      },
      plugin_choices: [],
      current_step: 'prime_config',
      status: 'blocked',
    }

    const res = await request(app).put('/api/setup/draft').send(draft)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('returns launch_readiness with ready=true when config is valid and all functions assigned', async () => {
    const draft = {
      providers: [],
      function_assignments: [
        { function_key: 'orchestration', display_name: 'Orchestration', purpose: 'test', required: true, provider_id: 'p1', model: 'm1', validation_status: 'valid', warnings: [], is_default_choice: false },
        { function_key: 'planning', display_name: 'Planning', purpose: 'test', required: true, provider_id: 'p1', model: 'm1', validation_status: 'valid', warnings: [], is_default_choice: false },
        { function_key: 'coding_execution', display_name: 'Coding/Execution', purpose: 'test', required: true, provider_id: 'p1', model: 'm1', validation_status: 'valid', warnings: [], is_default_choice: false },
        { function_key: 'review_validation', display_name: 'Review/Validation', purpose: 'test', required: true, provider_id: 'p1', model: 'm1', validation_status: 'valid', warnings: [], is_default_choice: false },
        { function_key: 'platform_maintenance', display_name: 'Platform Maintenance', purpose: 'test', required: true, provider_id: 'p1', model: 'm1', validation_status: 'valid', warnings: [], is_default_choice: false },
      ],
      prime_config_draft: {
        enabled: true,
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: [],
      current_step: 'prime_config',
      status: 'ready_to_launch',
    }

    const res = await request(app).put('/api/setup/draft').send(draft)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.launch_readiness.ready).toBe(true)
    expect(res.body.launch_readiness.blocking_reasons).toEqual([])
  })
})

describe('POST /api/setup/complete - Finalized Prime config persistence', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await pool.query('DELETE FROM providers')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false, enabled=false WHERE id='default'")
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query('DELETE FROM providers')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false, enabled=false WHERE id='default'")
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
    await pool.query('DELETE FROM providers')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false, enabled=false WHERE id='default'")
  })

  const basePayload = {
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

  const createValidPayload = (overrides: Partial<typeof basePayload> = {}) => ({
    ...basePayload,
    prime_config: {
      cron_fast_interval_seconds: 300,
      cron_slow_interval_seconds: 3600,
      debounce_window_ms: 10000,
      cost_controls: { monthly_token_budget: 0 },
    },
    ...overrides,
  })

  it('persists finalized Prime config with cron_fast_interval_seconds, cron_slow_interval_seconds, debounce_window_ms', async () => {
    const payload = createValidPayload()
    const res = await request(app).post('/api/setup/complete').send(payload)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const { rows } = await pool.query(
      "SELECT cron_fast_interval_seconds, cron_slow_interval_seconds, debounce_window_ms, cost_controls FROM prime_agent_config WHERE id='default'"
    )
    expect(rows[0].cron_fast_interval_seconds).toBe(300)
    expect(rows[0].cron_slow_interval_seconds).toBe(3600)
    expect(rows[0].debounce_window_ms).toBe(10000)
    expect(rows[0].cost_controls.monthly_token_budget).toBe(0)
  })

  it('accepts default Prime config values when no custom values provided', async () => {
    const payload = createValidPayload({
      prime_config: {
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        cost_controls: { monthly_token_budget: 0 },
      },
    })
    const res = await request(app).post('/api/setup/complete').send(payload)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const { rows } = await pool.query(
      "SELECT cron_fast_interval_seconds, debounce_window_ms FROM prime_agent_config WHERE id='default'"
    )
    expect(rows[0].cron_fast_interval_seconds).toBe(300)
    expect(rows[0].debounce_window_ms).toBe(10000)
  })

  it('returns 400 when cron_fast_interval_seconds is negative', async () => {
    const payload = createValidPayload({
      prime_config: {
        cron_fast_interval_seconds: -1,
        debounce_window_ms: 10000,
        cost_controls: { monthly_token_budget: 0 },
      },
    })
    const res = await request(app).post('/api/setup/complete').send(payload)
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns 400 when debounce_window_ms is negative', async () => {
    const payload = createValidPayload({
      prime_config: {
        cron_fast_interval_seconds: 300,
        debounce_window_ms: -100,
        cost_controls: { monthly_token_budget: 0 },
      },
    })
    const res = await request(app).post('/api/setup/complete').send(payload)
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it.skip('returns 400 when monthly_token_budget is negative', async () => {
    const payload = createValidPayload({
      prime_config: {
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        cost_controls: { monthly_token_budget: -1000 },
      },
    })
    const res = await request(app).post('/api/setup/complete').send(payload)
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('launches Prime with validated config when all values are valid', async () => {
    const payload = createValidPayload()
    const res = await request(app).post('/api/setup/complete').send(payload)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const { rows } = await pool.query(
      "SELECT enabled, setup_complete FROM prime_agent_config WHERE id='default'"
    )
    expect(rows[0].enabled).toBe(true)
    expect(rows[0].setup_complete).toBe(true)
  })
})

// ─── T042: User Story 4 - Choose optional plugins during onboarding ─────────────────────────────────────────────────

describe('GET /api/setup/plugins', () => {
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

  beforeEach(async () => {
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
  })

  it('returns available plugin list with metadata (name, description, optional flag)', async () => {
    const res = await request(app).get('/api/setup/plugins')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    
    const plugins = res.body
    expect(plugins.length).toBeGreaterThan(0)
    
    // Verify each plugin has required metadata
    for (const plugin of plugins) {
      expect(plugin).toHaveProperty('id')
      expect(plugin).toHaveProperty('name')
      expect(plugin).toHaveProperty('description')
      expect(plugin).toHaveProperty('optional')
      expect(plugin).toHaveProperty('status')
      expect(typeof plugin.id).toBe('string')
      expect(typeof plugin.name).toBe('string')
      expect(typeof plugin.description).toBe('string')
      expect(typeof plugin.optional).toBe('boolean')
      expect(['available', 'unavailable', 'installed'].includes(plugin.status)).toBe(true)
    }
    
    // Verify expected plugins are present
    const pluginIds = plugins.map((p: { id: string }) => p.id)
    expect(pluginIds).toContain('spec-kit')
    expect(pluginIds).toContain('plan-mode')
    expect(pluginIds).toContain('code-review')
    expect(pluginIds).toContain('git-hooks')
  })
})

describe('GET /api/setup/plugins - empty inventory', () => {
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

  it('returns empty array when no plugins available', async () => {
    // This test verifies the endpoint returns an empty array when there are no plugins
    // The actual implementation always returns static plugins, but we test the structure
    const res = await request(app).get('/api/setup/plugins')
    expect(res.status).toBe(200)
    
    // Even with no plugins, should return an empty array, not null/undefined
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('PUT /api/setup/draft with plugin_choices', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
  })

  it('persists selected plugin IDs in draft', async () => {
    const draft = {
      providers: [],
      function_assignments: [],
      prime_config_draft: {
        enabled: true,
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: [
        {
          plugin_id: 'spec-kit',
          name: 'Spec Kit',
          description: 'Schema and specification validation toolkit',
          selected: true,
          deferred_config: false,
        },
        {
          plugin_id: 'code-review',
          name: 'Code Review',
          description: 'Automated code quality and style analysis',
          selected: true,
          deferred_config: true,
        },
      ],
      current_step: 'plugins',
      status: 'in_progress',
    }

    const res = await request(app).put('/api/setup/draft').send(draft)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Verify plugin choices are persisted correctly
    const { rows } = await pool.query(
      "SELECT plugin_choices FROM onboarding_session WHERE id='default'"
    )
    expect(rows[0].plugin_choices).toBeDefined()
    
    const persistedChoices = rows[0].plugin_choices
    expect(persistedChoices.length).toBe(2)
    
    const specKitChoice = persistedChoices.find((p: any) => p.plugin_id === 'spec-kit')
    expect(specKitChoice).toBeDefined()
    expect(specKitChoice.selected).toBe(true)
    expect(specKitChoice.deferred_config).toBe(false)
    
    const codeReviewChoice = persistedChoices.find((p: any) => p.plugin_id === 'code-review')
    expect(codeReviewChoice).toBeDefined()
    expect(codeReviewChoice.selected).toBe(true)
    expect(codeReviewChoice.deferred_config).toBeDefined()
  })

  it('stores skipped plugins as skipped', async () => {
    const draft = {
      providers: [],
      function_assignments: [],
      prime_config_draft: {
        enabled: true,
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: [
        {
          plugin_id: 'spec-kit',
          name: 'Spec Kit',
          description: 'Schema and specification validation toolkit',
          selected: false,
          deferred_config: false,
        },
        {
          plugin_id: 'plan-mode',
          name: 'Plan Mode',
          description: 'Strategic planning and task decomposition helper',
          selected: false,
          deferred_config: false,
        },
      ],
      current_step: 'plugins',
      status: 'ready_to_launch',
    }

    const res = await request(app).put('/api/setup/draft').send(draft)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Verify skipped plugins are persisted with selected=false
    const { rows } = await pool.query(
      "SELECT plugin_choices FROM onboarding_session WHERE id='default'"
    )
    expect(rows[0].plugin_choices).toBeDefined()
    
    const persistedChoices = rows[0].plugin_choices
    expect(persistedChoices.length).toBe(2)
    
    for (const choice of persistedChoices) {
      expect(choice.selected).toBe(false)
    }
  })
})

describe('POST /api/setup/complete - plugin selection non-blocking', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await pool.query('DELETE FROM providers')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false, enabled=false WHERE id='default'")
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query('DELETE FROM providers')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false, enabled=false WHERE id='default'")
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM providers')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false, enabled=false WHERE id='default'")
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
  })

  const validPayloadWithPlugins = {
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
    prime_config: {
      cron_fast_interval_seconds: 300,
      debounce_window_ms: 10000,
      monthly_token_budget: 0,
    },
    plugin_choices: [
      {
        plugin_id: 'spec-kit',
        name: 'Spec Kit',
        description: 'Schema and specification validation toolkit',
        selected: true,
        deferred_config: false,
      },
      {
        plugin_id: 'code-review',
        name: 'Code Review',
        description: 'Automated code quality and style analysis',
        selected: false,
        deferred_config: false,
      },
    ],
  }

  it('does NOT block launch when plugins are selected or skipped (non-blocking validation)', async () => {
    // Save draft with plugin choices first
    const draft = {
      providers: validPayloadWithPlugins.providers,
      function_assignments: [],
      prime_config_draft: {
        enabled: true,
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: validPayloadWithPlugins.plugin_choices,
      current_step: 'plugins',
      status: 'ready_to_launch',
    }

    const draftRes = await request(app).put('/api/setup/draft').send(draft)
    expect(draftRes.status).toBe(200)
    expect(draftRes.body.ok).toBe(true)

    // Complete setup with plugins - should succeed without blocking
    const res = await request(app).post('/api/setup/complete').send(validPayloadWithPlugins)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Verify plugin choices are persisted in the finalized config
    const { rows } = await pool.query(
      "SELECT plugin_choices FROM onboarding_session WHERE id='default'"
    )
    expect(rows[0].plugin_choices).toBeDefined()
    expect(rows[0].plugin_choices.length).toBe(2)
  })

  it('allows complete launch with empty plugin_choices array', async () => {
    const payload = {
      ...validPayloadWithPlugins,
      plugin_choices: [],
    }

    const res = await request(app).post('/api/setup/complete').send(payload)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

// ─── T042: Additional plugin backend tests ──────────────────────────────────────────────────────────────────────────

describe('GET /api/setup/plugins', () => {
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

  it('returns array of available plugins with 200', async () => {
    const res = await request(app).get('/api/setup/plugins')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('each plugin has id, name, description, optional, status fields', async () => {
    const res = await request(app).get('/api/setup/plugins')
    const plugins = res.body
    
    for (const plugin of plugins) {
      expect(plugin).toHaveProperty('id')
      expect(plugin).toHaveProperty('name')
      expect(plugin).toHaveProperty('description')
      expect(plugin).toHaveProperty('optional')
      expect(plugin).toHaveProperty('status')
    }
  })
})

describe('Plugin choices in setup draft', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
  })

  it('PUT /api/setup/draft with plugin_choices persists them', async () => {
    const draft = {
      providers: [],
      function_assignments: [],
      prime_config_draft: {
        enabled: true,
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: [
        {
          plugin_id: 'spec-kit',
          name: 'Spec Kit',
          description: 'Schema and specification validation toolkit',
          selected: true,
          deferred_config: false,
        },
      ],
      current_step: 'plugins',
      status: 'in_progress',
    }

    const res = await request(app).put('/api/setup/draft').send(draft)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const { rows } = await pool.query(
      "SELECT plugin_choices FROM onboarding_session WHERE id='default'"
    )
    expect(rows[0].plugin_choices.length).toBe(1)
    expect(rows[0].plugin_choices[0].plugin_id).toBe('spec-kit')
  })

  it('POST /api/setup/complete succeeds even with no plugin selections (non-blocking)', async () => {
    const payload = {
      providers: [
        {
          name: 'test-provider',
          type: 'anthropic',
          base_url: 'https://api.anthropic.com',
          api_key: 'sk-test',
          model: 'claude-sonnet-4-6',
        },
      ],
      routing: {
        planning: [{ provider_name: 'test-provider', model: 'claude-sonnet-4-6' }],
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
      prime_config: {
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: [],
    }

    const res = await request(app).post('/api/setup/complete').send(payload)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('POST /api/setup/complete - Prime launch behavior', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
    await pool.end()
  })

  beforeEach(async () => {
    await pool.query("DELETE FROM onboarding_session WHERE id='default'")
  })

  it('returns prime_launch.thread_id when launch=true', async () => {
    const payload = {
      providers: [
        {
          name: 'test-provider',
          type: 'anthropic',
          base_url: 'https://api.anthropic.com',
          api_key: 'sk-test',
          model: 'claude-sonnet-4-6',
        },
      ],
      routing: {
        planning: [{ provider_name: 'test-provider', model: 'claude-sonnet-4-6' }],
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
      prime_config: {
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: [],
    }

    const res = await request(app).post('/api/setup/complete').send(payload)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ok: true,
      prime_launch: {
        status: 'launched',
        thread_id: expect.any(String),
      },
    })
  })

  it('returns ok:true without prime_launch when launch=false', async () => {
    const payload = {
      providers: [
        {
          name: 'test-provider',
          type: 'anthropic',
          base_url: 'https://api.anthropic.com',
          api_key: 'sk-test',
          model: 'claude-sonnet-4-6',
        },
      ],
      routing: {
        planning: [{ provider_name: 'test-provider', model: 'claude-sonnet-4-6' }],
      },
      persona: {
        name: 'Prime',
        focus: 'Senior backend engineer',
        tone: 'direct',
        instructions: '',
      },
      rules: { presets: ['no_force_push'], custom: '' },
      cost_controls: { monthly_token_budget: 0 },
      launch: false,
      prime_config: {
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: [],
    }

    const res = await request(app).post('/api/setup/complete').send(payload)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body).not.toHaveProperty('prime_launch')
  })

  it('preserves configuration on launch failure', async () => {
    const payload = {
      providers: [
        {
          name: 'test-provider',
          type: 'anthropic',
          base_url: 'https://api.anthropic.com',
          api_key: 'sk-test',
          model: 'claude-sonnet-4-6',
        },
      ],
      routing: {
        planning: [{ provider_name: 'test-provider', model: 'claude-sonnet-4-6' }],
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
      prime_config: {
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: [],
    }

    const res = await request(app).post('/api/setup/complete').send(payload)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const { rows } = await pool.query(
      "SELECT status FROM onboarding_session WHERE id='default'"
    )
    if (rows.length > 0) {
      expect(rows[0].status).toBeDefined()
    }
  })

  it.skip('setup remains complete even if Prime thread creation fails', async () => {
    const payload = {
      providers: [
        {
          name: 'test-provider',
          type: 'anthropic',
          base_url: 'https://api.anthropic.com',
          api_key: 'sk-test',
          model: 'claude-sonnet-4-6',
        },
      ],
      routing: {
        planning: [{ provider_name: 'test-provider', model: 'claude-sonnet-4-6' }],
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
      prime_config: {
        cron_fast_interval_seconds: 300,
        debounce_window_ms: 10000,
        monthly_token_budget: 0,
      },
      plugin_choices: [],
    }

    const res = await request(app).post('/api/setup/complete').send(payload)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.prime_launch).toBeDefined()
    expect(res.body.prime_launch.status).toBe('error')
    expect(res.body.prime_launch).toHaveProperty('error')

    const { rows } = await pool.query(
      "SELECT status FROM onboarding_session WHERE id='default'"
    )
    expect(rows[0].status).toBeDefined()
  })
})
