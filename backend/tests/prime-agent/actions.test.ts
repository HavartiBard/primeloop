import { beforeEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'

const runtimeMocks = vi.hoisted(() => ({
  createWorkItem: vi.fn(),
  createDelegation: vi.fn(),
  updateWorkItem: vi.fn(),
  insertRuntimeEvent: vi.fn(),
}))

const approvalMocks = vi.hoisted(() => ({
  ensurePendingApproval: vi.fn(),
}))

vi.mock('../../src/runtime.js', () => ({
  createWorkItem: runtimeMocks.createWorkItem,
  createDelegation: runtimeMocks.createDelegation,
  updateWorkItem: runtimeMocks.updateWorkItem,
  insertRuntimeEvent: runtimeMocks.insertRuntimeEvent,
}))

vi.mock('../../src/approvals.js', () => ({
  ensurePendingApproval: approvalMocks.ensurePendingApproval,
}))

import { dispatchPrimeActions } from '../../src/prime-agent/actions.js'
import type { PrimeContext } from '../../src/prime-agent/context.js'
import type { PrimeDecision } from '../../src/prime-agent/llm-router.js'

const pool = {} as pg.Pool

const context: PrimeContext = {
  trigger: {
    type: 'chief.message',
    payload: {
      thread_id: 'thread-1',
      message_id: 'message-1',
      content: 'Handle Prime actions',
      sender: 'james',
    },
  },
  fleet: {
    agents: [
      {
        id: 'agent-1',
        name: 'builder',
        type: 'codex',
        runtime_family: 'codex',
        execution_mode: 'local',
        capabilities: ['implementation'],
        config: {},
        enabled: true,
        created_at: '2026-05-09T00:00:00.000Z',
      },
    ],
    workItems: [],
    delegations: [],
  },
  recentEvents: [],
  recentLessons: [],
}

describe('prime-agent actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('dispatches delegate actions into work item and delegation writes', async () => {
    runtimeMocks.createWorkItem.mockResolvedValue({
      id: 'work-1',
      title: 'Implement A6',
      status: 'active',
    })
    runtimeMocks.createDelegation.mockResolvedValue({
      id: 'delegation-1',
      work_item_id: 'work-1',
      status: 'queued',
    })

    const decision: PrimeDecision = {
      reasoning: 'Delegate implementation.',
      actions: [
        {
          type: 'delegate',
          payload: {
            title: 'Implement A6',
            capability: 'implementation',
            description: 'Implement Prime action dispatch.',
          },
          reason: 'A worker can handle implementation.',
        },
      ],
    }

    const results = await dispatchPrimeActions(pool, context, decision)

    expect(runtimeMocks.createWorkItem).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        title: 'Implement A6',
        lane: 'operations',
        owner_label: 'Prime Agent',
      })
    )
    expect(runtimeMocks.createDelegation).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        work_item_id: 'work-1',
        to_agent_id: 'agent-1',
        capability: 'implementation',
      })
    )
    expect(runtimeMocks.insertRuntimeEvent).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        event_type: 'prime.action.delegate',
        delegation_id: 'delegation-1',
      })
    )
    expect(results[0]?.delegation?.id).toBe('delegation-1')
  })

  it('dispatches update_work_item actions', async () => {
    runtimeMocks.updateWorkItem.mockResolvedValue({
      id: 'work-2',
      status: 'review',
      thread_id: 'thread-1',
    })

    const results = await dispatchPrimeActions(pool, context, {
      reasoning: 'Update work status.',
      actions: [
        {
          type: 'update_work_item',
          payload: {
            work_item_id: 'work-2',
            status: 'review',
          },
          reason: 'Work is ready for review.',
        },
      ],
    })

    expect(runtimeMocks.updateWorkItem).toHaveBeenCalledWith(
      pool,
      'work-2',
      expect.objectContaining({
        status: 'review',
      })
    )
    expect(runtimeMocks.insertRuntimeEvent).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        event_type: 'prime.action.update_work_item',
        work_item_id: 'work-2',
      })
    )
    expect(results[0]?.work_item?.status).toBe('review')
  })

  it('dispatches request_approval actions using the approval helper', async () => {
    runtimeMocks.createWorkItem.mockResolvedValue({
      id: 'work-3',
      title: 'Approval request',
      status: 'approval',
    })
    approvalMocks.ensurePendingApproval.mockResolvedValue({
      approval_id: 'prime:work-3',
      run_id: 'work-3',
      action: 'Deploy to production',
      status: 'pending',
    })

    const results = await dispatchPrimeActions(pool, context, {
      reasoning: 'Need approval.',
      actions: [
        {
          type: 'request_approval',
          payload: {
            action: 'Deploy to production',
            approver: 'human',
            context: { env: 'prod' },
          },
          reason: 'Production deploys require approval.',
        },
      ],
    })

    expect(runtimeMocks.createWorkItem).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        lane: 'approval',
        status: 'approval',
      })
    )
    expect(approvalMocks.ensurePendingApproval).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        approval_id: 'prime:work-3',
        run_id: 'work-3',
        action: 'Deploy to production',
      })
    )
    expect(runtimeMocks.insertRuntimeEvent).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        event_type: 'prime.action.request_approval',
        work_item_id: 'work-3',
      })
    )
    expect(results[0]?.approval?.approval_id).toBe('prime:work-3')
  })

  it('dispatches no_op actions as runtime events only', async () => {
    await dispatchPrimeActions(pool, context, {
      reasoning: 'No action needed.',
      actions: [
        {
          type: 'no_op',
          payload: {},
          reason: 'Everything is already in the right state.',
        },
      ],
    })

    expect(runtimeMocks.createWorkItem).not.toHaveBeenCalled()
    expect(runtimeMocks.createDelegation).not.toHaveBeenCalled()
    expect(approvalMocks.ensurePendingApproval).not.toHaveBeenCalled()
    expect(runtimeMocks.insertRuntimeEvent).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        event_type: 'prime.action.no_op',
      })
    )
  })

  it('returns a controlled error for unsupported actions', async () => {
    await expect(
      dispatchPrimeActions(pool, context, {
        reasoning: 'Bad action.',
        actions: [
          {
            type: 'publish_pattern' as never,
            payload: {},
            reason: 'not supported in phase a',
          },
        ],
      })
    ).rejects.toThrow('Unsupported Prime action type: publish_pattern')
  })
})
