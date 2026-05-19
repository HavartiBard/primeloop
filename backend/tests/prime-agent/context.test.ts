import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { assemblePrimeContext } from '../../src/prime-agent/context.js'

describe('prime-agent context', () => {
  it('assembles deterministic context with enabled agents and relevant lessons', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT * FROM agents ORDER BY created_at')) {
        return {
          rows: [
            {
              id: 'agent-1',
              name: 'healthy-agent',
              type: 'codex',
              runtime_family: 'codex',
              execution_mode: 'local',
              config: {},
              capabilities: ['build'],
              enabled: true,
              created_at: '2026-05-09T21:00:00.000Z',
            },
            {
              id: 'agent-2',
              name: 'disabled-agent',
              type: 'codex',
              runtime_family: 'codex',
              execution_mode: 'local',
              config: {},
              capabilities: ['build'],
              enabled: false,
              created_at: '2026-05-09T20:00:00.000Z',
            },
          ],
        }
      }

      if (sql.includes('SELECT * FROM work_items ORDER BY updated_at DESC LIMIT')) {
        expect(params).toEqual([20])
        return {
          rows: [
            { id: 'work-1', title: 'Investigate queue stall', status: 'active', updated_at: '2026-05-09T22:00:00.000Z' },
          ],
        }
      }

      if (sql.includes('SELECT * FROM delegations ORDER BY updated_at DESC LIMIT')) {
        expect(params).toEqual([20])
        return {
          rows: [
            { id: 'del-1', capability: 'queue-debug', status: 'failed', updated_at: '2026-05-09T21:50:00.000Z' },
          ],
        }
      }

      if (sql.includes('SELECT * FROM runtime_events ORDER BY created_at DESC LIMIT')) {
        expect(params).toEqual([50])
        return {
          rows: [
            { id: 'evt-1', event_type: 'thread.message', actor: 'james', payload: {}, created_at: '2026-05-09T22:05:00.000Z' },
          ],
        }
      }

      if (sql.includes('FROM thread_messages')) {
        expect(params).toEqual(['thread-1', 15])
        return {
          rows: [
            {
              id: 'msg-1',
              thread_id: 'thread-1',
              role: 'user',
              sender: 'james',
              content: 'Investigate the queue stall and watchdog behavior',
              metadata: {},
              created_at: '2026-05-09T22:06:00.000Z',
            },
          ],
        }
      }

      if (sql.includes('FROM information_schema.tables')) {
        return { rows: [{ exists: true }] }
      }

      if (sql.includes('FROM agent_lessons')) {
        expect(params).toEqual([50])
        return {
          rows: [
            {
              id: 'lesson-1',
              agent_id: 'agent-1',
              content: 'Queue stalls need watchdog timeouts.',
              context: 'delegation failure handling',
              category: 'runtime',
              severity: 'warn',
              created_at: '2026-05-09T22:10:00.000Z',
            },
            {
              id: 'lesson-2',
              agent_id: 'agent-1',
              content: 'Provider routing should be explicit.',
              context: 'llm',
              category: 'providers',
              severity: 'info',
              created_at: '2026-05-09T22:00:00.000Z',
            },
          ],
        }
      }

      throw new Error(`Unexpected query: ${sql}`)
    })

    const pool = { query } as unknown as pg.Pool

    const context = await assemblePrimeContext(pool, {
      type: 'prime.message',
      payload: {
        thread_id: 'thread-1',
        message_id: 'message-1',
        content: 'Investigate the queue stall and watchdog behavior',
        sender: 'james',
      },
    })

    expect(context.fleet.agents).toHaveLength(1)
    expect(context.fleet.agents[0]?.id).toBe('agent-1')
    expect(context.fleet.workItems).toHaveLength(1)
    expect(context.fleet.delegations).toHaveLength(1)
    expect(context.recentEvents).toHaveLength(1)
    expect(context.recentLessons).toHaveLength(1)
    expect(context.recentLessons[0]?.id).toBe('lesson-1')
    expect(context.threadMessages).toHaveLength(1)
  })

  it('handles empty state gracefully when lessons table is unavailable', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT * FROM agents ORDER BY created_at')) return { rows: [] }
      if (sql.includes('SELECT * FROM work_items ORDER BY updated_at DESC LIMIT')) return { rows: [] }
      if (sql.includes('SELECT * FROM delegations ORDER BY updated_at DESC LIMIT')) return { rows: [] }
      if (sql.includes('SELECT * FROM runtime_events ORDER BY created_at DESC LIMIT')) return { rows: [] }
      if (sql.includes('FROM information_schema.tables')) return { rows: [{ exists: false }] }
      throw new Error(`Unexpected query: ${sql}`)
    })

    const pool = { query } as unknown as pg.Pool

    const context = await assemblePrimeContext(pool, {
      type: 'cron.fast',
      payload: {
        triggered_at: '2026-05-09T22:15:00.000Z',
      },
    })

    expect(context.fleet.agents).toEqual([])
    expect(context.fleet.workItems).toEqual([])
    expect(context.fleet.delegations).toEqual([])
    expect(context.recentEvents).toEqual([])
    expect(context.recentLessons).toEqual([])
  })
})
