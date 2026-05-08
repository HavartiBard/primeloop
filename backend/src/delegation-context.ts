import type pg from 'pg'

interface PatternRow {
  type: string
  content: string
  severity?: string
  source_agent_name?: string
}

interface MemoryRow {
  content: string
  category?: string
  tags?: string[]
  importance?: number
}

interface LessonRow {
  content: string
  context?: string
  category?: string
  severity?: string
}

function formatPatterns(rows: PatternRow[]): string {
  if (rows.length === 0) return ''
  const lines = rows.map((row) => {
    const type = row.type === 'antipattern' ? 'Avoid' : 'Practice'
    const severity = row.severity ? ` (${row.severity})` : ''
    const source = row.source_agent_name ? ` [source: ${row.source_agent_name}]` : ''
    return `- ${type}${severity}: ${row.content}${source}`
  })
  return ['Assigned patterns:', ...lines].join('\n')
}

function formatMemories(rows: MemoryRow[]): string {
  if (rows.length === 0) return ''
  const lines = rows.map((row) => {
    const category = row.category ? `[${row.category}] ` : ''
    const importance = typeof row.importance === 'number' ? ` (importance ${row.importance})` : ''
    const tags = Array.isArray(row.tags) && row.tags.length > 0 ? ` tags: ${row.tags.join(', ')}` : ''
    return `- ${category}${row.content}${importance}${tags}`
  })
  return ['Recent high-importance memories:', ...lines].join('\n')
}

function formatLessons(rows: LessonRow[]): string {
  if (rows.length === 0) return ''
  const lines = rows.map((row) => {
    const severity = row.severity ? `[${row.severity}] ` : ''
    const category = row.category ? `(${row.category}) ` : ''
    const context = row.context ? ` Context: ${row.context}` : ''
    return `- ${severity}${category}${row.content}${context}`
  })
  return ['Recent lessons:', ...lines].join('\n')
}

export async function loadDelegationContext(pool: pg.Pool, agentId: string): Promise<string> {
  const [patternsRes, memoriesRes, lessonsRes] = await Promise.all([
    pool.query<PatternRow>(
      `SELECT p.type, p.content, p.severity, source.name AS source_agent_name
       FROM agent_pattern_assignments a
       JOIN agent_patterns p ON p.id = a.pattern_id
       LEFT JOIN agents source ON source.id = p.source_agent_id
       WHERE a.agent_id = $1
       ORDER BY p.created_at DESC
       LIMIT 5`,
      [agentId]
    ),
    pool.query<MemoryRow>(
      `SELECT content, category, tags, importance
       FROM agent_memories
       WHERE agent_id = $1
       ORDER BY importance DESC, created_at DESC
       LIMIT 5`,
      [agentId]
    ),
    pool.query<LessonRow>(
      `SELECT content, context, category, severity
       FROM agent_lessons
       WHERE agent_id = $1
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 4
           WHEN 'error' THEN 3
           WHEN 'warn' THEN 2
           ELSE 1
         END DESC,
         created_at DESC
       LIMIT 5`,
      [agentId]
    ),
  ])

  return [
    formatPatterns(patternsRes.rows),
    formatMemories(memoriesRes.rows),
    formatLessons(lessonsRes.rows),
  ].filter(Boolean).join('\n\n')
}

export function mergeDelegationContext(existingContext: unknown, injectedContext: string): string {
  const existing = typeof existingContext === 'string' ? existingContext.trim() : ''
  const injected = injectedContext.trim()
  if (!existing) return injected
  if (!injected) return existing
  return `${existing}\n\n${injected}`
}
