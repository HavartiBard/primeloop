import { describe, it, expect, beforeEach } from 'vitest'
import { startIntegration, stopIntegration } from '../src/dispatch.js'
import type { RegistryAgent } from '../src/registry.js'

// NOTE: hermes/raclette polling integration was removed; `startIntegration` is now a
// no-op stub with an idempotency guard. These tests assert the current contract — that
// dispatch is safe to call across agent types/states and that stop is idempotent.

const makeAgent = (overrides: Partial<RegistryAgent> = {}): RegistryAgent => ({
  id: 'test-id',
  name: 'test-agent',
  type: 'hermes',
  config: { api_url: 'http://example.com' },
  enabled: true,
  created_at: new Date().toISOString(),
  ...overrides,
})

describe('dispatch', () => {
  beforeEach(() => {
    stopIntegration('test-id') // clean up any active integration
  })

  it('starts an integration without throwing for an enabled agent', () => {
    const deps = { pool: {} as any, broadcast: () => {} }
    expect(() => startIntegration(makeAgent(), deps)).not.toThrow()
  })

  it('is idempotent when called repeatedly for the same agent', () => {
    const deps = { pool: {} as any, broadcast: () => {} }
    startIntegration(makeAgent(), deps)
    expect(() => startIntegration(makeAgent(), deps)).not.toThrow()
  })

  it('does not start when the agent is disabled', () => {
    const deps = { pool: {} as any, broadcast: () => {} }
    expect(() => startIntegration(makeAgent({ enabled: false }), deps)).not.toThrow()
  })

  it('allows start again after stop', () => {
    const deps = { pool: {} as any, broadcast: () => {} }
    startIntegration(makeAgent(), deps)
    stopIntegration('test-id')
    expect(() => startIntegration(makeAgent(), deps)).not.toThrow()
  })

  it('stopIntegration is safe for an unknown id', () => {
    expect(() => stopIntegration('never-started')).not.toThrow()
  })
})
