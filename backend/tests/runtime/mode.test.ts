import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveRuntimeMode, evaluateRuntimeMode, recordRuntimeModeRollback } from '../../src/runtime/mode.js'

// Mock the launcher client so evaluateRuntimeMode doesn't hit the network.
vi.mock('../../src/runtime/launcher-client.js', () => ({
  createLauncherClient: vi.fn(),
}))

import { createLauncherClient } from '../../src/runtime/launcher-client.js'

describe('runtime mode (spec 025 US3)', () => {
  const baseEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...baseEnv }
    vi.clearAllMocks()
  })

  describe('resolveRuntimeMode', () => {
    it('returns backend-local when launcher is disabled', () => {
      expect(resolveRuntimeMode({})).toBe('backend-local')
    })

    it('returns launcher-managed when LAUNCHER_ENABLED=1', () => {
      expect(resolveRuntimeMode({ LAUNCHER_ENABLED: '1' })).toBe('launcher-managed')
    })

    it('returns launcher-managed when EGRESS_SANDBOX=1 (isolation default)', () => {
      expect(resolveRuntimeMode({ EGRESS_SANDBOX: '1' })).toBe('launcher-managed')
    })
  })

  describe('evaluateRuntimeMode', () => {
    it('reports backend-local as always rollout-ready without contacting the launcher', async () => {
      const status = await evaluateRuntimeMode({})
      expect(status.mode).toBe('backend-local')
      expect(status.rolloutReady).toBe(true)
      expect(status.launcherReachable).toBe(false)
      expect(createLauncherClient).not.toHaveBeenCalled()
    })

    it('marks rollout ready when launcher is healthy and auth secret is set', async () => {
      vi.mocked(createLauncherClient).mockReturnValue({
        getHealth: async () => ({ status: 'ok', launcherVersion: '1.0.0', containerRuntimeReachable: true, notes: [] }),
      } as never)

      const status = await evaluateRuntimeMode({ LAUNCHER_ENABLED: '1', LAUNCHER_AUTH_SECRET: 'secret', LAUNCHER_URL: 'http://launcher:8787' })
      expect(status.mode).toBe('launcher-managed')
      expect(status.launcherReachable).toBe(true)
      expect(status.rolloutReady).toBe(true)
    })

    it('blocks rollout when the launcher is unreachable', async () => {
      vi.mocked(createLauncherClient).mockReturnValue({
        getHealth: async () => { throw new Error('ECONNREFUSED') },
      } as never)

      const status = await evaluateRuntimeMode({ LAUNCHER_ENABLED: '1', LAUNCHER_AUTH_SECRET: 'secret' })
      expect(status.mode).toBe('launcher-managed')
      expect(status.rolloutReady).toBe(false)
      expect(status.notes.join(' ')).toMatch(/unreachable/i)
    })

    it('blocks rollout and notes the missing auth secret', async () => {
      vi.mocked(createLauncherClient).mockReturnValue({
        getHealth: async () => ({ status: 'ok', launcherVersion: '1.0.0', containerRuntimeReachable: true, notes: [] }),
      } as never)

      const status = await evaluateRuntimeMode({ LAUNCHER_ENABLED: '1' })
      expect(status.rolloutReady).toBe(false)
      expect(status.notes.join(' ')).toMatch(/LAUNCHER_AUTH_SECRET/)
    })
  })

  describe('recordRuntimeModeRollback', () => {
    it('inserts a rollback runtime event with the reason', async () => {
      const query = vi.fn(async () => ({ rows: [], rowCount: 1 }))
      const pool = { query } as never
      await recordRuntimeModeRollback(pool, 'launcher unhealthy')
      const insertCall = query.mock.calls.find(([sql]) => typeof sql === 'string' && sql.includes('runtime_events'))
      expect(insertCall).toBeDefined()
      const params = insertCall?.[1] as unknown[]
      expect(JSON.stringify(params)).toContain('runtime.mode_rollback')
      expect(JSON.stringify(params)).toContain('launcher unhealthy')
    })
  })
})
