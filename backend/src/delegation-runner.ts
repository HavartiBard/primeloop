import type pg from 'pg'
import { createAgentAdapter } from './adapters/index.js'
import { ensurePendingApproval, getApprovalForRun } from './approvals.js'
import { loadDelegationContext, mergeDelegationContext } from './delegation-context.js'
import { getAgent } from './registry.js'
import {
  appendDelegationTrace,
  appendThreadMessage,
  getDelegation,
  insertRuntimeEvent,
  updateDelegation,
  updateWorkItem,
  type Delegation,
} from './runtime.js'

export interface DelegationRunResult {
  delegation: Delegation
  status: string
  blocked: boolean
  reason?: string
}

function routeRequiresApproval(delegation: Delegation): boolean {
  const route = delegation.request?.['route']
  if (route && typeof route === 'object' && 'requiresApproval' in route) {
    return Boolean((route as { requiresApproval?: unknown }).requiresApproval)
  }
  return delegation.status === 'blocked'
}

function threadIdFromRequest(delegation: Delegation): string | undefined {
  const value = delegation.request?.['thread_id']
  return typeof value === 'string' ? value : undefined
}

function contentFromRequest(delegation: Delegation): string {
  const value = delegation.request?.['content']
  return typeof value === 'string' ? value : ''
}

function supportsInjectedContext(runtimeFamily: string): boolean {
  return runtimeFamily === 'opencode' || runtimeFamily === 'codex-app-server'
}

