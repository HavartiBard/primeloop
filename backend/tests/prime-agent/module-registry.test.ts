import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import {
  listConfiguredPrimeModules,
  listPrimeModules,
  runPrimeModules,
  runShadowPrimeModules,
} from '../../src/prime-agent/modules/registry.js'
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
        executionMode: 'active',
        moduleConfig: {},
      }, [failingModule])
    ).rejects.toThrow('boom')

    expect(state.moduleRuns).toEqual([
      expect.objectContaining({
        id: 'context.fail',
        stage: 'context',
        version: '1.0.0',
        mode: 'active',
        status: 'failed',
        detail: 'boom',
      }),
    ])
  })

  it('loads only active module configs from persisted registry rows', async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({
          rows: listPrimeModules().map((module) => ({
            module_id: module.id,
            stage: module.stage,
            default_version: module.version,
            pinned_version: module.id === 'feedback.approval-continuation' ? undefined : null,
            enabled: module.id !== 'feedback.approval-continuation',
            rollout_mode: 'active',
            config: {},
            created_at: '2026-05-18T00:00:00.000Z',
            updated_at: '2026-05-18T00:00:00.000Z',
          })),
        }),
    } as unknown as pg.Pool

    const modules = await listConfiguredPrimeModules(pool)

    expect(modules.map((entry) => entry.module.id)).not.toContain('feedback.approval-continuation')
    expect(modules.map((entry) => entry.module.id)).toContain('context.fleet-state')
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
        executionMode: 'active',
        moduleConfig: {},
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
      executionMode: 'active',
      moduleConfig: {},
    }, modules)

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO checkpoint_continuations'),
      expect.arrayContaining(['session-3'])
    )
  })

  it('records shadow module runs without mutating the active action results', async () => {
    const decisionModule = listPrimeModules().find((module) => module.id === 'decision.llm-router')
    const actionModule = listPrimeModules().find((module) => module.id === 'action.dispatch')
    const state: PrimeLoopState = {
      event: {
        type: 'cron.fast',
        payload: {
          triggered_at: '2026-05-18T00:00:00.000Z',
        },
      },
      session: {
        id: 'session-4',
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
      actions: [],
      diagnostics: [],
      moduleRuns: [],
      budget: {
        llmCalls: 0,
        actionsDispatched: 0,
      },
    }

    await runShadowPrimeModules(
      state,
      {
        pool: {} as pg.Pool,
        router: {
          decide: vi.fn().mockResolvedValue({
            reasoning: 'shadow analysis',
            actions: [{ type: 'no_op', payload: {}, reason: 'observe only' }],
          }),
        },
        sessionId: 'session-4',
        executionMode: 'shadow',
        moduleConfig: {},
      },
      [decisionModule!, actionModule!]
    )

    expect(state.actions).toEqual([])
    expect(state.moduleRuns).toEqual([
      expect.objectContaining({
        id: 'decision.llm-router',
        mode: 'shadow',
        status: 'completed',
      }),
      expect.objectContaining({
        id: 'action.dispatch',
        mode: 'shadow',
        status: 'completed',
        detail: '1 actions observed in shadow mode',
      }),
    ])
  })

  it('isolates shadow-state mutations from the active loop state', async () => {
    const mutatingShadowModule = {
      id: 'observer.shadow-mutation',
      stage: 'observer' as const,
      version: '1.0.0',
      order: 999,
      run: vi.fn(async (shadowState: PrimeLoopState) => {
        shadowState.context!.recentLessons.push({
          id: 'lesson-shadow',
          agent_id: 'agent-shadow',
          content: 'mutated in shadow',
          created_at: '2026-05-18T00:00:00.000Z',
        })
        shadowState.actions.push({
          action: {
            type: 'no_op',
            payload: {},
            reason: 'shadow only',
          },
          status: 'dispatched',
        })
        return { detail: 'mutated cloned shadow state only' }
      }),
    }

    const state: PrimeLoopState = {
      event: {
        type: 'cron.fast',
        payload: {
          triggered_at: '2026-05-18T00:00:00.000Z',
        },
      },
      session: {
        id: 'session-5',
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
      actions: [],
      diagnostics: [],
      moduleRuns: [],
      budget: {
        llmCalls: 0,
        actionsDispatched: 0,
      },
    }

    await runShadowPrimeModules(
      state,
      {
        pool: {} as pg.Pool,
        router: { decide: vi.fn() },
        sessionId: 'session-5',
        executionMode: 'shadow',
        moduleConfig: {},
      },
      [mutatingShadowModule]
    )

    expect(state.context?.recentLessons).toEqual([])
    expect(state.actions).toEqual([])
    expect(state.moduleRuns).toEqual([
      expect.objectContaining({
        id: 'observer.shadow-mutation',
        mode: 'shadow',
        status: 'completed',
      }),
    ])
  })
})
