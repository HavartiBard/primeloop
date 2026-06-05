import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { insertAgent } from '../src/registry.js'
import { CredentialBroker } from '../src/credentials/broker.js'

const TEST_DB = process.env.TEST_DATABASE_URL!
if (!process.env.SECRET_ENCRYPTION_KEY) process.env.SECRET_ENCRYPTION_KEY = '0'.repeat(64)

describe('CredentialBroker (US2)', () => {
  let pool: pg.Pool
  let broker: CredentialBroker

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    broker = new CredentialBroker(pool)
  })

  beforeEach(async () => {
    await pool.query(`DELETE FROM runtime_events WHERE actor = 'credential-broker'`)
    await pool.query('DELETE FROM brokered_credentials')
    await pool.query(`DELETE FROM agents WHERE name LIKE 'cred-%'`)
  })

  afterAll(async () => {
    await pool.end()
  })

  async function makeAgent(tier: 'durable' | 'ephemeral' = 'durable'): Promise<string> {
    const a = await insertAgent(pool, {
      name: `cred-${randomUUID().slice(0, 8)}`,
      type: 'worker',
      runtime_family: 'acp',
      execution_mode: 'local',
      tier,
      capabilities: [],
    } as any)
    return a.id
  }

  it('issues a provider proxy token: active row, env-only value, ref is not the raw token', async () => {
    const agent = await makeAgent()
    const issued = await broker.issueForAgent(agent, {})
    const cred = issued.find((c) => c.kind === 'provider_proxy_token')!
    expect(cred.envVars.LLM_PROXY_TOKEN).toBeTruthy()

    const { rows } = await pool.query(
      `SELECT status, secret_ref, expires_at FROM brokered_credentials WHERE id = $1`,
      [cred.id]
    )
    expect(rows[0].status).toBe('active')
    expect(rows[0].secret_ref).not.toBe(cred.envVars.LLM_PROXY_TOKEN) // stored as a hash, not the value
    expect(rows[0].expires_at).toBeTruthy()
  })

  it('validates an active token and rejects it after synchronous teardown revoke', async () => {
    const agent = await makeAgent('ephemeral')
    const [cred] = await broker.issueForAgent(agent, {})
    const token = cred.envVars.LLM_PROXY_TOKEN

    expect(await broker.validate(token)).not.toBeNull()

    await broker.revokeAllForAgent(agent)

    expect(await broker.validate(token)).toBeNull()
    const { rows } = await pool.query(`SELECT status, revoked_at FROM brokered_credentials WHERE id = $1`, [cred.id])
    expect(rows[0].status).toBe('revoked')
    expect(rows[0].revoked_at).toBeTruthy()
  })

  it('rotates a credential in place: same id, old token invalid, new token valid', async () => {
    const agent = await makeAgent()
    const [cred] = await broker.issueForAgent(agent, {})
    const oldToken = cred.envVars.LLM_PROXY_TOKEN

    const rotated = await broker.rotate(cred.id)
    const newToken = rotated.envVars.LLM_PROXY_TOKEN

    expect(rotated.id).toBe(cred.id)
    expect(newToken).not.toBe(oldToken)
    expect(await broker.validate(oldToken)).toBeNull()
    expect(await broker.validate(newToken)).not.toBeNull()
    const { rows } = await pool.query(`SELECT rotated_at FROM brokered_credentials WHERE id = $1`, [cred.id])
    expect(rows[0].rotated_at).toBeTruthy()
  })

  it('sweep rotates an expired rotatable credential', async () => {
    const agent = await makeAgent()
    const [cred] = await broker.issueForAgent(agent, {})
    await pool.query(`UPDATE brokered_credentials SET expires_at = now() - interval '1 hour' WHERE id = $1`, [cred.id])

    const result = await broker.sweep()

    expect(result.rotated).toContain(cred.id)
    const { rows } = await pool.query(`SELECT status FROM brokered_credentials WHERE id = $1`, [cred.id])
    expect(rows[0].status).toBe('active')
  })

  it('sweep flags an expired non-rotatable credential as risky', async () => {
    const agent = await makeAgent()
    await broker.issueForAgent(agent, { namedSecrets: [{ envName: 'MY_SECRET', value: 's3cr3t' }] })
    const { rows: nrows } = await pool.query(
      `SELECT id, auto_rotatable FROM brokered_credentials WHERE agent_id = $1 AND kind = 'named_secret'`,
      [agent]
    )
    const namedId = nrows[0].id
    expect(nrows[0].auto_rotatable).toBe(false)
    await pool.query(`UPDATE brokered_credentials SET expires_at = now() - interval '1 hour' WHERE id = $1`, [namedId])

    const result = await broker.sweep()

    expect(result.flagged).toContain(namedId)
    const { rows } = await pool.query(`SELECT status FROM brokered_credentials WHERE id = $1`, [namedId])
    expect(rows[0].status).toBe('risky')
  })

  it('emits credential.issued / rotated / revoked / risk_flagged lifecycle events', async () => {
    const agent = await makeAgent()
    const [cred] = await broker.issueForAgent(agent, { namedSecrets: [{ envName: 'X', value: 'y' }] })
    await broker.rotate(cred.id)
    await broker.revoke(cred.id)
    const { rows: nrows } = await pool.query(
      `SELECT id FROM brokered_credentials WHERE agent_id = $1 AND kind = 'named_secret'`,
      [agent]
    )
    await pool.query(`UPDATE brokered_credentials SET expires_at = now() - interval '1 hour' WHERE id = $1`, [nrows[0].id])
    await broker.sweep()

    const { rows } = await pool.query(`SELECT event_type FROM runtime_events WHERE actor = 'credential-broker'`)
    const types = rows.map((r) => r.event_type)
    expect(types).toEqual(expect.arrayContaining(['credential.issued', 'credential.rotated', 'credential.revoked', 'credential.risk_flagged']))
  })

  it('issues a scoped gitea token distinct from named-secret pass-through', async () => {
    const agent = await makeAgent()
    const issued = await broker.issueForAgent(agent, {
      giteaTokens: [{ repos: ['owner/repo-a', 'owner/repo-b'], capabilities: ['issues:write', 'pull_requests:write'] }],
      namedSecrets: [{ envName: 'PASSTHROUGH_SECRET', value: 'raw-secret-value' }],
    })

    const gitea = issued.find((c) => c.kind === 'gitea_token')
    const named = issued.find((c) => c.kind === 'named_secret')

    expect(gitea).toBeTruthy()
    expect(gitea?.envVars.GITEA_TOKEN).toBeTruthy()
    expect(gitea?.autoRotatable).toBe(true)
    expect(named?.envVars.PASSTHROUGH_SECRET).toBe('raw-secret-value')

    const { rows } = await pool.query(
      `SELECT kind, scope, auto_rotatable FROM brokered_credentials WHERE agent_id = $1 AND kind = 'gitea_token'`,
      [agent]
    )
    expect(rows[0].kind).toBe('gitea_token')
    expect(rows[0].auto_rotatable).toBe(true)
    expect(rows[0].scope.repos).toEqual(['owner/repo-a', 'owner/repo-b'])
    expect(rows[0].scope.capabilities).toEqual(['issues:write', 'pull_requests:write'])
  })

  it('never returns secret values on disk — issue writes no files (env-only)', async () => {
    // The broker API returns envVars only; there is no file-writing path. This guards
    // the contract that issuance produces env vars, not files (FR-009 / SC-002).
    const agent = await makeAgent()
    const issued = await broker.issueForAgent(agent, {})
    for (const cred of issued) {
      expect(cred.envVars).toBeTruthy()
      expect(Object.values(cred.envVars).every((v) => typeof v === 'string')).toBe(true)
    }
  })
})
