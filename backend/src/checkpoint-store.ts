import { createHash } from 'node:crypto'
import type pg from 'pg'
import type { CheckpointContinuation, CheckpointStore } from './checkpoint.js'
import type { PrimeEvent } from './prime-agent/events.js'

interface PrimeQueueRow {
  id: string
  event_type: PrimeEvent['type']
  payload: Record<string, unknown>
}

const MATERIAL_CONTEXT_KEYS = [
  'active_work_item_count',
  'pending_delegation_ids',
  'last_event_id',
] as const

export class PostgresCheckpointStore implements CheckpointStore {
  constructor(private readonly pool: pg.Pool) {}

  async enqueueItem(event: PrimeEvent, actorAgentId?: string): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO prime_queue_items (event_type, payload, actor_agent_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [event.type, JSON.stringify(event.payload), actorAgentId ?? null]
    )

    return rows[0].id
  }

  async claimNextItem(): Promise<{ id: string; event: PrimeEvent } | null> {
    const { rows } = await this.pool.query<PrimeQueueRow>(
      `WITH next_item AS (
         SELECT id
         FROM prime_queue_items
         WHERE status = 'pending'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE prime_queue_items AS queue
       SET status = 'processing',
           attempt = queue.attempt + 1,
           updated_at = now()
       FROM next_item
       WHERE queue.id = next_item.id
       RETURNING queue.id, queue.event_type, queue.payload`
    )

    const row = rows[0]
    if (!row) {
      return null
    }

    return {
      id: row.id,
      event: {
        type: row.event_type,
        payload: row.payload,
      } as PrimeEvent,
    }
  }

  async completeItem(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE prime_queue_items
       SET status = 'done', error = NULL, updated_at = now()
       WHERE id = $1`,
      [id]
    )
  }

  async failItem(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE prime_queue_items
       SET status = 'failed', error = $2, updated_at = now()
       WHERE id = $1`,
      [id, error]
    )
  }

  async recoverStaleItems(): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE prime_queue_items
       SET status = 'pending', updated_at = now()
       WHERE status = 'processing'`
    )

    return rowCount ?? 0
  }

  async saveContinuation(opts: {
    owner_type: 'prime_session' | 'delegation'
    owner_id: string
    actor_agent_id?: string
    step: string
    context_snapshot: Record<string, unknown>
    continuation: Record<string, unknown>
  }): Promise<CheckpointContinuation> {
    const context_hash = hashContextSnapshot(opts.context_snapshot)
    const { rows } = await this.pool.query<CheckpointContinuation>(
      `INSERT INTO checkpoint_continuations (
         owner_type,
         owner_id,
         actor_agent_id,
         step,
         context_hash,
         context_snapshot,
         continuation
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING
         id,
         owner_type,
         owner_id::text,
         actor_agent_id::text,
         step,
         context_hash,
         context_snapshot,
         continuation,
         status,
         expires_at::text,
         created_at::text,
         resumed_at::text`,
      [
        opts.owner_type,
        opts.owner_id,
        opts.actor_agent_id ?? null,
        opts.step,
        context_hash,
        JSON.stringify(opts.context_snapshot),
        JSON.stringify(opts.continuation),
      ]
    )

    return normalizeContinuation(rows[0])
  }

  async loadContinuation(ownerId: string): Promise<CheckpointContinuation | null> {
    const { rows } = await this.pool.query<CheckpointContinuation>(
      `SELECT
         id,
         owner_type,
         owner_id::text,
         actor_agent_id::text,
         step,
         context_hash,
         context_snapshot,
         continuation,
         status,
         expires_at::text,
         created_at::text,
         resumed_at::text
       FROM checkpoint_continuations
       WHERE owner_id = $1
         AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [ownerId]
    )

    const row = rows[0]
    if (!row) {
      return null
    }

    const continuation = normalizeContinuation(row)
    if (continuation.expires_at && new Date(continuation.expires_at).getTime() < Date.now()) {
      await this.discardContinuation(continuation.id)
      return null
    }

    return continuation
  }

  async markResumed(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE checkpoint_continuations
       SET status = 'resumed', resumed_at = now()
       WHERE id = $1`,
      [id]
    )
  }

  async discardContinuation(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE checkpoint_continuations
       SET status = 'discarded'
       WHERE id = $1`,
      [id]
    )
  }

  contextChanged(saved: CheckpointContinuation, fresh: Record<string, unknown>): boolean {
    const freshHash = hashContextSnapshot(fresh)
    if (freshHash === saved.context_hash) {
      return false
    }

    for (const key of MATERIAL_CONTEXT_KEYS) {
      if (!materialFieldEqual(saved.context_snapshot[key], fresh[key])) {
        return true
      }
    }

    return false
  }
}

export function hashContextSnapshot(snapshot: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(materializeSnapshot(snapshot))).digest('hex')
}

function normalizeContinuation(row: CheckpointContinuation): CheckpointContinuation {
  return {
    ...row,
    actor_agent_id: row.actor_agent_id ?? undefined,
    expires_at: row.expires_at ?? undefined,
    resumed_at: row.resumed_at ?? undefined,
  }
}

function materializeSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  return {
    active_work_item_count:
      typeof snapshot['active_work_item_count'] === 'number' ? snapshot['active_work_item_count'] : 0,
    pending_delegation_ids: normalizeStringArray(snapshot['pending_delegation_ids']),
    last_event_id: typeof snapshot['last_event_id'] === 'string' ? snapshot['last_event_id'] : null,
  }
}

function materialFieldEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    const leftItems = normalizeStringArray(left)
    const rightItems = normalizeStringArray(right)
    return leftItems.length === rightItems.length && leftItems.every((value, index) => value === rightItems[index])
  }

  return left === right
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => String(item))
}
