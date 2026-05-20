import { beforeEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'

const contextMocks = vi.hoisted(() => ({
  assemblePrimeContext: vi.fn(),
}))

const actionMocks = vi.hoisted(() => ({
  dispatchPrimeActions: vi.fn(),
}))

const sessionMocks = vi.hoisted(() => ({
  startPrimeSession: vi.fn(),
  completePrimeSession: vi.fn(),
  failPrimeSession: vi.fn(),
}))

const runtimeMocks = vi.hoisted(() => ({
  appendThreadMessage: vi.fn(),
  getPrimeProfile: vi.fn(),
}))

const workspaceMocks = vi.hoisted(() => ({
  loadPrimeWorkspaceTemplates: vi.fn(),
}))

const moduleRegistryMocks = vi.hoisted(() => ({
  listConfiguredPrimeModules: vi.fn(),
}))

vi.mock('../../src/prime-agent/context.js', () => ({
  assemblePrimeContext: contextMocks.assemblePrimeContext,
}))

vi.mock('../../src/prime-agent/actions.js', () => ({
  dispatchPrimeActions: actionMocks.dispatchPrimeActions,
}))

vi.mock('../../src/prime-agent/session.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/prime-agent/session.js')>('../../src/prime-agent/session.js')
  return {
    ...actual,
    startPrimeSession: sessionMocks.startPrimeSession,
    completePrimeSession: sessionMocks.completePrimeSession,
    failPrimeSession: sessionMocks.failPrimeSession,
  }
})

vi.mock('../../src/runtime.js', () => ({
  appendThreadMessage: runtimeMocks.appendThreadMessage,
  getPrimeProfile: runtimeMocks.getPrimeProfile,
}))

vi.mock('../../src/workspace.js', () => ({
  loadPrimeWorkspaceTemplates: workspaceMocks.loadPrimeWorkspaceTemplates,
}))

vi.mock('../../src/prime-agent/modules/registry.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/prime-agent/modules/registry.js')>(
      '../../src/prime-agent/modules/registry.js'
    )
  return {
    ...actual,
    listConfiguredPrimeModules: moduleRegistryMocks.listConfiguredPrimeModules,
  }
})

import { handlePrimeEvent, PrimeEventLoopError } from '../../src/prime-agent/event-loop.js'
import { listPrimeModules } from '../../src/prime-agent/modules/registry.js'

const pool = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) } as unknown as pg.Pool

