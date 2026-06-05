import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { EgressAllowlist } from '../src/proxy/egress.js'

describe('EgressAllowlist', () => {
  it('derives defaults from provider capabilities and MCP assignments', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM agents a')) {
        return {
          rows: [{
            provider_base_url: 'https://api.openai.com/v1',
            mcp_urls: ['http://gitea:3000/mcp', 'https://github.example.com/api'],
          }],
        }
      }
      if (sql.startsWith('INSERT INTO egress_allowlist')) return { rows: [] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const allowlist = new EgressAllowlist({ query } as unknown as pg.Pool)

    const hosts = await allowlist.deriveDefaults('agent-1')

    expect(hosts).toEqual(['api.openai.com', 'gitea:3000', 'github.example.com'])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO egress_allowlist'), ['agent-1', 'api.openai.com', 'capability'])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO egress_allowlist'), ['agent-1', 'gitea:3000', 'mcp_assignment'])
  })

  it('returns allowed when host already exists', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT 1 FROM egress_allowlist')) return { rows: [{ 1: 1 }] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const allowlist = new EgressAllowlist({ query } as unknown as pg.Pool)

    await expect(allowlist.requestHost('agent-1', 'api.openai.com')).resolves.toBe('allowed')
  })

  it('creates a pending approval for unknown hosts', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT 1 FROM egress_allowlist')) return { rows: [] }
      if (sql.includes('information_schema.columns')) return { rows: [{ exists: true }] }
      if (sql.includes('INSERT INTO approvals')) return { rows: [{ approval_id: 'egress:agent-1:example.com' }] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const allowlist = new EgressAllowlist({ query } as unknown as pg.Pool)

    await expect(allowlist.requestHost('agent-1', 'example.com')).resolves.toBe('pending_approval')
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO approvals'), ['egress:agent-1:example.com', 'agent-1', 'Allow agent agent-1 network egress to example.com'])
  })
})
