import type pg from 'pg'
import { appendThreadMessage, type Delegation } from '../runtime.js'
import type { PrimeQueue } from '../prime-agent/queue.js'
import type { AgentState } from '../registry.js'
import type { TaskResult } from './harness.js'

export interface ResultRouterDeps {
  pool: pg.Pool
  primeQueue: PrimeQueue
}

export type ResultOutcome =
  | { success: true; result: TaskResult }
  | { success: false; error: string }

export async function routeResult(
  deps: ResultRouterDeps,
  delegation: Delegation,
  outcome: ResultOutcome,
): Promise<void> {
  const { pool, primeQueue } = deps
  const threadId = typeof delegation.request['thread_id'] === 'string'
    ? delegation.request['thread_id']
    : undefined
  const nextState = await resolveNextAgentState(pool, delegation.to_agent_id, outcome.success)

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
  }

  if (delegation.to_agent_id && nextState) {
    if (nextState === 'retiring') {
      await setAgentState(pool, delegation.to_agent_id, 'retiring', `delegation ${delegation.id} completed; teardown starting`)
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
  success: boolean,
): Promise<AgentState | null> {
  if (!agentId) return null
  if (!success) return 'error'

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
