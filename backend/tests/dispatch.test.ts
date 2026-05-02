import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startIntegration, stopIntegration } from '../src/dispatch.js'
import type { RegistryAgent } from '../src/registry.js'

vi.mock('../src/agents/raclette.js', () => ({
  startHermesPolling: vi.fn(() => setInterval(() => {}, 100000)),
}))

import { startHermesPolling } from '../src/agents/raclette.js'

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
    vi.clearAllMocks()
    stopIntegration('test-id')  // clean up any active integration
  })

  it('starts hermes integration with correct deps', () => {
    const deps = { pool: {} as any, broadcast: vi.fn() }
    startIntegration(makeAgent(), deps)
    expect(startHermesPolling).toHaveBeenCalledWith(expect.objectContaining({
      agentName: 'test-agent',
      apiUrl: 'http://example.com',
    }))
  })

  it('does not start if already active', () => {
    const deps = { pool: {} as any, broadcast: vi.fn() }
    startIntegration(makeAgent(), deps)
    startIntegration(makeAgent(), deps)
    expect(startHermesPolling).toHaveBeenCalledTimes(1)
  })

  it('does not start if disabled', () => {
    const deps = { pool: {} as any, broadcast: vi.fn() }
    startIntegration(makeAgent({ enabled: false }), deps)
    expect(startHermesPolling).not.toHaveBeenCalled()
  })

  it('stops integration and allows restart', () => {
    const deps = { pool: {} as any, broadcast: vi.fn() }
    startIntegration(makeAgent(), deps)
    stopIntegration('test-id')
    startIntegration(makeAgent(), deps)
    expect(startHermesPolling).toHaveBeenCalledTimes(2)
  })

  it('does not start non-hermes types', () => {
    const deps = { pool: {} as any, broadcast: vi.fn() }
    startIntegration(makeAgent({ type: 'langgraph' }), deps)
    startIntegration(makeAgent({ type: 'codex-thread' }), deps)
    expect(startHermesPolling).not.toHaveBeenCalled()
  })
})
