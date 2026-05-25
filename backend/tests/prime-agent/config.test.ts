import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../../src/db.js'
import { getPrimeConfig, updatePrimeConfig } from '../../src/prime-agent/config.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('prime-agent config service', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM prime_agent_sessions')
    await pool.query('DELETE FROM prime_agent_config')
    await runMigrations(pool)
  })

  afterAll(async () => {
    await pool.query('DELETE FROM prime_agent_sessions')
    await pool.query('DELETE FROM prime_agent_config')
    await pool.end()
  })

  it('returns the default singleton config row', async () => {
    const config = await getPrimeConfig(pool)

    expect(config.id).toBe('default')
    expect(config.enabled).toBe(false)
    expect(config.cron_fast_interval_seconds).toBe(300)
    expect(config.cron_slow_interval_seconds).toBe(3600)
    expect(config.debounce_window_ms).toBe(10000)
    expect(config.provider_routing).toEqual({})
    expect(config.cost_controls).toEqual({})
    expect(config.git_store).toEqual({})
    expect(config.model_preferences).toEqual({})
    expect(config.status).toBe('stopped')
  })

  it('migrates legacy provider_routing to model_preferences on first read', async () => {
    // Seed legacy provider_routing data
    await pool.query(
      `UPDATE prime_agent_config SET provider_routing = $1`,
      [JSON.stringify({ planning: [{ provider_id: 'p1', model: 'claude-sonnet' }, { provider_id: 'p2', model: 'gpt-4o' }] })],
    )

    const config = await getPrimeConfig(pool)

    expect(config.model_preferences).toEqual({
      planning: {
        primary: { provider_id: 'p1', model: 'claude-sonnet' },
        fallbacks: [{ provider_id: 'p2', model: 'gpt-4o' }],
      },
    })
  })

  it('updates scalar and json fields and returns the typed row', async () => {
    const updated = await updatePrimeConfig(pool, {
      enabled: true,
      cron_fast_interval_seconds: 120,
      debounce_window_ms: 5000,
      provider_routing: {
        planning: [{ provider_id: 'provider-1', model: 'gpt-test' }],
      },
      cost_controls: { fleet_daily_token_cap: 12345 },
      git_store: { provider: 'gitea', branch: 'main' },
      status: 'running',
      last_error: 'previous failure',
    })

    expect(updated.enabled).toBe(true)
    expect(updated.cron_fast_interval_seconds).toBe(120)
    expect(updated.debounce_window_ms).toBe(5000)
    expect(updated.provider_routing).toEqual({
      planning: [{ provider_id: 'provider-1', model: 'gpt-test' }],
    })
    expect(updated.cost_controls).toEqual({ fleet_daily_token_cap: 12345 })
    expect(updated.git_store).toEqual({ provider: 'gitea', branch: 'main' })
    expect(updated.status).toBe('running')
    expect(updated.last_error).toBe('previous failure')
  })

  it('updates model_preferences and returns the typed row', async () => {
    const updated = await updatePrimeConfig(pool, {
      model_preferences: {
        planning: {
          primary: { provider_id: 'anthropic-main', model: 'claude-sonnet-4' },
          fallbacks: [
            { provider_id: 'openai-main', model: 'gpt-4o' },
            { provider_id: 'ollama-local', model: 'qwen3-32b' },
          ],
        },
        routing: {
          primary: { provider_id: 'openai-main', model: 'gpt-4o-mini' },
          fallbacks: [],
        },
      },
    })

    expect(updated.model_preferences).toEqual({
      planning: {
        primary: { provider_id: 'anthropic-main', model: 'claude-sonnet-4' },
        fallbacks: [
          { provider_id: 'openai-main', model: 'gpt-4o' },
          { provider_id: 'ollama-local', model: 'qwen3-32b' },
        ],
      },
      routing: {
        primary: { provider_id: 'openai-main', model: 'gpt-4o-mini' },
        fallbacks: [],
      },
    })
  })

  it('resolveModelRoutes returns preference chain and falls back to legacy', async () => {
    const { resolveModelRoutes } = await import('../../src/prime-agent/config.js')

    // Test with model_preferences set
    await updatePrimeConfig(pool, {
      model_preferences: {
        planning: {
          primary: { provider_id: 'a', model: 'm1' },
          fallbacks: [{ provider_id: 'b', model: 'm2' }],
        },
      },
    })

    const config = await getPrimeConfig(pool)
    const routes = resolveModelRoutes(config, 'planning')
    expect(routes).toEqual([
      { provider_id: 'a', model: 'm1' },
      { provider_id: 'b', model: 'm2' },
    ])

    // Test fallback to legacy provider_routing when no preferences for this function
    const routingRoutes = resolveModelRoutes(config, 'routing')
    expect(routingRoutes).toEqual([])
  })
})
