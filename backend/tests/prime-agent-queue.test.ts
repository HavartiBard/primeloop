import { describe, it, expect, vi, beforeEach } from 'vitest'
import type pg from 'pg'

describe('Prime Queue API', () => {
  const mockPool = {
    query: vi.fn(),
  } as unknown as pg.Pool

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listPrimeQueueItems', () => {
    it('returns all items when no filters provided', async () => {
      const mockItems = [
        {
          id: 'item-1',
          event_type: 'prime.message',
          payload: { thread_id: 'thread-1', content: 'test' },
          status: 'pending',
          actor_agent_id: null,
          attempt: 0,
          error: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]

      mockPool.query.mockResolvedValueOnce({ rows: mockItems, rowCount: 1 })

      const { listPrimeQueueItems } = await import('../src/prime-agent/queue.js')
      const items = await listPrimeQueueItems(mockPool)

      expect(items).toEqual(mockItems)
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC LIMIT'),
        [50, 0]
      )
    })

    it('filters by status when provided', async () => {
      const mockItems = [
        {
          id: 'item-1',
          event_type: 'prime.message',
          payload: {},
          status: 'failed',
          actor_agent_id: null,
          attempt: 3,
          error: 'test error',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]

      mockPool.query.mockResolvedValueOnce({ rows: mockItems, rowCount: 1 })

      const { listPrimeQueueItems } = await import('../src/prime-agent/queue.js')
      const items = await listPrimeQueueItems(mockPool, { statusFilter: 'failed' })

      expect(items).toEqual(mockItems)
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('status = $1'),
        ['failed', 50, 0]
      )
    })

    it('filters by event_type when provided', async () => {
      const mockItems = [
        {
          id: 'item-1',
          event_type: 'cron_fast',
          payload: {},
          status: 'done',
          actor_agent_id: null,
          attempt: 1,
          error: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]

      mockPool.query.mockResolvedValueOnce({ rows: mockItems, rowCount: 1 })

      const { listPrimeQueueItems } = await import('../src/prime-agent/queue.js')
      const items = await listPrimeQueueItems(mockPool, { eventTypeFilter: 'cron_fast' })

      expect(items).toEqual(mockItems)
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('event_type = $1'),
        ['cron_fast', 50, 0]
      )
    })

    it('applies both filters when provided', async () => {
      const mockItems = [
        {
          id: 'item-1',
          event_type: 'prime.message',
          payload: {},
          status: 'pending',
          actor_agent_id: null,
          attempt: 0,
          error: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]

      mockPool.query.mockResolvedValueOnce({ rows: mockItems, rowCount: 1 })

      const { listPrimeQueueItems } = await import('../src/prime-agent/queue.js')
      const items = await listPrimeQueueItems(mockPool, { 
        statusFilter: 'pending', 
        eventTypeFilter: 'prime.message' 
      })

      expect(items).toEqual(mockItems)
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('status = $1'),
        ['pending', 'prime.message', 50, 0]
      )
    })

    it('applies limit and offset for pagination', async () => {
      const mockItems = [
        {
          id: 'item-1',
          event_type: 'prime.message',
          payload: {},
          status: 'pending',
          actor_agent_id: null,
          attempt: 0,
          error: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]

      mockPool.query.mockResolvedValueOnce({ rows: mockItems, rowCount: 1 })

      const { listPrimeQueueItems } = await import('../src/prime-agent/queue.js')
      const items = await listPrimeQueueItems(mockPool, { limit: 20, offset: 10 })

      expect(items).toEqual(mockItems)
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT'),
        [20, 10]
      )
    })

    it('returns empty array when no items match', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 })

      const { listPrimeQueueItems } = await import('../src/prime-agent/queue.js')
      const items = await listPrimeQueueItems(mockPool, { statusFilter: 'failed' })

      expect(items).toEqual([])
    })
  })
})
