import { describe, expect, it, vi } from 'vitest'
import { GenericHttpAdapter } from '../../src/adapters/generic-http.js'
import type { RegistryAgent } from '../../src/registry.js'

const agent: RegistryAgent = {
  id: 'agent-1',
  name: 'openclaw-worker',
  type: 'worker',
  runtime_family: 'openclaw',
  execution_mode: 'external',
  endpoint: 'http://agent.local',
  capabilities: ['research', 'audit'],
  config: {},
  enabled: true,
  created_at: new Date(0).toISOString(),
}

describe('GenericHttpAdapter', () => {
  it('discovers capabilities from an agent card', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        name: 'OpenClaw Worker',
        protocol: 'a2a-compatible',
        capabilities: ['research', 'code-exploration'],
      }), { status: 200 })
    )
    const adapter = new GenericHttpAdapter(fetchFn)

    const result = await adapter.discover(agent)

    expect(fetchFn).toHaveBeenCalledWith('http://agent.local/.well-known/agent-card.json')
    expect(result.name).toBe('OpenClaw Worker')
    expect(result.capabilities).toEqual(['research', 'code-exploration'])
    expect(result.runtime_family).toBe('openclaw')
  })

  it('falls back to registry capabilities when no endpoint is configured', async () => {
    const adapter = new GenericHttpAdapter(vi.fn())

    const result = await adapter.discover({ ...agent, endpoint: undefined })

    expect(result.name).toBe('openclaw-worker')
    expect(result.protocol).toBe('registry')
    expect(result.capabilities).toEqual(['research', 'audit'])
  })

  it('reports health through the agent health endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    )
    const adapter = new GenericHttpAdapter(fetchFn)

    const result = await adapter.health(agent)

    expect(fetchFn).toHaveBeenCalledWith('http://agent.local/health')
    expect(result.healthy).toBe(true)
    expect(result.status).toBe('ok')
  })
})
