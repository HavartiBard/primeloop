import type pg from 'pg'
import { getEmbeddingProvider, vectorLiteral, type EmbeddingDeps } from './embeddings.js'
import { getAgent } from './registry.js'
import { listPatterns, type AgentPattern } from './fleet-intelligence.js'

export interface AgentMemory {
  id: string
  agent_id: string
  content: string
  category?: string
  tags?: string[]
  importance: number
  created_at: string
}

export interface AgentLesson {
  id: string
  agent_id: string
  content: string
  context?: string
  category?: string
  severity: string
  created_at: string
}

export interface StoreMemoryInput {
  content: string
  category?: string
  tags?: string[]
  importance?: number
}

export interface StoreLessonInput {
  content: string
  context?: string
  category?: string
  severity?: string
}

export interface SearchMemoriesOptions {
  limit?: number
  category?: string
  embeddingProvider?: EmbeddingDeps['provider']
}

export interface CheckLessonsOptions {
  limit?: number
  category?: string
  embeddingProvider?: EmbeddingDeps['provider']
}

export interface TimelineOptions {
  limit?: number
}

export interface ContextAssemblyOptions {
  query?: string
  limitPatterns?: number
  limitMemories?: number
  limitLessons?: number
  maxChars?: number
}

export interface AssembledContext {
  soul: string
  patterns: AgentPattern[]
  memories: AgentMemory[]
  lessons: AgentLesson[]
  text: string
}

export interface AgentSnapshot {
  id: string
  agent_id: string
  title: string
  summary?: string
  payload: Record<string, unknown>
  created_at: string
}

export interface CreateSnapshotInput {
  title: string
  summary?: string
  payload: Record<string, unknown>
}

function resolveEmbeddingProvider(explicit?: EmbeddingDeps['provider']) {
  return explicit === undefined ? getEmbeddingProvider() : explicit
}

function normalizeImportance(value?: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 3
  return Math.max(1, Math.min(5, Math.round(value)))
}

function normalizeSeverity(value?: string): string {
  const allowed = new Set(['info', 'warn', 'error', 'critical'])
  return value && allowed.has(value) ? value : 'info'
}

function severityWeight(value?: string): number {
  switch (value) {
    case 'critical': return 4
    case 'error': return 3
    case 'warn': return 2
    default: return 1
  }
}

function tokenize(query?: string): string[] {
  return (query ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((term) => term.trim())
    .filter(Boolean)
}

function lexicalScore(text: string, terms: string[]): number {
  if (terms.length === 0) return 0
  const haystack = text.toLowerCase()
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

function memorySearchText(memory: AgentMemory): string {
  return [memory.content, memory.category ?? '', ...(memory.tags ?? [])].join(' ')
}

function lessonSearchText(lesson: AgentLesson): string {
  return [lesson.content, lesson.context ?? '', lesson.category ?? '', lesson.severity].join(' ')
}

function trimContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

export async function storeMemory(
  pool: pg.Pool,
  agentId: string,
  input: StoreMemoryInput,
  deps: EmbeddingDeps = {},
): Promise<AgentMemory> {
  const provider = resolveEmbeddingProvider(deps.provider)
  const embedding = provider ? await provider.embed(input.content) : null
  const { rows } = await pool.query<AgentMemory>(
    `INSERT INTO agent_memories (agent_id, content, category, tags, importance, embedding)
     VALUES ($1, $2, $3, $4, $5, $6::vector)
     RETURNING id, agent_id, content, category, tags, importance, created_at::text`,
    [
      agentId,
      input.content,
      input.category ?? null,
      input.tags ?? null,
      normalizeImportance(input.importance),
      embedding ? vectorLiteral(embedding) : null,
    ],
  )
  return rows[0]
}

export async function storeLesson(
  pool: pg.Pool,
  agentId: string,
  input: StoreLessonInput,
  deps: EmbeddingDeps = {},
): Promise<AgentLesson> {
  const provider = resolveEmbeddingProvider(deps.provider)
  const embedding = provider ? await provider.embed([input.content, input.context ?? '', input.category ?? ''].join('\n')) : null
  const { rows } = await pool.query<AgentLesson>(
    `INSERT INTO agent_lessons (agent_id, content, context, category, severity, embedding)
     VALUES ($1, $2, $3, $4, $5, $6::vector)
     RETURNING id, agent_id, content, context, category, severity, created_at::text`,
    [
      agentId,
      input.content,
      input.context ?? null,
      input.category ?? null,
      normalizeSeverity(input.severity),
      embedding ? vectorLiteral(embedding) : null,
    ],
  )
  return rows[0]
}

export async function searchMemories(
  pool: pg.Pool,
  agentId: string,
  query: string,
  options: SearchMemoriesOptions = {},
): Promise<AgentMemory[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100))
  const provider = resolveEmbeddingProvider(options.embeddingProvider)
  const queryEmbedding = query.trim() && provider ? await provider.embed(query) : null
  if (queryEmbedding) {
    const { rows } = await pool.query<AgentMemory>(
      `SELECT id, agent_id, content, category, tags, importance, created_at::text
       FROM agent_memories
       WHERE agent_id = $1
         AND ($2::text IS NULL OR category = $2)
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $3::vector ASC, created_at DESC
       LIMIT $4`,
      [agentId, options.category ?? null, vectorLiteral(queryEmbedding), limit],
    )
    if (rows.length > 0) return rows
  }
  const { rows } = await pool.query<AgentMemory>(
    `SELECT id, agent_id, content, category, tags, importance, created_at::text
     FROM agent_memories
     WHERE agent_id = $1
       AND ($2::text IS NULL OR category = $2)
     ORDER BY created_at DESC
     LIMIT 200`,
    [agentId, options.category ?? null],
  )

  const terms = tokenize(query)
  return rows
    .map((row) => ({
      row,
      score: lexicalScore(memorySearchText(row), terms) * 10 + row.importance,
    }))
    .filter((item) => terms.length === 0 || item.score > item.row.importance)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return new Date(b.row.created_at).getTime() - new Date(a.row.created_at).getTime()
    })
    .slice(0, limit)
    .map((item) => item.row)
}

