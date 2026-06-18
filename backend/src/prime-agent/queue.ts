import type { CheckpointStore } from '../checkpoint.js'
import type { PrimeEvent } from './events.js'
import type pg from 'pg'

export interface PrimeQueueItem {
  id: string
  event_type: string
  payload: Record<string, unknown>
  status: 'pending' | 'processing' | 'done' | 'failed'
  actor_agent_id: string | null
  attempt: number
  error: string | null
  created_at: string
  updated_at: string
}

export interface ListPrimeQueueItemsOptions {
  statusFilter?: string
  eventTypeFilter?: string
  limit?: number
  offset?: number
}

export async function listPrimeQueueItems(
  pool: pg.Pool,
  options: ListPrimeQueueItemsOptions = {}
): Promise<PrimeQueueItem[]> {
  const { statusFilter, eventTypeFilter, limit = 50, offset = 0 } = options

  let sql = 'SELECT * FROM prime_queue_items WHERE 1=1'
  const params: unknown[] = []
  let paramIndex = 1

  if (statusFilter) {
    params.push(statusFilter)
    sql += ` AND status = $${paramIndex++}`
  }

  if (eventTypeFilter) {
    params.push(eventTypeFilter)
    sql += ` AND event_type = $${paramIndex++}`
  }

  sql += ' ORDER BY created_at DESC LIMIT $' + paramIndex++
  params.push(limit)
  sql += ' OFFSET $' + paramIndex++
  params.push(offset)

  const { rows } = await pool.query<PrimeQueueItem>(sql, params)
  return rows
}

export interface PrimeQueue {
  enqueue(event: PrimeEvent): Promise<void>
  process(handler: (event: PrimeEvent) => Promise<void> | void): void
  close(): Promise<void>
}

class InMemoryPrimeQueue implements PrimeQueue {
  private readonly backlog: PrimeEvent[] = []
  private processing = false
  private closed = false
  private handler?: (event: PrimeEvent) => Promise<void> | void

  async enqueue(event: PrimeEvent): Promise<void> {
    if (this.closed) {
      throw new Error('Prime queue is closed')
    }

    this.backlog.push(event)
    await this.flush()
  }

  process(handler: (event: PrimeEvent) => Promise<void> | void): void {
    if (this.closed) {
      throw new Error('Prime queue is closed')
    }

    this.handler = handler
    void this.flush()
  }

  async close(): Promise<void> {
    this.closed = true
    this.handler = undefined
    this.backlog.length = 0
  }

  private async flush(): Promise<void> {
    if (this.processing || !this.handler || this.closed) {
      return
    }

    this.processing = true

    try {
      while (!this.closed && this.backlog.length > 0) {
        const event = this.backlog.shift()
        if (!event) break
        await this.handler(event)
      }
    } finally {
      this.processing = false
    }
  }
}

export function createInMemoryPrimeQueue(): PrimeQueue {
  return new InMemoryPrimeQueue()
}

class PostgresPrimeQueue implements PrimeQueue {
  private closed = false
  private handler?: (event: PrimeEvent) => Promise<void> | void
  private processing = false

  constructor(private readonly store: CheckpointStore) {}

  async enqueue(event: PrimeEvent): Promise<void> {
    if (this.closed) {
      throw new Error('Prime queue is closed')
    }

    await this.store.enqueueItem(event)
    await this.drain()
  }

  process(handler: (event: PrimeEvent) => Promise<void> | void): void {
    if (this.closed) {
      throw new Error('Prime queue is closed')
    }

    this.handler = handler
    void this.drain()
  }

  async close(): Promise<void> {
    this.closed = true
    this.handler = undefined
  }

  private async drain(): Promise<void> {
    if (this.processing || !this.handler || this.closed) {
      return
    }

    this.processing = true

    try {
      while (!this.closed) {
        const item = await this.store.claimNextItem()
        if (!item) break

        try {
          await this.handler(item.event)
          await this.store.completeItem(item.id)
        } catch (error: unknown) {
          await this.store.failItem(
            item.id,
            error instanceof Error ? error.message : String(error),
          )
        }
      }
    } finally {
      this.processing = false
    }
  }
}

export function createPostgresPrimeQueue(store: CheckpointStore): PrimeQueue {
  return new PostgresPrimeQueue(store)
}
