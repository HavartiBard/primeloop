import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pollRaclette } from '../../src/agents/raclette.js'
import type { AgentEvent } from '../../src/events/types.js'

describe('raclette poller', () => {
  const mockInsert = vi.fn(async (_pool: unknown, input: { agent: string; type: string; payload: Record<string, unknown> }) =>
    ({ id: 'id', created_at: new Date().toISOString(), ...input }) as AgentEvent
  )
  const mockBroadcast = vi.fn()
  const mockPool = {} as never
  const mockUpsertHeartbeat = vi.fn()

  beforeEach(() => vi.clearAllMocks())

  it('inserts session.active event for each active session', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessions: [
          { id: 's1', source: 'slack', user_id: 'U123', is_active: true },
          { id: 's2', source: 'cli', user_id: 'U456', is_active: false },
        ]
      }),
    })

    await pollRaclette({
      apiUrl: 'http://raclette:9119',
      sessionToken: 'tok',
      pool: mockPool,
      insertEvent: mockInsert,
      broadcast: mockBroadcast,
      upsertHeartbeat: mockUpsertHeartbeat,
      fetch: mockFetch as never,
    })

    expect(mockInsert).toHaveBeenCalledWith(mockPool, {
      agent: 'raclette',
      type: 'session.active',
      payload: expect.objectContaining({ id: 's1' }),
    })
    expect(mockInsert).toHaveBeenCalledTimes(1)
  })

  it('upserts heartbeat with healthy=true on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sessions: [] }),
    })

    await pollRaclette({
      apiUrl: 'http://raclette:9119', sessionToken: 'tok',
      pool: mockPool, insertEvent: mockInsert, broadcast: mockBroadcast,
      upsertHeartbeat: mockUpsertHeartbeat, fetch: mockFetch as never,
    })

    expect(mockUpsertHeartbeat).toHaveBeenCalledWith(mockPool, 'raclette', true)
  })

  it('upserts heartbeat with healthy=false on fetch error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    await pollRaclette({
      apiUrl: 'http://raclette:9119', sessionToken: 'tok',
      pool: mockPool, insertEvent: mockInsert, broadcast: mockBroadcast,
      upsertHeartbeat: mockUpsertHeartbeat, fetch: mockFetch as never,
    })

    expect(mockUpsertHeartbeat).toHaveBeenCalledWith(mockPool, 'raclette', false)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})