export async function listMemoryTimeline(
  pool: pg.Pool,
  agentId: string,
  options: TimelineOptions = {},
): Promise<AgentMemory[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 200))
  const { rows } = await pool.query<AgentMemory>(
    `SELECT id, agent_id, content, category, tags, importance, created_at::text
     FROM agent_memories
     WHERE agent_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [agentId, limit],
  )
  return rows
}

export async function listLessons(
  pool: pg.Pool,
  agentId: string,
  options: TimelineOptions = {},
): Promise<AgentLesson[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 200))
  const { rows } = await pool.query<AgentLesson>(
    `SELECT id, agent_id, content, context, category, severity, created_at::text
     FROM agent_lessons
     WHERE agent_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [agentId, limit],
  )
  return rows
}

export async function checkLessons(
  pool: pg.Pool,
  agentId: string,
  query: string,
  options: CheckLessonsOptions = {},
): Promise<AgentLesson[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100))
  const provider = resolveEmbeddingProvider(options.embeddingProvider)
  const queryEmbedding = query.trim() && provider ? await provider.embed(query) : null
  if (queryEmbedding) {
    const { rows } = await pool.query<AgentLesson>(
      `SELECT id, agent_id, content, context, category, severity, created_at::text
       FROM agent_lessons
       WHERE agent_id = $1
         AND ($2::text IS NULL OR category = $2)
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $3::vector ASC, created_at DESC
       LIMIT $4`,
      [agentId, options.category ?? null, vectorLiteral(queryEmbedding), limit],
    )
    if (rows.length > 0) return rows
  }
  const { rows } = await pool.query<AgentLesson>(
    `SELECT id, agent_id, content, context, category, severity, created_at::text
     FROM agent_lessons
     WHERE agent_id = $1
       AND ($2::text IS NULL OR category = $2)
     ORDER BY created_at DESC
     LIMIT 200`,
    [agentId, options.category ?? null],
  )

  const terms = tokenize(query)
  return rows
    .map((row) => ({
      row,
      score: lexicalScore(lessonSearchText(row), terms) * 10 + severityWeight(row.severity),
    }))
    .filter((item) => terms.length === 0 || item.score > severityWeight(item.row.severity))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return new Date(b.row.created_at).getTime() - new Date(a.row.created_at).getTime()
    })
    .slice(0, limit)
    .map((item) => item.row)
}

export async function assembleContext(
  pool: pg.Pool,
  agentId: string,
  options: ContextAssemblyOptions = {},
): Promise<AssembledContext> {
  const limitPatterns = Math.max(1, Math.min(options.limitPatterns ?? 5, 20))
  const limitMemories = Math.max(1, Math.min(options.limitMemories ?? 5, 20))
  const limitLessons = Math.max(1, Math.min(options.limitLessons ?? 5, 20))
  const maxChars = Math.max(200, options.maxChars ?? 4_000)

  const [agent, patterns, memories, lessons] = await Promise.all([
    getAgent(pool, agentId),
    listPatterns(pool, agentId),
    searchMemories(pool, agentId, options.query ?? '', { limit: limitMemories }),
    checkLessons(pool, agentId, options.query ?? '', { limit: limitLessons }),
  ])

  const soul = agent?.soul?.trim() ?? ''
  const selectedPatterns = patterns.slice(0, limitPatterns)
  const sections: string[] = []

  if (soul) {
    sections.push(`# Soul\n${soul}`)
  }
  if (selectedPatterns.length > 0) {
    sections.push([
      '# Assigned Patterns',
      ...selectedPatterns.map((pattern) =>
        `- ${pattern.type === 'antipattern' ? 'Avoid' : 'Practice'} (${pattern.severity}): ${pattern.content}`
      ),
    ].join('\n'))
  }
  if (memories.length > 0) {
    sections.push([
      '# Relevant Memories',
      ...memories.map((memory) =>
        `- [${memory.category ?? 'general'}] ${memory.content} (importance ${memory.importance})`
      ),
    ].join('\n'))
  }
  if (lessons.length > 0) {
    sections.push([
      '# Relevant Lessons',
      ...lessons.map((lesson) =>
        `- [${lesson.severity}] ${lesson.content}${lesson.context ? ` Context: ${lesson.context}` : ''}`
      ),
    ].join('\n'))
  }

  return {
    soul,
    patterns: selectedPatterns,
    memories,
    lessons,
    text: trimContext(sections.join('\n\n'), maxChars),
  }
}

export async function createSnapshot(
  pool: pg.Pool,
  agentId: string,
  input: CreateSnapshotInput,
): Promise<AgentSnapshot> {
  const { rows } = await pool.query<AgentSnapshot>(
    `INSERT INTO agent_snapshots (agent_id, title, summary, payload)
     VALUES ($1, $2, $3, $4)
     RETURNING id, agent_id, title, summary, payload, created_at::text`,
    [agentId, input.title, input.summary ?? null, JSON.stringify(input.payload)],
  )
  return rows[0]
}

export async function listSnapshots(
  pool: pg.Pool,
  agentId: string,
  limit = 20,
): Promise<AgentSnapshot[]> {
  const bounded = Math.max(1, Math.min(limit, 100))
  const { rows } = await pool.query<AgentSnapshot>(
    `SELECT id, agent_id, title, summary, payload, created_at::text
     FROM agent_snapshots
     WHERE agent_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [agentId, bounded],
  )
  return rows
}
