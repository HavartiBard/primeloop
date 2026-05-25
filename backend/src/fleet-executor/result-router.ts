import type pg from 'pg'
import { appendThreadMessage, type Delegation } from '../runtime.js'
import type { PrimeQueue } from '../prime-agent/queue.js'
import type { AgentState } from '../registry.js'
import { retireEphemeralAgent } from '../ephemeral-templates.js'
import type { TaskResult } from './harness.js'
import { transitionWorkItemStatus, updateWorkItem, getWorkItem } from '../goals/work-item-service.js'
import { broadcastEvent } from '../ws/control-plane-events.js'
import { createRecoveryEvent, selectRecoveryAction } from '../recovery/service.js'

export interface ResultRouterDeps {
  pool: pg.Pool
  primeQueue: PrimeQueue
}

export type ResultOutcome =
  | { success: true; result: TaskResult }
  | { success: false; error: string }

interface DelegationResult {
  success: boolean
  summary?: string
  error?: string
  blocked?: boolean
  blockReason?: string
}

/**
 * Update WorkItem status when a delegated task completes, fails, or blocks.
 * Broadcasts work-item.updated events for each transition.
 */
export async function handleDelegationResult(
  pool: pg.Pool,
  workItemId: string,
  result: DelegationResult,
): Promise<void> {
  const workItem = await getWorkItem(pool, workItemId)
  if (!workItem) return

  if (result.success) {
    await transitionWorkItemStatus(pool, workItemId, 'completed')
    if (result.summary) {
      await updateWorkItem(pool, workItemId, { outcomeSummary: result.summary })
    }
    broadcastEvent({
      type: 'work-item.updated',
      occurredAt: new Date().toISOString(),
      goalId: workItem.goalId,
      payload: { workItemId, status: 'completed', outcomeSummary: result.summary },
    })
  } else if (result.blocked) {
    await transitionWorkItemStatus(pool, workItemId, 'blocked', result.blockReason)
    if (result.summary || result.blockReason) {
      await updateWorkItem(pool, workItemId, {
        outcomeSummary: result.summary ?? null,
        failureReason: result.blockReason ?? null,
      })
    }
    broadcastEvent({
      type: 'work-item.updated',
      occurredAt: new Date().toISOString(),
      goalId: workItem.goalId,
      payload: {
        workItemId,
        status: 'blocked',
        outcomeSummary: result.summary,
        failureReason: result.blockReason,
      },
    })
    await recordRecovery(pool, workItem.goalId, workItemId, result.blockReason ?? 'Work item blocked', 'high')
  } else {
    await transitionWorkItemStatus(pool, workItemId, 'failed', result.error)
    if (result.summary || result.error) {
      await updateWorkItem(pool, workItemId, {
        outcomeSummary: result.summary ?? null,
        failureReason: result.error ?? null,
      })
    }
    broadcastEvent({
      type: 'work-item.updated',
      occurredAt: new Date().toISOString(),
      goalId: workItem.goalId,
      payload: {
        workItemId,
        status: 'failed',
        outcomeSummary: result.summary,
        failureReason: result.error,
      },
    })
    await recordRecovery(pool, workItem.goalId, workItemId, result.error ?? 'Work item failed', 'medium')
  }
}

async function recordRecovery(
  pool: pg.Pool,
  goalId: string,
  workItemId: string,
  detectedCondition: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
): Promise<void> {
  const decision = selectRecoveryAction({ goalId, workItemId, detectedCondition, severity })
  const recoveryEvent = await createRecoveryEvent(pool, {
    goalId,
    workItemId,
    detectedCondition,
    detectedAt: new Date().toISOString(),
    severity,
    selectedAction: decision.selectedAction,
    actionReason: decision.actionReason,
    resultStatus: decision.resultStatus,
    resultSummary: decision.resultSummary,
  })

  broadcastEvent({
    type: 'recovery.recorded',
    occurredAt: new Date().toISOString(),
    goalId,
    payload: recoveryEvent as unknown as Record<string, unknown>,
  })
}

