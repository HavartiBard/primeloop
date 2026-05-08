import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { DeterministicEmbeddingProvider } from '../src/embeddings.js'
import {
  assembleContext,
  checkLessons,
  createSnapshot,
  listMemoryTimeline,
  listSnapshots,
  searchMemories,
  storeLesson,
  storeMemory,
} from '../src/memory-service.js'

describe('memory service', () => {
  it('stores memories and lessons with normalized values', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'mem-1',
          agent_id: 'agent-1',
          content: 'Remember the provider model format.',
          category: 'providers',
          tags: ['models'],
          importance: 5,
          created_at: new Date().toISOString(),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'les-1',
          agent_id: 'agent-1',
          content: 'Do not assume SSE is ready immediately after health.',
          context: 'runtime startup',
          category: 'runtime',
          severity: 'info',
          created_at: new Date().toISOString(),
        }],
      })
    const pool = { query } as unknown as pg.Pool

    const memory = await storeMemory(pool, 'agent-1', {
      content: 'Remember the provider model format.',
      category: 'providers',
      tags: ['models'],
      importance: 8,
    })
    const lesson = await storeLesson(pool, 'agent-1', {
      content: 'Do not assume SSE is ready immediately after health.',
      context: 'runtime startup',
      category: 'runtime',
      severity: 'bogus',
    })

    expect(memory.importance).toBe(5)
    expect(lesson.severity).toBe('info')
  })

  it('uses pgvector search when an embedding provider is supplied', async () => {
    const provider = new DeterministicEmbeddingProvider()
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'mem-1',
          agent_id: 'agent-1',
          content: 'Provider model names use slash format.',
          category: 'providers',
          tags: ['models'],
          importance: 4,
          created_at: '2026-05-08T00:00:00.000Z',
        }],
      })
    const pool = { query } as unknown as pg.Pool

    const results = await searchMemories(pool, 'agent-1', 'provider models', {
      limit: 2,
      embeddingProvider: provider,
    })

    expect(results).toHaveLength(1)
    expect(query).toHaveBeenCalledWith(expect.stringContaining('embedding <=> $3::vector'), expect.any(Array))
  })

  it('searches memories lexically and prefers stronger matches', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'mem-1',
            agent_id: 'agent-1',
            content: 'Provider model names use slash format.',
            category: 'providers',
            tags: ['models'],
            importance: 4,
            created_at: '2026-05-08T00:00:00.000Z',
          },
          {
            id: 'mem-2',
            agent_id: 'agent-1',
            content: 'Worktree paths live under workspace agents.',
            category: 'runtime',
            tags: ['worktree'],
            importance: 5,
            created_at: '2026-05-07T00:00:00.000Z',
          },
        ],
      }),
    } as unknown as pg.Pool

    const results = await searchMemories(pool, 'agent-1', 'provider models', { limit: 2 })
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe('mem-1')
  })

  it('lists memory timeline in reverse chronological order from SQL', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          { id: 'mem-2', agent_id: 'agent-1', content: 'new', category: 'x', tags: [], importance: 2, created_at: '2026-05-08T00:00:00.000Z' },
          { id: 'mem-1', agent_id: 'agent-1', content: 'old', category: 'x', tags: [], importance: 1, created_at: '2026-05-07T00:00:00.000Z' },
        ],
      }),
    } as unknown as pg.Pool

    const timeline = await listMemoryTimeline(pool, 'agent-1', { limit: 10 })
    expect(timeline.map((item) => item.id)).toEqual(['mem-2', 'mem-1'])
  })

  it('checks lessons lexically and prefers stronger severity ties', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'les-1',
            agent_id: 'agent-1',
            content: 'SSE readiness can lag health checks.',
            context: 'startup',
            category: 'runtime',
            severity: 'warn',
            created_at: '2026-05-08T00:00:00.000Z',
          },
          {
            id: 'les-2',
            agent_id: 'agent-1',
            content: 'Model routing should verify provider defaults.',
            context: 'providers',
            category: 'providers',
            severity: 'critical',
            created_at: '2026-05-07T00:00:00.000Z',
          },
        ],
      }),
    } as unknown as pg.Pool

    const results = await checkLessons(pool, 'agent-1', 'sse startup', { limit: 5 })
    expect(results).toHaveLength(1)
    expect(results[0]?.id).toBe('les-1')
  })

  it('assembles soul, patterns, memories, and lessons into context text', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'agent-1',
          name: 'Prime',
          type: 'worker',
          runtime_family: 'opencode',
          execution_mode: 'local',
          config: {},
          capabilities: ['prime'],
          enabled: true,
          created_at: new Date(0).toISOString(),
          soul: 'Keep the fleet coherent.',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'pat-1',
          type: 'best_practice',
          content: 'Write focused tests before risky edits.',
          severity: 'info',
          source_agent_id: 'agent-1',
          source_agent_name: 'Prime',
          published_by: 'agent-1',
          published_by_name: 'Prime',
          created_at: new Date().toISOString(),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'mem-1',
          agent_id: 'agent-1',
          content: 'Provider model names use slash format.',
          category: 'providers',
          tags: ['models'],
          importance: 4,
          created_at: new Date().toISOString(),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'les-1',
          agent_id: 'agent-1',
          content: 'SSE readiness can lag health checks.',
          context: 'startup',
          category: 'runtime',
          severity: 'warn',
          created_at: new Date().toISOString(),
        }],
      })
    const pool = { query } as unknown as pg.Pool

    const context = await assembleContext(pool, 'agent-1', { query: 'provider sse' })
    expect(context.soul).toContain('Keep the fleet coherent')
    expect(context.patterns).toHaveLength(1)
    expect(context.memories).toHaveLength(1)
    expect(context.lessons).toHaveLength(1)
    expect(context.text).toContain('# Soul')
    expect(context.text).toContain('# Assigned Patterns')
    expect(context.text).toContain('# Relevant Memories')
    expect(context.text).toContain('# Relevant Lessons')
  })

  it('creates and lists snapshots for an agent', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [{
          id: 'snap-1',
          agent_id: 'agent-1',
          title: 'Before risky refactor',
          summary: 'Provider and SSE context',
          payload: { text: 'snapshot body' },
          created_at: new Date().toISOString(),
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'snap-1',
          agent_id: 'agent-1',
          title: 'Before risky refactor',
          summary: 'Provider and SSE context',
          payload: { text: 'snapshot body' },
          created_at: new Date().toISOString(),
        }],
      })
    const pool = { query } as unknown as pg.Pool

    const snapshot = await createSnapshot(pool, 'agent-1', {
      title: 'Before risky refactor',
      summary: 'Provider and SSE context',
      payload: { text: 'snapshot body' },
    })
    const snapshots = await listSnapshots(pool, 'agent-1', 10)

    expect(snapshot.id).toBe('snap-1')
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.title).toBe('Before risky refactor')
  })
})
