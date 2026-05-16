import type pg from 'pg'
import { appendThreadMessage, type Delegation } from '../runtime.js'
import type { PrimeQueue } from '../prime-agent/queue.js'
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
