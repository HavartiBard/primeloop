import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { insertAgent } from '../src/registry.js'
import { CredentialBroker } from '../src/credentials/broker.js'
import { provisionAgentCredentials, revokeAgentCredentials } from '../src/credentials/lifecycle.js'

const TEST_DB = process.env.TEST_DATABASE_URL!
if (!process.env.SECRET_ENCRYPTION_KEY) process.env.SECRET_ENCRYPTION_KEY = '0'.repeat(64)

describe('credential lifecycle (US2 wiring, flag-gated)', () => {
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
    await pool.query(`DELETE FROM agents WHERE name LIKE 'life-%'`)
  })

  afterAll(async () => {
    await pool.end()
  })

  async function makeAgent(): Promise<string> {
    const a = await insertAgent(pool, {
      name: `life-${randomUUID().slice(0, 8)}`,
      type: 'worker',
      runtime_family: 'acp',
      execution_mode: 'local',
      tier: 'ephemeral',
      capabilities: [],
    } as any)
    return a.id
  }

  async function activeCount(agentId: string): Promise<number> {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM brokered_credentials WHERE agent_id = $1 AND status = 'active'`,
      [agentId]
    )
    return rows[0].n
  }

  it('is a no-op when the flag is disabled', async () => {
    const agent = await makeAgent()
    const env = await provisionAgentCredentials(broker, agent, {}, false)
    expect(env).toEqual({})
    expect(await activeCount(agent)).toBe(0)
  })

  it('issues env-only credentials at provision when enabled', async () => {
    const agent = await makeAgent()
    const env = await provisionAgentCredentials(broker, agent, {}, true)
    expect(env.LLM_PROXY_TOKEN).toBeTruthy()
    expect(await activeCount(agent)).toBe(1)
  })

  it('re-provision revokes the prior set (no accumulation)', async () => {
    const agent = await makeAgent()
    await provisionAgentCredentials(broker, agent, {}, true)
    await provisionAgentCredentials(broker, agent, {}, true)
    expect(await activeCount(agent)).toBe(1)
  })

  it('revokes all credentials synchronously at teardown', async () => {
    const agent = await makeAgent()
    const env = await provisionAgentCredentials(broker, agent, {}, true)
    expect(await broker.validate(env.LLM_PROXY_TOKEN)).not.toBeNull()

    await revokeAgentCredentials(broker, agent, true)

    expect(await activeCount(agent)).toBe(0)
    expect(await broker.validate(env.LLM_PROXY_TOKEN)).toBeNull()
  })
})
