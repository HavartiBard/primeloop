import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { CredentialBroker } from '../src/credentials/broker.js'

if (!process.env.SECRET_ENCRYPTION_KEY) process.env.SECRET_ENCRYPTION_KEY = '0'.repeat(64)

describe('CredentialBroker gitea tokens (T058)', () => {
  it('issues a scoped gitea token distinct from named-secret pass-through', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('INSERT INTO brokered_credentials')) {
        const kind = params?.[1]
        if (kind === 'provider_proxy_token') return { rows: [{ id: 'cred-proxy', expires_at: new Date().toISOString() }] }
        if (kind === 'gitea_token') return { rows: [{ id: 'cred-gitea', expires_at: new Date().toISOString() }] }
        if (kind === 'named_secret') return { rows: [{ id: 'cred-secret', expires_at: new Date().toISOString() }] }
      }
      if (sql.includes('INSERT INTO runtime_events')) return { rows: [{ id: 'evt-1' }] }
      throw new Error(`unexpected query: ${sql}`)
    })

    const broker = new CredentialBroker({ query } as unknown as pg.Pool)
    const issued = await broker.issueForAgent('agent-1', {
      giteaTokens: [{ repos: ['owner/repo-a', 'owner/repo-b'], capabilities: ['issues:write', 'pull_requests:write'] }],
      namedSecrets: [{ envName: 'PASSTHROUGH_SECRET', value: 'raw-secret-value' }],
    })

    const gitea = issued.find((c) => c.kind === 'gitea_token')
    const named = issued.find((c) => c.kind === 'named_secret')

    expect(gitea).toBeTruthy()
    expect(gitea?.envVars.GITEA_TOKEN).toBeTruthy()
    expect(gitea?.autoRotatable).toBe(true)
    expect(named?.envVars.PASSTHROUGH_SECRET).toBe('raw-secret-value')

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO brokered_credentials'),
      [
        'agent-1',
        'gitea_token',
        JSON.stringify({ repos: ['owner/repo-a', 'owner/repo-b'], capabilities: ['issues:write', 'pull_requests:write'], envName: 'GITEA_TOKEN' }),
        expect.any(String),
        true,
        expect.any(String),
      ],
    )
  })
})
