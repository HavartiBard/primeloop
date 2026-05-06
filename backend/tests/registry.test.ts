import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import {
  listProviders,
  insertProvider,
  updateProvider,
  deleteProvider,
  listAgents,
  getAgent,
  insertAgent,
  updateAgent,
  deleteAgent,
} from '../src/registry.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

let pool: pg.Pool

beforeAll(async () => {
  pool = createPool(TEST_DB)
  await runMigrations(pool)
  // Clean slate — agents must be deleted before providers due to FK
  await pool.query('DELETE FROM agents')
  await pool.query('DELETE FROM providers')
})

afterAll(async () => {
  await pool.query('DELETE FROM agents')
  await pool.query('DELETE FROM providers')
  await pool.end()
})

describe('registry — providers', () => {
  it('listProviders — returns empty array initially', async () => {
    const result = await listProviders(pool)
    expect(result).toEqual([])
  })

  it('insertProvider — inserts and returns provider with id', async () => {
    const provider = await insertProvider(pool, {
      name: 'test-provider',
      type: 'openai',
      base_url: 'https://api.openai.com',
      api_key: 'sk-test',
    })
    expect(provider.id).toBeTruthy()
    expect(provider.name).toBe('test-provider')
    expect(provider.type).toBe('openai')
    expect(provider.base_url).toBe('https://api.openai.com')
    expect(provider.api_key).toBe('sk-test')
    expect(provider.created_at).toBeTruthy()
  })

  it('insertProvider — works without api_key', async () => {
    const provider = await insertProvider(pool, {
      name: 'test-provider-no-key',
      type: 'ollama',
      base_url: 'http://localhost:11434',
    })
    expect(provider.id).toBeTruthy()
    expect(provider.api_key).toBeNull()
  })

  it('listProviders — returns inserted providers', async () => {
    const result = await listProviders(pool)
    expect(result.length).toBeGreaterThanOrEqual(2)
    const names = result.map((p) => p.name)
    expect(names).toContain('test-provider')
    expect(names).toContain('test-provider-no-key')
  })

  it('updateProvider — updates fields', async () => {
    const provider = await insertProvider(pool, {
      name: 'update-me-provider',
      type: 'openai',
      base_url: 'https://api.openai.com',
    })
    const updated = await updateProvider(pool, provider.id, {
      base_url: 'https://api.openai.com/v2',
      api_key: 'sk-new-key',
    })
    expect(updated.id).toBe(provider.id)
    expect(updated.base_url).toBe('https://api.openai.com/v2')
    expect(updated.api_key).toBe('sk-new-key')
    expect(updated.name).toBe('update-me-provider')
  })

  it('deleteProvider — removes row', async () => {
    const provider = await insertProvider(pool, {
      name: 'delete-me-provider',
      type: 'openai',
      base_url: 'https://api.openai.com',
    })
    await deleteProvider(pool, provider.id)
    const result = await listProviders(pool)
    const ids = result.map((p) => p.id)
    expect(ids).not.toContain(provider.id)
  })
})

