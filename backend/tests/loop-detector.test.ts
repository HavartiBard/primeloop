import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { detectLoopWarnings } from '../src/loop-detector.js'

describe('loop detector', () => {
  it('detects repeated failures and prompt loops', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'del-1',
            from_agent_id: 'agent-1',
            to_agent_id: 'agent-2',
            capability: 'implementation',
            status: 'failed',
            request: { content: 'Fix the provider model bug' },
            result: {},
            updated_at: '2026-05-08T00:00:00.000Z',
          },
          {
            id: 'del-2',
            from_agent_id: 'agent-1',
            to_agent_id: 'agent-2',
            capability: 'implementation',
            status: 'failed',
            request: { content: 'Fix the provider model bug' },
            result: {},
            updated_at: '2026-05-07T23:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
    const pool = { query } as unknown as pg.Pool

    const warnings = await detectLoopWarnings(pool, 'agent-1', { limit: 10 })
    expect(warnings.some((warning) => warning.kind === 'repeated-failure')).toBe(true)
    expect(warnings.some((warning) => warning.kind === 'prompt-loop')).toBe(true)
  })

  it('detects stall retries and approval churn', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'del-3',
            from_agent_id: 'agent-1',
            to_agent_id: 'agent-2',
            capability: 'verification',
            status: 'failed',
            request: { content: 'Review this patch' },
            result: {},
            updated_at: '2026-05-08T00:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            approval_id: 'app-1',
            run_id: 'del-3',
            action: 'Review this patch',
            status: 'denied',
            created_at: '2026-05-08T00:01:00.000Z',
          },
          {
            approval_id: 'app-2',
            run_id: 'del-3',
            action: 'Review this patch',
            status: 'pending',
            created_at: '2026-05-08T00:00:30.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'evt-1',
            event_type: 'delegation.failed',
            delegation_id: 'del-3',
            payload: {},
            created_at: '2026-05-08T00:00:20.000Z',
          },
          {
            id: 'evt-2',
            event_type: 'adapter.task.failed',
            delegation_id: 'del-3',
            payload: {},
            created_at: '2026-05-08T00:00:10.000Z',
          },
        ],
      })
    const pool = { query } as unknown as pg.Pool

    const warnings = await detectLoopWarnings(pool, 'agent-1', { limit: 10 })
    expect(warnings.some((warning) => warning.kind === 'stall-retry')).toBe(true)
    expect(warnings.some((warning) => warning.kind === 'approval-churn')).toBe(true)
  })
})
