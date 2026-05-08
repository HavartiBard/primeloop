import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { loadDelegationContext, mergeDelegationContext } from '../src/delegation-context.js'

describe('delegation context', () => {
  it('formats assigned patterns, memories, and lessons into prompt context', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [
          {
            type: 'best_practice',
            content: 'Write focused tests before risky edits.',
            severity: 'info',
            source_agent_name: 'prime',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            content: 'This service expects provider model names in slash form.',
            category: 'integration',
            tags: ['providers', 'models'],
            importance: 5,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            content: 'Generic runtime health can pass before session SSE is ready.',
            context: 'Startup race',
            category: 'runtime',
            severity: 'warn',
          },
        ],
      })

    const pool = { query } as unknown as pg.Pool
    const context = await loadDelegationContext(pool, 'agent-1')

    expect(context).toContain('Assigned patterns:')
    expect(context).toContain('Write focused tests before risky edits.')
    expect(context).toContain('Recent high-importance memories:')
    expect(context).toContain('provider model names in slash form')
    expect(context).toContain('Recent lessons:')
    expect(context).toContain('Startup race')
  })

  it('merges existing request context with injected fleet context', () => {
    expect(mergeDelegationContext('User supplied context', 'Fleet context')).toBe(
      'User supplied context\n\nFleet context'
    )
    expect(mergeDelegationContext('', 'Fleet context')).toBe('Fleet context')
    expect(mergeDelegationContext('User supplied context', '')).toBe('User supplied context')
  })
})