export async function routeResult(
  deps: ResultRouterDeps,
  delegation: Delegation,
  outcome: ResultOutcome,
): Promise<void> {
  const { pool, primeQueue } = deps
  const threadId = typeof delegation.request['thread_id'] === 'string'
    ? delegation.request['thread_id']
    : undefined
  const nextState = await resolveNextAgentState(pool, delegation.to_agent_id)

  if (outcome.success) {
    await pool.query(
      `UPDATE delegations SET status='completed', result=$2, completed_at=now(), updated_at=now() WHERE id=$1`,
      [delegation.id, JSON.stringify({ changed_files: outcome.result.changed_files, tokens: outcome.result.tokens })],
    )

    if (threadId) {
      await appendThreadMessage(pool, threadId, {
        role: 'assistant',
        sender: delegation.to_agent_id ?? 'agent',
        content: `Task complete. Changed: ${outcome.result.changed_files?.join(', ') ?? 'none'}`,
        metadata: { source: 'fleet-executor', delegation_id: delegation.id },
      })
    }

    await primeQueue.enqueue({
      type: 'fleet.delegation.completed',
      payload: {
        delegation_id: delegation.id,
        work_item_id: delegation.work_item_id,
        agent_id: delegation.to_agent_id,
        result: { changed_files: outcome.result.changed_files },
      },
    })

    // Update WorkItem status to completed
    if (delegation.work_item_id) {
      await handleDelegationResult(pool, delegation.work_item_id, {
        success: true,
        summary: outcome.result.text,
      })
    }
  } else {
    await pool.query(
      `UPDATE delegations SET status='failed', result=$2, completed_at=now(), updated_at=now() WHERE id=$1`,
      [delegation.id, JSON.stringify({ error: outcome.error })],
    )

    if (threadId) {
      await appendThreadMessage(pool, threadId, {
        role: 'assistant',
        sender: delegation.to_agent_id ?? 'agent',
        content: `Task failed: ${outcome.error}`,
        metadata: { source: 'fleet-executor', delegation_id: delegation.id },
      })
    }

    await primeQueue.enqueue({
      type: 'fleet.delegation.failed',
      payload: {
        delegation_id: delegation.id,
        work_item_id: delegation.work_item_id,
        agent_id: delegation.to_agent_id,
        error: outcome.error,
      },
    })

    // Update WorkItem status to failed
    if (delegation.work_item_id) {
      await handleDelegationResult(pool, delegation.work_item_id, {
        success: false,
        error: outcome.error,
      })
    }
  }

  if (delegation.to_agent_id && nextState) {
    if (nextState === 'retiring') {
      await setAgentState(pool, delegation.to_agent_id, 'retiring', `delegation ${delegation.id} completed; teardown starting`)

      // Retire ephemeral agent: revoke grants, persist outcome, keep row for audit
      await retireEphemeralAgent(pool, delegation.to_agent_id, {
        success: outcome.success,
        error: outcome.success ? undefined : outcome.error,
      })

      await setAgentState(pool, delegation.to_agent_id, 'terminated', `delegation ${delegation.id} teardown complete`)
    } else {
      await setAgentState(
        pool,
        delegation.to_agent_id,
        nextState,
        outcome.success
          ? `delegation ${delegation.id} completed`
          : `delegation ${delegation.id} failed: ${outcome.error}`,
      )
    }
  }

  // optional Gitea post — best-effort
  const tracker = delegation.result['external_tracker'] as Record<string, unknown> | undefined
    ?? delegation.request['external_tracker'] as Record<string, unknown> | undefined
  if (tracker?.['type'] === 'gitea' && process.env.GITEA_TOKEN) {
    const body = outcome.success
      ? `Task complete. Changed files: ${outcome.result.changed_files?.join(', ') ?? 'none'}`
      : `Task failed: ${outcome.error}`
    await fetch(
      `${String(tracker['base_url'])}/api/v1/repos/${String(tracker['repo'])}/issues/${String(tracker['issue_id'])}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${process.env.GITEA_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      },
    ).catch((err: unknown) => {
      console.warn('[result-router] gitea post failed:', err)
    })
  }
}

async function resolveNextAgentState(
  pool: pg.Pool,
  agentId: string | null | undefined,
): Promise<AgentState | null> {
  if (!agentId) return null

  const { rows } = await pool.query<{ tier: string | null }>(
    `SELECT tier FROM agents
     WHERE id = $1
       AND COALESCE(is_prime, false) = false`,
    [agentId],
  )
  const tier = rows[0]?.tier
  if (tier === 'ephemeral') return 'retiring'
  return 'idle'
}

async function setAgentState(
  pool: pg.Pool,
  agentId: string,
  state: AgentState,
  reason: string,
): Promise<void> {
  await pool.query(
    `UPDATE agents
     SET state = $2
     WHERE id = $1
       AND COALESCE(is_prime, false) = false`,
    [agentId, state],
  )
  await pool.query(
    `INSERT INTO runtime_events (event_type, actor, payload)
     VALUES ($1, $2, $3)`,
    ['agent.lifecycle.transition', 'result-router', JSON.stringify({ agent_id: agentId, state, reason })],
  )
}
