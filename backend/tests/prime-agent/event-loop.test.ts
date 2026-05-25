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
  createDelegation: vi.fn(),
  createWorkItem: vi.fn(),
  getPrimeProfile: vi.fn(),
  insertRuntimeEvent: vi.fn(),
}))

const registryMocks = vi.hoisted(() => ({
  getAgentByRole: vi.fn(),
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
  createDelegation: runtimeMocks.createDelegation,
  createWorkItem: runtimeMocks.createWorkItem,
  getPrimeProfile: runtimeMocks.getPrimeProfile,
  insertRuntimeEvent: runtimeMocks.insertRuntimeEvent,
}))

vi.mock('../../src/registry.js', () => ({
  getAgentByRole: registryMocks.getAgentByRole,
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

const pool = {
  query: vi.fn(async (sql: string) => {
    if (sql.includes('SELECT * FROM agents')) return { rows: [], rowCount: 0 }
    if (sql.includes('FROM agent_heartbeat')) return { rows: [], rowCount: 0 }
    if (sql.includes('prime_agent_config')) return { rows: [{ config: {} }], rowCount: 1 }
    if (sql.includes('routing_outcomes')) return { rows: [{ count: 0 }], rowCount: 1 }
    if (sql.includes('INSERT INTO routing_outcomes')) return { rows: [], rowCount: 1 }
    if (sql.includes('INSERT INTO routing_requests')) return { rows: [], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }),
} as unknown as pg.Pool

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
    registryMocks.getAgentByRole.mockResolvedValue(null)
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
      runtimeTruth: { dispatchableAgents: [], registeredOnlyAgents: [], spawnableTemplates: [], capabilityGaps: [], allRuntimeAvailability: [] },
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
      { router, getHarness: () => undefined }
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
      runtimeTruth: { dispatchableAgents: [], registeredOnlyAgents: [], spawnableTemplates: [], capabilityGaps: [], allRuntimeAvailability: [] },
    })
    sessionMocks.failPrimeSession.mockResolvedValue({
      id: 'session-2',
      status: 'failed',
      error: 'router exploded',
    })
    runtimeMocks.createWorkItem.mockResolvedValue({
      id: 'investigation-1',
      title: 'Investigate Prime failure: router exploded',
      description: 'desc',
      status: 'active',
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
        { router, getHarness: () => undefined }
      )
    ).rejects.toBeInstanceOf(PrimeEventLoopError)

    expect(sessionMocks.failPrimeSession).toHaveBeenCalledWith(pool, 'session-2', 'router exploded')
    expect(sessionMocks.completePrimeSession).not.toHaveBeenCalled()
    expect(runtimeMocks.appendThreadMessage).not.toHaveBeenCalled()
  })

  it('opens an SRE investigation when a prime message turn fails hard', async () => {
    // Provide routing data: SRE agent with fresh heartbeat so routing finds dispatchable target
    ;(pool.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM agents')) {
        return { rows: [{ id: 'sre-1', name: 'SRE', type: 'sre', runtime_family: 'local', execution_mode: 'managed', capabilities: ['incident_response', 'diagnostics'], config: {}, enabled: true, role: 'sre' }], rowCount: 1 }
      }
      if (sql.includes('FROM agent_heartbeat')) {
        return { rows: [{ agent: 'SRE', last_seen: new Date().toISOString(), healthy: true }], rowCount: 1 }
      }
      if (sql.includes('prime_agent_config')) return { rows: [{ config: {} }], rowCount: 1 }
      if (sql.includes('routing_outcomes')) return { rows: [{ count: 0 }], rowCount: 1 }
      if (sql.includes('INSERT INTO routing_outcomes')) return { rows: [], rowCount: 1 }
      if (sql.includes('INSERT INTO routing_requests')) return { rows: [], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })

    sessionMocks.startPrimeSession.mockResolvedValue({
      id: 'session-6',
      status: 'running',
    })
    contextMocks.assemblePrimeContext.mockResolvedValue({
      trigger: {
        type: 'prime.message',
        payload: {
          thread_id: 'thread-1',
          message_id: 'message-1',
          content: 'Investigate this failure',
          sender: 'james',
        },
      },
      fleet: { agents: [], workItems: [], delegations: [] },
      recentEvents: [],
      recentLessons: [],
      threadMessages: [],
      runtimeTruth: { dispatchableAgents: [], registeredOnlyAgents: [], spawnableTemplates: [], capabilityGaps: [], allRuntimeAvailability: [] },
    })
    sessionMocks.failPrimeSession.mockResolvedValue({
      id: 'session-6',
      status: 'failed',
      error: 'router exploded',
    })
    runtimeMocks.createWorkItem.mockResolvedValue({
      id: 'investigation-2',
      title: 'Investigate Prime failure: router exploded',
      description: 'desc',
      status: 'active',
    })
    runtimeMocks.createDelegation.mockResolvedValue({
      id: 'delegation-2',
      work_item_id: 'investigation-2',
      status: 'queued',
    })

    const router = {
      decide: vi.fn().mockRejectedValue(new Error('router exploded')),
    }

    await expect(
      handlePrimeEvent(
        pool,
        {
          type: 'prime.message',
          payload: {
            thread_id: 'thread-1',
            message_id: 'message-1',
            content: 'Investigate this failure',
            sender: 'james',
          },
        },
        { router, getHarness: () => undefined }
      )
    ).rejects.toBeInstanceOf(PrimeEventLoopError)

    expect(runtimeMocks.createWorkItem).toHaveBeenCalled()
    expect(runtimeMocks.createDelegation).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        work_item_id: 'investigation-2',
        to_agent_id: 'sre-1',
        capability: 'sre',
      })
    )
    expect(runtimeMocks.appendThreadMessage).toHaveBeenCalledWith(
      pool,
      'thread-1',
      expect.objectContaining({
        content: 'I could not process that yet: router exploded I opened investigation work item investigation-2 and routed it to SRE.',
      })
    )
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
      runtimeTruth: { dispatchableAgents: [], registeredOnlyAgents: [], spawnableTemplates: [], capabilityGaps: [], allRuntimeAvailability: [] },
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
      { router, getHarness: () => undefined }
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

  it('includes blocker remediation in the chat response when only no_op actions remain', async () => {
    // Provide routing data: SRE agent with fresh heartbeat so investigation routes to dispatchable target
    ;(pool.query as ReturnType<typeof vi.fn>).mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT * FROM agents')) {
        return { rows: [{ id: 'sre-1', name: 'SRE', type: 'sre', runtime_family: 'local', execution_mode: 'managed', capabilities: ['incident_response', 'diagnostics'], config: {}, enabled: true, role: 'sre' }], rowCount: 1 }
      }
      if (sql.includes('FROM agent_heartbeat')) {
        return { rows: [{ agent: 'SRE', last_seen: new Date().toISOString(), healthy: true }], rowCount: 1 }
      }
      if (sql.includes('prime_agent_config')) return { rows: [{ config: {} }], rowCount: 1 }
      if (sql.includes('routing_outcomes')) return { rows: [{ count: 0 }], rowCount: 1 }
      if (sql.includes('INSERT INTO routing_outcomes')) return { rows: [], rowCount: 1 }
      if (sql.includes('INSERT INTO routing_requests')) return { rows: [], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })

    sessionMocks.startPrimeSession.mockResolvedValue({
      id: 'session-5',
      status: 'running',
    })
    contextMocks.assemblePrimeContext.mockResolvedValue({
      trigger: {
        type: 'prime.message',
        payload: {
          thread_id: 'thread-1',
          message_id: 'message-1',
          content: 'Clean up stale cards',
          sender: 'james',
        },
      },
      fleet: { agents: [], workItems: [], delegations: [] },
      recentEvents: [],
      recentLessons: [],
      threadMessages: [],
      runtimeTruth: { dispatchableAgents: [], registeredOnlyAgents: [], spawnableTemplates: [], capabilityGaps: [], allRuntimeAvailability: [] },
    })
    actionMocks.dispatchPrimeActions.mockResolvedValue([
      {
        action: {
          type: 'no_op',
          payload: {},
          reason: "No enabled agent advertises 'fleet_diagnostic'. Suggested fix: add capability 'fleet_diagnostic' to SRE or create a new agent for it.",
        },
        status: 'dispatched',
      },
    ])
    runtimeMocks.appendThreadMessage.mockResolvedValue({
      id: 'thread-msg-5',
    })
    runtimeMocks.createWorkItem.mockResolvedValue({
      id: 'blocker-investigation-1',
      title: 'Investigate Prime blocker: missing capability',
      description: 'desc',
      status: 'active',
    })
    runtimeMocks.createDelegation.mockResolvedValue({
      id: 'blocker-delegation-1',
      work_item_id: 'blocker-investigation-1',
      status: 'queued',
    })
    registryMocks.getAgentByRole.mockResolvedValue({
      id: 'sre-1',
      enabled: true,
      name: 'SRE',
    })
    sessionMocks.completePrimeSession.mockResolvedValue({
      id: 'session-5',
      status: 'completed',
      reasoning_summary: 'Blocked on missing capability.',
    })

    const router = {
      decide: vi.fn().mockResolvedValue({
        reasoning: 'Blocked on missing capability.',
        response: 'I found the blocker.',
        actions: [
          {
            type: 'delegate',
            payload: {},
            reason: 'delegate it',
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
          content: 'Clean up stale cards',
          sender: 'james',
        },
      },
      { router, getHarness: () => undefined }
    )

    expect(runtimeMocks.appendThreadMessage).toHaveBeenCalledWith(
      pool,
      'thread-1',
      expect.objectContaining({
        content: "I found the blocker. No enabled agent advertises 'fleet_diagnostic'. Suggested fix: add capability 'fleet_diagnostic' to SRE or create a new agent for it. I opened investigation work item blocker-investigation-1 and routed it to SRE.",
      })
    )
    expect(runtimeMocks.createDelegation).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        work_item_id: 'blocker-investigation-1',
        to_agent_id: 'sre-1',
        capability: 'sre',
      })
    )
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
      runtimeTruth: { dispatchableAgents: [], registeredOnlyAgents: [], spawnableTemplates: [], capabilityGaps: [], allRuntimeAvailability: [] },
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
        { router, getHarness: () => undefined }
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