describe('prime-agent event loop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const modules = listPrimeModules().filter((module) =>
      ['trigger.event-ingress', 'context.fleet-state', 'decision.llm-router', 'action.dispatch'].includes(module.id)
    )
    moduleRegistryMocks.listConfiguredPrimeModules.mockResolvedValue([
      ...modules.map((module) => ({ module, rollout_mode: 'active' as const, config: {} })),
    ])
    runtimeMocks.getPrimeProfile.mockResolvedValue({ name: 'Prime Agent' })
    workspaceMocks.loadPrimeWorkspaceTemplates.mockResolvedValue({
      effectiveRoot: '/workspace/prime',
      revision: 'abc123',
      templatePaths: {
        system: 'prompts/prime/system.md',
      },
    })
  })

  it('processes a prime message end to end and appends an assistant reply', async () => {
    sessionMocks.startPrimeSession.mockResolvedValue({
      id: 'session-1',
      status: 'running',
    })
    contextMocks.assemblePrimeContext.mockResolvedValue({
      trigger: {
        type: 'prime.message',
        payload: {
          thread_id: 'thread-1',
          message_id: 'message-1',
          content: 'Handle A7',
          sender: 'james',
        },
      },
      fleet: { agents: [], workItems: [], delegations: [] },
      recentEvents: [],
      recentLessons: [],
      threadMessages: [],
    })
    actionMocks.dispatchPrimeActions.mockResolvedValue([
      {
        action: {
          type: 'delegate',
          payload: {},
          reason: 'delegate it',
        },
        status: 'dispatched',
      },
    ])
    runtimeMocks.appendThreadMessage.mockResolvedValue({
      id: 'thread-msg-1',
    })
    sessionMocks.completePrimeSession.mockResolvedValue({
      id: 'session-1',
      status: 'completed',
      reasoning_summary: 'Delegating the implementation task.',
    })

    const router = {
      decide: vi.fn().mockResolvedValue({
        reasoning: 'Delegating the implementation task.',
        response: "I'm handing this off to the right implementation agent now.",
        actions: [
          {
            type: 'delegate',
            payload: {},
            reason: 'delegate it',
          },
        ],
        token_count: 42,
        provider_used: 'provider-1',
        model_used: 'mock-model',
      }),
    }

    const result = await handlePrimeEvent(
      pool,
      {
        type: 'prime.message',
        payload: {
          thread_id: 'thread-1',
          message_id: 'message-1',
          content: 'Handle A7',
          sender: 'james',
        },
      },
      { router }
    )

    expect(sessionMocks.startPrimeSession).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        trigger_type: 'prime_message',
        workspace_root: '/workspace/prime',
        workspace_revision: 'abc123',
        prompt_templates: expect.objectContaining({
          prime_modules: expect.stringContaining('context.fleet-state'),
        }),
      })
    )
    expect(contextMocks.assemblePrimeContext).toHaveBeenCalled()
    expect(router.decide).toHaveBeenCalled()
    expect(actionMocks.dispatchPrimeActions).toHaveBeenCalled()
    // Base ends with '.', so action reason is capitalized
    expect(runtimeMocks.appendThreadMessage).toHaveBeenCalledWith(
      pool,
      'thread-1',
      expect.objectContaining({
        role: 'assistant',
        sender: 'Prime Agent',
        content: "I'm handing this off to the right implementation agent now. Delegate it",
      })
    )
    expect(sessionMocks.completePrimeSession).toHaveBeenCalledWith(
      pool,
      'session-1',
      expect.objectContaining({
        reasoning_summary: 'Delegating the implementation task.',
        token_count: 42,
        provider_used: 'provider-1',
        model_used: 'mock-model',
      })
    )
    expect(result.session.status).toBe('completed')
  })

  it('fails the session and throws when orchestration errors', async () => {
    sessionMocks.startPrimeSession.mockResolvedValue({
      id: 'session-2',
      status: 'running',
    })
    contextMocks.assemblePrimeContext.mockResolvedValue({
      trigger: {
        type: 'cron.fast',
        payload: {
          triggered_at: '2026-05-09T23:00:00.000Z',
        },
      },
      fleet: { agents: [], workItems: [], delegations: [] },
      recentEvents: [],
      recentLessons: [],
      threadMessages: [],
    })
    sessionMocks.failPrimeSession.mockResolvedValue({
      id: 'session-2',
      status: 'failed',
      error: 'router exploded',
    })

    const router = {
      decide: vi.fn().mockRejectedValue(new Error('router exploded')),
    }

    await expect(
      handlePrimeEvent(
        pool,
        {
          type: 'cron.fast',
          payload: {
            triggered_at: '2026-05-09T23:00:00.000Z',
          },
        },
        { router }
      )
    ).rejects.toBeInstanceOf(PrimeEventLoopError)

    expect(sessionMocks.failPrimeSession).toHaveBeenCalledWith(pool, 'session-2', 'router exploded')
    expect(sessionMocks.completePrimeSession).not.toHaveBeenCalled()
    expect(runtimeMocks.appendThreadMessage).not.toHaveBeenCalled()
  })

  it('lowercases action reason when base does not end with terminal punctuation', async () => {
    sessionMocks.startPrimeSession.mockResolvedValue({
      id: 'session-4',
      status: 'running',
    })
    contextMocks.assemblePrimeContext.mockResolvedValue({
      trigger: {
        type: 'prime.message',
        payload: {
          thread_id: 'thread-1',
          message_id: 'message-1',
          content: 'Handle B2',
          sender: 'james',
        },
      },
      fleet: { agents: [], workItems: [], delegations: [] },
      recentEvents: [],
      recentLessons: [],
      threadMessages: [],
    })
    actionMocks.dispatchPrimeActions.mockResolvedValue([
      {
        action: {
          type: 'delegate',
          payload: {},
          reason: 'Delegate the task',
        },
        status: 'dispatched',
      },
    ])
    runtimeMocks.appendThreadMessage.mockResolvedValue({
      id: 'thread-msg-2',
    })
    sessionMocks.completePrimeSession.mockResolvedValue({
      id: 'session-4',
      status: 'completed',
      reasoning_summary: 'Delegating.',
    })

    const router = {
      decide: vi.fn().mockResolvedValue({
        reasoning: 'Delegating.',
        // Base does NOT end with terminal punctuation
        response: "I'm handing this off",
        actions: [
          {
            type: 'delegate',
            payload: {},
            reason: 'Delegate the task',
          },
        ],
        token_count: 10,
        provider_used: 'provider-1',
        model_used: 'mock-model',
      }),
    }

    await handlePrimeEvent(
      pool,
      {
        type: 'prime.message',
        payload: {
          thread_id: 'thread-1',
          message_id: 'message-1',
          content: 'Handle B2',
          sender: 'james',
        },
      },
      { router }
    )

    // Base does not end with punctuation, so action reason stays lowercase
    expect(runtimeMocks.appendThreadMessage).toHaveBeenCalledWith(
      pool,
      'thread-1',
      expect.objectContaining({
        role: 'assistant',
        sender: 'Prime Agent',
        content: "I'm handing this off delegate the task",
      })
    )
  })

  it('marks intake work item as done for conversational responses (no substantive actions)', async () => {
    const queryMock = vi.fn()
    const mockPool = { query: queryMock.mockResolvedValue({ rows: [], rowCount: 1 }) } as unknown as pg.Pool

    sessionMocks.startPrimeSession.mockResolvedValue({
      id: 'session-5',
      status: 'running',
    })
    contextMocks.assemblePrimeContext.mockResolvedValue({
      trigger: {
        type: 'prime.message',
        payload: {
          thread_id: 'thread-1',
          message_id: 'message-conv',
          content: 'hi',
          sender: 'james',
        },
      },
      fleet: { agents: [], workItems: [], delegations: [] },
      recentEvents: [],
      recentLessons: [],
      threadMessages: [],
    })
    actionMocks.dispatchPrimeActions.mockResolvedValue([])
    runtimeMocks.appendThreadMessage.mockResolvedValue({ id: 'thread-msg-conv' })
    sessionMocks.completePrimeSession.mockResolvedValue({
      id: 'session-5',
      status: 'completed',
      reasoning_summary: 'Conversational greeting.',
    })

    const router = {
      decide: vi.fn().mockResolvedValue({
        reasoning: 'Simple greeting — no action needed.',
        response: 'Hi! How can I help?',
        actions: [{ type: 'no_op', payload: {}, reason: 'No action needed' }],
        token_count: 10,
      }),
    }

    await handlePrimeEvent(
      mockPool,
      {
        type: 'prime.message',
        payload: {
          thread_id: 'thread-1',
          message_id: 'message-conv',
          content: 'hi',
          sender: 'james',
        },
      },
      { router }
    )

    // Should mark intake work item as 'done' (not 'review') for conversational responses
    const updateCall = queryMock.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' &&
        call[0].includes('UPDATE work_items') &&
        call[0].includes("SET status = $")
    )
    expect(updateCall).toBeDefined()
    expect(updateCall![1]).toEqual(['message-conv', 'done'])
  })

  it('runs shadow policy modules before later active stages', async () => {
    const modules = listPrimeModules().filter((module) =>
      ['trigger.event-ingress', 'context.fleet-state', 'decision.llm-router', 'policy.scope-required', 'action.dispatch'].includes(module.id)
    )
    moduleRegistryMocks.listConfiguredPrimeModules.mockResolvedValue(
      modules.map((module) => ({
        module,
        rollout_mode: module.id === 'policy.scope-required' ? 'shadow' as const : 'active' as const,
        config: {},
      }))
    )
    sessionMocks.startPrimeSession.mockResolvedValue({
      id: 'session-3',
      status: 'running',
    })
    contextMocks.assemblePrimeContext.mockResolvedValue({
      trigger: {
        type: 'cron.fast',
        payload: {
          triggered_at: '2026-05-19T00:00:00.000Z',
        },
      },
      fleet: { agents: [], workItems: [], delegations: [] },
      recentEvents: [],
      recentLessons: [],
      threadMessages: [],
    })
    sessionMocks.failPrimeSession.mockResolvedValue({
      id: 'session-3',
      status: 'failed',
      error: 'Prime policy scope-required blocked delegate actions without allowed_files: implementation',
    })

    const router = {
      decide: vi.fn().mockResolvedValue({
        reasoning: 'Delegate implementation work.',
        actions: [
          {
            type: 'delegate',
            payload: {
              capability: 'implementation',
            },
            reason: 'delegate it',
          },
        ],
        token_count: 20,
      }),
    }

    await expect(
      handlePrimeEvent(
        pool,
        {
          type: 'cron.fast',
          payload: {
            triggered_at: '2026-05-19T00:00:00.000Z',
          },
        },
        { router }
      )
    ).rejects.toBeInstanceOf(PrimeEventLoopError)

    expect(actionMocks.dispatchPrimeActions).not.toHaveBeenCalled()
    expect(sessionMocks.failPrimeSession).toHaveBeenCalledWith(
      pool,
      'session-3',
      'Prime policy scope-required blocked delegate actions without allowed_files: implementation'
    )
  })
})
