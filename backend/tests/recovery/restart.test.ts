import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insertRuntimeEvent: vi.fn(async () => ({})),
}))

vi.mock('../../src/runtime.js', () => ({
  insertRuntimeEvent: mocks.insertRuntimeEvent,
}))

import {
  reconcileLauncherRuntimeAfterRestart,
  recordLauncherRecoveryOutcome,
} from '../../src/recovery/restart.js'

describe('launcher restart recovery', () => {
  const pool = { query: vi.fn() } as any

  beforeEach(() => {
    mocks.insertRuntimeEvent.mockClear()
  })

  it('records reattached outcome for healthy runtime', async () => {
    const result = await reconcileLauncherRuntimeAfterRestart(pool, 'agent-1', { state: 'ready' })
    expect(result).toBe('reattached')
    expect(mocks.insertRuntimeEvent).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        event_type: 'launcher.runtime_recovery',
        actor: 'recovery',
        payload: expect.objectContaining({ agent_id: 'agent-1', outcome: 'reattached' }),
      }),
    )
  })

  it('records reprovisioned outcome for unhealthy runtime', async () => {
    const result = await reconcileLauncherRuntimeAfterRestart(pool, 'agent-1', { state: 'unhealthy' })
    expect(result).toBe('reprovisioned')
  })

  it('records unavailable outcome when runtime not found', async () => {
    const result = await reconcileLauncherRuntimeAfterRestart(pool, 'agent-1', null)
    expect(result).toBe('unavailable')
  })

  it('records launcher recovery events directly', async () => {
    await recordLauncherRecoveryOutcome(pool, 'agent-1', 'backend_restart', 'cleaned_up', 'cleanup complete')
    expect(mocks.insertRuntimeEvent).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        event_type: 'launcher.runtime_recovery',
        payload: expect.objectContaining({ reason: 'cleanup complete' }),
      }),
    )
  })
})
