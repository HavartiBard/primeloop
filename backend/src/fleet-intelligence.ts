import type pg from 'pg'

export interface AgentPattern {
  id: string
  type: 'best_practice' | 'antipattern'
  content: string
  severity: string
  source_agent_id?: string
  source_agent_name?: string
  published_by?: string
  published_by_name?: string
  created_at: string
}

export interface FleetLearning {
  id: string
  kind: 'memory' | 'lesson'
  agent_id: string
  agent_name: string
  content: string
  category?: string
  tags?: string[]
  importance?: number
  severity?: string
  context?: string
  created_at: string
}

export interface FleetLoopWarning {
  agent_id: string
  agent_name: string
  kind: 'repeated-failure' | 'prompt-loop' | 'stall-retry' | 'approval-churn'
  severity: 'info' | 'warn' | 'error'
  summary: string
  evidence: Record<string, unknown>
  created_at: string
}

export interface FleetSnapshot {
  id: string
  agent_id: string
  agent_name: string
  title: string
  summary?: string
  payload: Record<string, unknown>
  created_at: string
}

export async function listPatterns(pool: pg.Pool, agentId?: string): Promise<AgentPattern[]> {
  const values: unknown[] = []
  const joins = [
    'LEFT JOIN agents source ON source.id = p.source_agent_id',
    'LEFT JOIN agents publisher ON publisher.id = p.published_by',
  ]
  let where = ''

  if (agentId) {
    values.push(agentId)
    joins.push('JOIN agent_pattern_assignments apa ON apa.pattern_id = p.id')
    where = `WHERE apa.agent_id = $${values.length}`
  }

  const { rows } = await pool.query<AgentPattern>(
    `SELECT
       p.id,
       p.type,
       p.content,
       p.severity,
       p.source_agent_id,
       source.name AS source_agent_name,
       p.published_by,
       publisher.name AS published_by_name,
       p.created_at::text
     FROM agent_patterns p
     ${joins.join('\n')}
     ${where}
     ORDER BY p.created_at DESC
     LIMIT 200`,
    values,
  )
  return rows
}

export async function listFleetLearnings(
  pool: pg.Pool,
  input: { agentId?: string; query?: string; limit?: number } = {},
): Promise<FleetLearning[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500))
  const query = input.query?.trim() ? `%${input.query.trim()}%` : '%'
  const values: unknown[] = [query]
  const agentFilter = input.agentId ? `AND item.agent_id = $2` : ''
  if (input.agentId) values.push(input.agentId)
  values.push(limit)
  const limitIndex = values.length

  const { rows } = await pool.query<FleetLearning>(
    `SELECT *
     FROM (
       SELECT
         m.id,
         'memory'::text AS kind,
         m.agent_id,
         a.name AS agent_name,
         m.content,
         m.category,
         m.tags,
         m.importance,
         NULL::text AS severity,
         NULL::text AS context,
         m.created_at::text
       FROM agent_memories m
       JOIN agents a ON a.id = m.agent_id
       WHERE ($1 = '%' OR m.content ILIKE $1 OR COALESCE(m.category, '') ILIKE $1)

       UNION ALL

       SELECT
         l.id,
         'lesson'::text AS kind,
         l.agent_id,
         a.name AS agent_name,
         l.content,
         l.category,
         NULL::text[] AS tags,
         NULL::int AS importance,
         l.severity,
         l.context,
         l.created_at::text
       FROM agent_lessons l
       JOIN agents a ON a.id = l.agent_id
       WHERE ($1 = '%' OR l.content ILIKE $1 OR COALESCE(l.category, '') ILIKE $1 OR COALESCE(l.context, '') ILIKE $1)
     ) item
     WHERE 1 = 1
     ${agentFilter}
     ORDER BY item.created_at DESC
     LIMIT $${limitIndex}`,
    values,
  )
  return rows
}

export async function listFleetLoopWarnings(
  pool: pg.Pool,
  input: { agentId?: string; limit?: number } = {},
): Promise<FleetLoopWarning[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200))
  const values: unknown[] = [limit]
  const where = input.agentId ? 'WHERE warnings.agent_id = $2' : ''
  if (input.agentId) values.push(input.agentId)

  const { rows } = await pool.query<FleetLoopWarning>(
    `SELECT
       warnings.agent_id,
       a.name AS agent_name,
       warnings.kind,
       warnings.severity,
       warnings.summary,
       warnings.evidence,
       warnings.created_at::text
     FROM agent_loop_warnings warnings
     JOIN agents a ON a.id = warnings.agent_id
     ${where}
     ORDER BY warnings.created_at DESC
     LIMIT $1`,
    values,
  )
  return rows
}

export async function listFleetSnapshots(
  pool: pg.Pool,
  input: { agentId?: string; limit?: number } = {},
): Promise<FleetSnapshot[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200))
  const values: unknown[] = [limit]
  const where = input.agentId ? 'WHERE s.agent_id = $2' : ''
  if (input.agentId) values.push(input.agentId)

  const { rows } = await pool.query<FleetSnapshot>(
    `SELECT
       s.id,
       s.agent_id,
       a.name AS agent_name,
       s.title,
       s.summary,
       s.payload,
       s.created_at::text
     FROM agent_snapshots s
     JOIN agents a ON a.id = s.agent_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT $1`,
    values,
  )
  return rows
}
