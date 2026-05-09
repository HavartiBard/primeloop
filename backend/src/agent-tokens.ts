import { randomBytes } from 'node:crypto'
import type pg from 'pg'

export interface AgentTokenRecord {
  agent_id: string
  token: string
  created_at?: string
}

export async function getAgentToken(pool: pg.Pool, agentId: string): Promise<string | null> {
  const { rows } = await pool.query<{ token: string }>(
    'SELECT token FROM agent_tokens WHERE agent_id = $1',
    [agentId],
  )
  return rows[0]?.token ?? null
}

export async function getOrCreateAgentToken(pool: pg.Pool, agentId: string): Promise<string> {
  const existing = await getAgentToken(pool, agentId)
  if (existing) return existing

  const token = randomBytes(24).toString('hex')
  const inserted = await pool.query<{ token: string }>(
    `INSERT INTO agent_tokens (agent_id, token)
     VALUES ($1, $2)
     ON CONFLICT (agent_id) DO UPDATE SET token = agent_tokens.token
     RETURNING token`,
    [agentId, token],
  )
  return inserted.rows[0]?.token ?? token
}

export async function rotateAgentToken(pool: pg.Pool, agentId: string): Promise<string> {
  const token = randomBytes(24).toString('hex')
  const { rows } = await pool.query<{ token: string }>(
    `INSERT INTO agent_tokens (agent_id, token)
     VALUES ($1, $2)
     ON CONFLICT (agent_id) DO UPDATE SET token = EXCLUDED.token
     RETURNING token`,
    [agentId, token],
  )
  return rows[0]?.token ?? token
}
