import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { listPrimeModules, runPrimeModules } from '../../src/prime-agent/modules/registry.js'
import type { PrimeLoopState } from '../../src/prime-agent/modules/types.js'

describe('prime-agent module registry', () => {
  it('orders static modules deterministically by order', () => {
    const modules = listPrimeModules()

    expect(modules.map((module) => module.id)).toEqual([
      'trigger.event-ingress',
      'debounce.pass-through',
      'context.fleet-state',
      'decision.llm-router',
      'policy.scope-required',
      'action.dispatch',
      'feedback.approval-continuation',
    ])
  })

  it('records failed module runs before rethrowing', async () => {
    const state: PrimeLoopState = {
      event: {
        type: 'cron.fast',
        payload: {
          triggered_at: '2026-05-18T00:00:00.000Z',
        },
      },
      session: {
        id: 'session-1',
        trigger_type: 'cron_fast',
        trigger_payload: {},
        prompt_templates: {},
        actions_taken: [],
        token_count: 0,
        status: 'running',
        started_at: '2026-05-18T00:00:00.000Z',
      },
      actions: [],
      diagnostics: [],
      moduleRuns: [],
      budget: {
        llmCalls: 0,
        actionsDispatched: 0,
      },
    }

    const failingModule = {
      id: 'context.fail',
      stage: 'context' as const,
      version: '1.0.0',
      order: 1,
      run: vi.fn(async () => {
        throw new Error('boom')
      }),
    }

    await expect(
      runPrimeModules(state, {
        pool: {} as pg.Pool,
        router: { decide: vi.fn() },
        sessionId: 'session-1',
      }, [failingModule])
    ).rejects.toThrow('boom')

    expect(state.moduleRuns).toEqual([
      {
        id: 'context.fail',
        stage: 'context',
        version: '1.0.0',
        status: 'failed',
        detail: 'boom',
      },
    ])
  })

  it('blocks implementation delegates without allowed_files', async () => {
    const modules = listPrimeModules().filter((module) => module.stage === 'policy')
    const state: PrimeLoopState = {
      event: {
        type: 'cron.fast',
        payload: {
          triggered_at: '2026-05-18T00:00:00.000Z',
        },
      },
      session: {
        id: 'session-2',
        trigger_type: 'cron_fast',
        trigger_payload: {},
        prompt_templates: {},
        actions_taken: [],
        token_count: 0,
        status: 'running',
        started_at: '2026-05-18T00:00:00.000Z',
      },
      decision: {
        reasoning: 'delegate coding work',
        actions: [
          {
            type: 'delegate',
            payload: {
              capability: 'implementation',
            },
            reason: 'needs code changes',
          },
        ],
      },
      actions: [],
      diagnostics: [],
      moduleRuns: [],
      budget: {
        llmCalls: 0,
        actionsDispatched: 0,
      },
    }

    await expect(
      runPrimeModules(state, {
        pool: {} as pg.Pool,
        router: { decide: vi.fn() },
        sessionId: 'session-2',
      }, modules)
    ).rejects.toThrow('scope-required blocked delegate actions without allowed_files')
  })

  it('saves approval continuations during feedback', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    } as unknown as pg.Pool
    const modules = listPrimeModules().filter((module) => module.stage === 'feedback')
    const state: PrimeLoopState = {
      event: {
        type: 'cron.fast',
        payload: {
          triggered_at: '2026-05-18T00:00:00.000Z',
        },
      },
      session: {
        id: 'session-3',
        trigger_type: 'cron_fast',
        trigger_payload: {},
        prompt_templates: {},
        actions_taken: [],
        token_count: 0,
        status: 'running',
        started_at: '2026-05-18T00:00:00.000Z',
      },
      context: {
        trigger: {
          type: 'cron.fast',
          payload: {
            triggered_at: '2026-05-18T00:00:00.000Z',
          },
        },
        fleet: {
          agents: [],
          workItems: [],
          delegations: [],
        },
        recentEvents: [],
        recentLessons: [],
        threadMessages: [],
      },
      decision: {
        reasoning: 'needs approval',
        actions: [
          {
            type: 'request_approval',
            payload: {
              action: 'Deploy',
            },
            reason: 'approval required',
          },
        ],
      },
      actions: [
        {
          action: {
            type: 'request_approval',
            payload: {
              action: 'Deploy',
            },
            reason: 'approval required',
          },
          status: 'dispatched',
          approval: {
            approval_id: 'prime:work-1',
            run_id: 'work-1',
            action: 'Deploy',
            status: 'pending',
          },
        },
      ],
      diagnostics: [],
      moduleRuns: [],
      budget: {
        llmCalls: 0,
        actionsDispatched: 1,
      },
    }

    await runPrimeModules(state, {
      pool,
      router: { decide: vi.fn() },
      sessionId: 'session-3',
    }, modules)

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO checkpoint_continuations'),
      expect.arrayContaining(['session-3'])
    )
  })
})