export async function runDelegation(pool: pg.Pool, delegationId: string): Promise<DelegationRunResult> {
  let delegation = await getDelegation(pool, delegationId)
  if (!delegation) {
    throw new Error('delegation not found')
  }

  if (routeRequiresApproval(delegation)) {
    const approvalId = `delegation:${delegation.id}`
    const existingApproval = await getApprovalForRun(pool, delegation.id)
    if (existingApproval?.status === 'denied') {
      const updated = await updateDelegation(pool, delegation.id, {
        status: 'blocked',
        result: { denied: true, approval_id: existingApproval.approval_id },
      })
      return {
        delegation: updated ?? delegation,
        status: 'blocked',
        blocked: true,
        reason: 'approval-denied',
      }
    }

    if (existingApproval?.status !== 'approved') {
      const approval = await ensurePendingApproval(pool, {
        approval_id: approvalId,
        run_id: delegation.id,
        action: `Run ${delegation.capability} delegation`,
      })
      await insertRuntimeEvent(pool, {
        event_type: 'approval.needed',
        actor: 'Chief of Staff',
        work_item_id: delegation.work_item_id,
        delegation_id: delegation.id,
        payload: {
          approval_id: approval.approval_id,
          run_id: approval.run_id,
          action: approval.action,
        },
      })
      delegation = await appendDelegationTrace(pool, delegation, {
        type: 'policy.blocked',
        reason: 'approval-required',
        approval_id: approval.approval_id,
      })
      const updated = await updateDelegation(pool, delegation.id, { status: 'blocked' })
      await insertRuntimeEvent(pool, {
        event_type: 'delegation.blocked',
        actor: 'Chief of Staff',
        work_item_id: delegation.work_item_id,
        delegation_id: delegation.id,
        payload: { reason: 'approval-required', approval_id: approval.approval_id },
      })
      if (delegation.work_item_id) {
        await updateWorkItem(pool, delegation.work_item_id, {
          status: 'approval',
          blocked_by: 'approval-required',
        })
      }
      return {
        delegation: updated ?? delegation,
        status: 'blocked',
        blocked: true,
        reason: 'approval-required',
      }
    }

    delegation = await appendDelegationTrace(pool, delegation, {
      type: 'policy.approved',
      approval_id: existingApproval.approval_id,
    })
  }

  if (!delegation.to_agent_id) {
    const updated = await updateDelegation(pool, delegation.id, {
      status: 'blocked',
      result: { error: 'no target agent selected' },
    })
    await insertRuntimeEvent(pool, {
      event_type: 'delegation.blocked',
      actor: 'Chief of Staff',
      work_item_id: delegation.work_item_id,
      delegation_id: delegation.id,
      payload: { reason: 'missing-agent' },
    })
    return {
      delegation: updated ?? delegation,
      status: 'blocked',
      blocked: true,
      reason: 'missing-agent',
    }
  }

  const agent = await getAgent(pool, delegation.to_agent_id)
  if (!agent || !agent.enabled) {
    const updated = await updateDelegation(pool, delegation.id, {
      status: 'blocked',
      result: { error: 'target agent is unavailable' },
    })
    await insertRuntimeEvent(pool, {
      event_type: 'delegation.blocked',
      actor: 'Chief of Staff',
      work_item_id: delegation.work_item_id,
      delegation_id: delegation.id,
      payload: { reason: 'agent-unavailable', to_agent_id: delegation.to_agent_id },
    })
    return {
      delegation: updated ?? delegation,
      status: 'blocked',
      blocked: true,
      reason: 'agent-unavailable',
    }
  }

  delegation = await appendDelegationTrace(pool, delegation, {
    type: 'delegation.started',
    to_agent_id: agent.id,
    agent: agent.name,
  })
  delegation = await updateDelegation(pool, delegation.id, { status: 'running' }) ?? delegation
  if (delegation.work_item_id) {
    await updateWorkItem(pool, delegation.work_item_id, { status: 'active' })
  }
  await insertRuntimeEvent(pool, {
    event_type: 'delegation.started',
    actor: 'Chief of Staff',
    work_item_id: delegation.work_item_id,
    delegation_id: delegation.id,
    payload: { to_agent_id: agent.id, agent: agent.name, capability: delegation.capability },
  })

  const adapter = createAgentAdapter(agent)
  const resultEvents: Array<Record<string, unknown>> = []
  const requestInput = { ...delegation.request }

  if (supportsInjectedContext(agent.runtime_family)) {
    const injectedContext = await loadDelegationContext(pool, agent.id)
    if (injectedContext) {
      requestInput['context'] = mergeDelegationContext(requestInput['context'], injectedContext)
    }
  }

  try {
    for await (const event of adapter.startTask(agent, {
      capability: delegation.capability,
      input: requestInput,
      work_item_id: delegation.work_item_id,
      delegation_id: delegation.id,
    })) {
      resultEvents.push({ type: event.type, payload: event.payload })
      delegation = await appendDelegationTrace(pool, delegation, {
        type: 'adapter.event',
        adapter_event_type: event.type,
        payload: event.payload,
      })
      await insertRuntimeEvent(pool, {
        event_type: `adapter.${event.type}`,
        actor: agent.name,
        work_item_id: delegation.work_item_id,
        delegation_id: delegation.id,
        payload: event.payload,
      })
    }

    const failed = resultEvents.some((event) => event.type === 'task.failed')
    const status = failed ? 'failed' : 'completed'
    const updated = await updateDelegation(pool, delegation.id, {
      status,
      result: { events: resultEvents },
      completed_at: new Date().toISOString(),
    })
    if (delegation.work_item_id) {
      await updateWorkItem(pool, delegation.work_item_id, { status: failed ? 'blocked' : 'review' })
    }
    const threadId = threadIdFromRequest(delegation)
    if (threadId) {
      await appendThreadMessage(pool, threadId, {
        role: 'assistant',
        sender: agent.name,
        content: failed
          ? `Delegation ${delegation.id} failed during adapter execution.`
          : `Delegation ${delegation.id} completed and is ready for review.`,
        metadata: { delegation_id: delegation.id, work_item_id: delegation.work_item_id, events: resultEvents },
      })
    }
    await insertRuntimeEvent(pool, {
      event_type: `delegation.${status}`,
      actor: agent.name,
      work_item_id: delegation.work_item_id,
      delegation_id: delegation.id,
      payload: { events: resultEvents, content: contentFromRequest(delegation) },
    })
    return {
      delegation: updated ?? delegation,
      status,
      blocked: false,
    }
  } catch (err) {
    const updated = await updateDelegation(pool, delegation.id, {
      status: 'failed',
      result: { error: (err as Error).message, events: resultEvents },
      completed_at: new Date().toISOString(),
    })
    if (delegation.work_item_id) {
      await updateWorkItem(pool, delegation.work_item_id, {
        status: 'blocked',
        blocked_by: 'adapter-error',
      })
    }
    await insertRuntimeEvent(pool, {
      event_type: 'delegation.failed',
      actor: agent.name,
      work_item_id: delegation.work_item_id,
      delegation_id: delegation.id,
      payload: { error: (err as Error).message },
    })
    return {
      delegation: updated ?? delegation,
      status: 'failed',
      blocked: false,
      reason: (err as Error).message,
    }
  }
}
