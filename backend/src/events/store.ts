import type pg from 'pg'
import type { AgentEvent } from './types.js'

interface InsertInput {
  agent: string
  type: string
  payload: Record<string, unknown>
}

interface ListOptions {
  agent?: string
  type?: string
  limit?: number
  before?: string
}

export async function insertEvent(pool: pg.Pool, input: InsertInput): Promise<AgentEvent> {
  const res = await pool.query<AgentEvent>(
    `INSERT INTO event_log (agent, type, payload)
     VALUES ($1, $2, $3)
     RETURNING id, agent, type, payload, created_at::text AS created_at`,
    [input.agent, input.type, JSON.stringify(input.payload)]
  )
  return res.rows[0]
}

export async function listEvents(pool: pg.Pool, opts: ListOptions): Promise<AgentEvent[]> {
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts.agent) {
    params.push(opts.agent)
    conditions.push(`agent = $${params.length}`)
  }
  if (opts.type) {
    params.push(opts.type)
    conditions.push(`type = $${params.length}`)
  }
  if (opts.before) {
    params.push(opts.before)
    conditions.push(`created_at < $${params.length}::timestamptz`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(opts.limit ?? 50)
  const limitClause = `LIMIT $${params.length}`

  const res = await pool.query<AgentEvent>(
    `SELECT id, agent, type, payload, created_at::text AS created_at
     FROM event_log ${where} ORDER BY created_at DESC ${limitClause}`,
    params
  )
  return res.rows
}
