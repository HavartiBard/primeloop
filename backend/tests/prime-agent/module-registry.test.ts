import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { listPrimeModules, runPrimeModules } from '../../src/prime-agent/modules/registry.js'
import type { PrimeLoopState } from '../../src/prime-agent/modules/types.js'

describe('prime-agent module registry', () => {
  it('orders static modules deterministically by order', () => {
    const modules = listPrimeModules()

    expect(modules.map((module) => module.id)).toEqual([
      'context.fleet-state',
      'decision.llm-router',
      'action.dispatch',
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
})
