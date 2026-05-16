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
    expect(config.status).toBe('stopped')
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
})
