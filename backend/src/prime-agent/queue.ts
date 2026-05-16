import type { CheckpointStore } from '../checkpoint.js'
import type { PrimeEvent } from './events.js'

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
