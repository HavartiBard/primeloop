import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../../src/db.js'
import {
  listConfiguredPrimeModules,
  listPrimeModuleConfigAudits,
  listPrimeModuleConfigs,
  listPrimeModules,
  updatePrimeModuleConfig,
} from '../../src/prime-agent/modules/registry.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('prime-agent module config registry', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
  })

  beforeEach(async () => {
    await pool.query('DELETE FROM prime_agent_module_audits')
    await pool.query('DELETE FROM prime_agent_modules')
    await runMigrations(pool)
  })

  afterAll(async () => {
    await pool.query('DELETE FROM prime_agent_module_audits')
    await pool.query('DELETE FROM prime_agent_modules')
    await pool.end()
  })

  it('seeds persisted module rows from the static registry', async () => {
    const configs = await listPrimeModuleConfigs(pool)

    expect(configs.map((config) => config.module_id)).toEqual([
      'action.dispatch',
      'context.fleet-state',
      'debounce.pass-through',
      'decision.llm-router',
      'feedback.approval-continuation',
      'policy.scope-required',
      'trigger.event-ingress',
    ])
  })

  it('updates module config and keeps shadow modules in runtime loading metadata', async () => {
    const feedbackModule = listPrimeModules().find((module) => module.id === 'feedback.approval-continuation')!
    const updated = await updatePrimeModuleConfig(pool, 'feedback.approval-continuation', {
      enabled: true,
      pinned_version: feedbackModule.version,
      rollout_mode: 'shadow',
      config: {},
    }, 'james')

    const modules = await listConfiguredPrimeModules(pool)
    const audits = await listPrimeModuleConfigAudits(pool, 'feedback.approval-continuation')

    expect(updated).toMatchObject({
      module_id: 'feedback.approval-continuation',
      enabled: true,
      pinned_version: feedbackModule.version,
      rollout_mode: 'shadow',
      config: {},
    })
    expect(modules.find((entry) => entry.module.id === 'feedback.approval-continuation')).toMatchObject({
      rollout_mode: 'shadow',
    })
    expect(audits[0]).toMatchObject({
      actor: 'james',
      module_id: 'feedback.approval-continuation',
    })
    expect(audits[0]?.changed_fields).toContain('pinned_version')
    expect(audits[0]?.changed_fields).toContain('rollout_mode')
  })

  it('rejects unsupported config keys for modules without config schema', async () => {
    await expect(
      updatePrimeModuleConfig(pool, 'action.dispatch', {
        config: { note: 'not allowed' },
      })
    ).rejects.toThrow('invalid prime module patch: unsupported config keys for action.dispatch: note')
  })

  it('rejects disabling required active modules', async () => {
    await expect(
      updatePrimeModuleConfig(pool, 'decision.llm-router', {
        enabled: false,
      })
    ).rejects.toThrow('invalid prime module patch: decision.llm-router must remain enabled and active')

    await expect(
      updatePrimeModuleConfig(pool, 'action.dispatch', {
        rollout_mode: 'shadow',
      })
    ).rejects.toThrow('invalid prime module patch: action.dispatch must remain enabled and active')
  })

  it('refreshes stale default versions from the static registry on bootstrap', async () => {
    await pool.query(
      `INSERT INTO prime_agent_modules (module_id, stage, default_version, enabled, rollout_mode, config)
       VALUES ('feedback.approval-continuation', 'feedback', '0.9.0', true, 'active', '{}')
       ON CONFLICT (module_id) DO UPDATE SET default_version = EXCLUDED.default_version`
    )

    const configs = await listPrimeModuleConfigs(pool)
    const feedback = configs.find((config) => config.module_id === 'feedback.approval-continuation')
    const feedbackModule = listPrimeModules().find((module) => module.id === 'feedback.approval-continuation')

    expect(feedback?.default_version).toBe(feedbackModule?.version)
  })
})