describe('registry — agents', () => {
  let providerId: string

  beforeAll(async () => {
    // Insert a provider for FK references
    const prov = await insertProvider(pool, {
      name: 'agent-test-provider',
      type: 'openai',
      base_url: 'https://api.openai.com',
    })
    providerId = prov.id
  })

  it('listAgents — returns empty array initially', async () => {
    const result = await listAgents(pool)
    expect(result).toEqual([])
  })

  it('insertAgent — inserts and returns agent with id', async () => {
    const agent = await insertAgent(pool, {
      name: 'test-agent',
      type: 'hermes',
      provider_id: providerId,
      runtime_family: 'hermes',
      execution_mode: 'external',
      endpoint: 'http://hermes.example.com',
      capabilities: ['coordination', 'exec'],
      host: 'agent.example.com',
      container_name: 'my-container',
      ssh_user: 'ubuntu',
      config: { timeout: 30 },
      enabled: true,
    })
    expect(agent.id).toBeTruthy()
    expect(agent.name).toBe('test-agent')
    expect(agent.type).toBe('hermes')
    expect(agent.provider_id).toBe(providerId)
    expect(agent.runtime_family).toBe('hermes')
    expect(agent.execution_mode).toBe('external')
    expect(agent.endpoint).toBe('http://hermes.example.com')
    expect(agent.capabilities).toEqual(['coordination', 'exec'])
    expect(agent.host).toBe('agent.example.com')
    expect(agent.container_name).toBe('my-container')
    expect(agent.ssh_user).toBe('ubuntu')
    expect(agent.config).toEqual({ timeout: 30 })
    expect(agent.enabled).toBe(true)
    expect(agent.created_at).toBeTruthy()
  })

  it('insertAgent — works with minimal fields', async () => {
    const agent = await insertAgent(pool, {
      name: 'minimal-agent',
      type: 'custom',
      runtime_family: 'custom',
      execution_mode: 'external',
      capabilities: [],
      config: {},
      enabled: true,
    })
    expect(agent.id).toBeTruthy()
    expect(agent.provider_id).toBeNull()
    expect(agent.runtime_family).toBe('custom')
    expect(agent.execution_mode).toBe('external')
    expect(agent.capabilities).toEqual([])
    expect(agent.host).toBeNull()
    expect(agent.container_name).toBeNull()
    expect(agent.ssh_user).toBeNull()
  })

  it('listAgents — returns inserted agents', async () => {
    const result = await listAgents(pool)
    expect(result.length).toBeGreaterThanOrEqual(2)
    const names = result.map((a) => a.name)
    expect(names).toContain('test-agent')
    expect(names).toContain('minimal-agent')
  })

  it('getAgent — fetches by id', async () => {
    const agent = await insertAgent(pool, {
      name: 'get-me-agent',
      type: 'langgraph',
      runtime_family: 'langgraph',
      execution_mode: 'external',
      capabilities: ['workflow'],
      config: { key: 'value' },
      enabled: false,
    })
    const fetched = await getAgent(pool, agent.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(agent.id)
    expect(fetched!.name).toBe('get-me-agent')
    expect(fetched!.enabled).toBe(false)
    expect(fetched!.config).toEqual({ key: 'value' })
  })

  it('getAgent — returns null for unknown id', async () => {
    const result = await getAgent(pool, '00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('updateAgent — updates fields', async () => {
    const agent = await insertAgent(pool, {
      name: 'update-me-agent',
      type: 'hermes',
      runtime_family: 'hermes',
      execution_mode: 'external',
      capabilities: [],
      config: { original: true },
      enabled: true,
    })
    const updated = await updateAgent(pool, agent.id, {
      runtime_family: 'openclaw',
      execution_mode: 'portal-managed',
      endpoint: 'http://openclaw.example.com',
      host: 'new-host.example.com',
      enabled: false,
      capabilities: ['research', 'audit'],
      config: { updated: true },
    })
    expect(updated.id).toBe(agent.id)
    expect(updated.runtime_family).toBe('openclaw')
    expect(updated.execution_mode).toBe('portal-managed')
    expect(updated.endpoint).toBe('http://openclaw.example.com')
    expect(updated.host).toBe('new-host.example.com')
    expect(updated.enabled).toBe(false)
    expect(updated.capabilities).toEqual(['research', 'audit'])
    expect(updated.config).toEqual({ updated: true })
    expect(updated.name).toBe('update-me-agent')
  })

  it('deleteAgent — removes row', async () => {
    const agent = await insertAgent(pool, {
      name: 'delete-me-agent',
      type: 'custom',
      runtime_family: 'custom',
      execution_mode: 'external',
      capabilities: [],
      config: {},
      enabled: true,
    })
    await deleteAgent(pool, agent.id)
    const fetched = await getAgent(pool, agent.id)
    expect(fetched).toBeNull()
  })
})
