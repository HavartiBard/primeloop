import { beforeEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'

const runtimeMocks = vi.hoisted(() => ({
  createWorkItem: vi.fn(),
  createDelegation: vi.fn(),
  updateWorkItem: vi.fn(),
  insertRuntimeEvent: vi.fn(),
  getPrimeProfile: vi.fn(),
  appendThreadMessage: vi.fn(),
}))

const approvalMocks = vi.hoisted(() => ({
  ensurePendingApproval: vi.fn(),
}))

vi.mock('../../src/runtime.js', () => ({
  createWorkItem: runtimeMocks.createWorkItem,
  createDelegation: runtimeMocks.createDelegation,
  updateWorkItem: runtimeMocks.updateWorkItem,
  insertRuntimeEvent: runtimeMocks.insertRuntimeEvent,
  getPrimeProfile: runtimeMocks.getPrimeProfile,
  appendThreadMessage: runtimeMocks.appendThreadMessage,
}))

vi.mock('../../src/approvals.js', () => ({
  ensurePendingApproval: approvalMocks.ensurePendingApproval,
}))

const workspaceMocks = vi.hoisted(() => ({
  readProfileFiles:  vi.fn(),
  writeProfileFiles: vi.fn(),
}))

vi.mock('../../src/workspace.js', () => ({
  readProfileFiles:  workspaceMocks.readProfileFiles,
  writeProfileFiles: workspaceMocks.writeProfileFiles,
}))

import { dispatchPrimeActions } from '../../src/prime-agent/actions.js'
import type { PrimeContext } from '../../src/prime-agent/context.js'
import type { PrimeDecision } from '../../src/prime-agent/llm-router.js'

const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as pg.Pool

const context: PrimeContext = {
  trigger: {
    type: 'prime.message',
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
  threadMessages: [],
}

describe('prime-agent actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeMocks.getPrimeProfile.mockResolvedValue({ name: 'Prime Agent' })
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

  describe('dispatchPrimeActions — update_profile', () => {
    beforeEach(() => {
      runtimeMocks.appendThreadMessage.mockReset()
      runtimeMocks.insertRuntimeEvent.mockReset()
      runtimeMocks.getPrimeProfile.mockResolvedValue({ name: 'Prime' })
      workspaceMocks.readProfileFiles.mockReset()
      workspaceMocks.writeProfileFiles.mockReset()
      workspaceMocks.readProfileFiles.mockResolvedValue({
        soul:      { sections: { identity: 'old', voice_tone: '', decision_style: '' }, unknown: [] },
        operating: { sections: { default_behaviors: '', approval_thresholds: '' },     unknown: [] },
      })
      workspaceMocks.writeProfileFiles.mockResolvedValue(undefined)
    })

    it('updates a soul section and writes back', async () => {
      await dispatchPrimeActions(pool, context, {
        reasoning: 'tweak identity',
        response: 'updated identity',
        actions: [{
          type: 'update_profile',
          payload: { file: 'soul', section_key: 'identity', new_text: 'new identity text', reason: 'user asked' },
          reason: 'user asked',
        }],
      })

      expect(workspaceMocks.writeProfileFiles).toHaveBeenCalled()
      const writtenBundle = workspaceMocks.writeProfileFiles.mock.calls[0][1]
      expect(writtenBundle.soul.sections.identity).toBe('new identity text')
    })

    it('appends a chat message containing the diff', async () => {
      await dispatchPrimeActions(pool, context, {
        reasoning: 'r',
        response: 'r',
        actions: [{
          type: 'update_profile',
          payload: { file: 'soul', section_key: 'identity', new_text: 'new', reason: 'user asked' },
          reason: 'user asked',
        }],
      })
      expect(runtimeMocks.appendThreadMessage).toHaveBeenCalled()
      const [, , msg] = runtimeMocks.appendThreadMessage.mock.calls[0]
      expect(msg.content).toContain('-old')
      expect(msg.content).toContain('+new')
    })

    it('emits prime.action.update_profile event', async () => {
      await dispatchPrimeActions(pool, context, {
        reasoning: 'r',
        response: 'r',
        actions: [{
          type: 'update_profile',
          payload: { file: 'soul', section_key: 'identity', new_text: 'new', reason: 'user asked' },
          reason: 'user asked',
        }],
      })
      expect(runtimeMocks.insertRuntimeEvent).toHaveBeenCalledWith(
        pool,
        expect.objectContaining({ event_type: 'prime.action.update_profile' }),
      )
    })

    it('rejects unknown section keys', async () => {
      await expect(dispatchPrimeActions(pool, context, {
        reasoning: 'r',
        response: 'r',
        actions: [{
          type: 'update_profile',
          payload: { file: 'soul', section_key: 'bogus', new_text: 'x', reason: 'why' },
          reason: 'why',
        }],
      })).rejects.toThrow(/unknown section/i)
    })
  })
})
