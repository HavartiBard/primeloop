import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createLanggraphRouter } from '../../src/agents/langgraph.js'
import type { AgentEvent } from '../../src/events/types.js'

describe('langgraph webhook receiver', () => {
  const mockInsert = vi.fn(async (_pool: unknown, input: { agent: string; type: string; payload: Record<string, unknown> }) => {
    return { id: 'test-id', created_at: new Date().toISOString(), ...input } as AgentEvent
  })
  const mockBroadcast = vi.fn()
  const mockPool = {} as never

  const app = express()
  app.use(express.json())
  app.use('/webhook/langgraph', createLanggraphRouter({
    pool: mockPool,
    insertEvent: mockInsert,
    broadcast: mockBroadcast,
  }))

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts a valid webhook and returns 200', async () => {
    const res = await request(app)
      .post('/webhook/langgraph')
      .send({ type: 'run.started', agent: 'langgraph', payload: { run_id: 'abc' } })
    expect(res.status).toBe(200)
  })

  it('inserts an event on valid webhook', async () => {
    await request(app)
      .post('/webhook/langgraph')
      .send({ type: 'run.started', agent: 'langgraph', payload: { run_id: 'abc' } })
    expect(mockInsert).toHaveBeenCalledWith(mockPool, {
      agent: 'langgraph',
      type: 'run.started',
      payload: { run_id: 'abc' },
    })
  })

  it('broadcasts event after insert', async () => {
    await request(app)
      .post('/webhook/langgraph')
      .send({ type: 'run.started', agent: 'langgraph', payload: { run_id: 'abc' } })
    expect(mockBroadcast).toHaveBeenCalledOnce()
  })

  it('returns 400 on missing type', async () => {
    const res = await request(app)
      .post('/webhook/langgraph')
      .send({ agent: 'langgraph', payload: {} })
    expect(res.status).toBe(400)
  })
})

describe('langgraph approval proxy', () => {
  const mockInsert = vi.fn(async (_pool: unknown, input: { agent: string; type: string; payload: Record<string, unknown> }) =>
    ({ id: 'id', created_at: new Date().toISOString(), ...input }) as AgentEvent
  )
  const mockBroadcast = vi.fn()
  const mockPool = {} as never

  beforeEach(() => vi.clearAllMocks())

  it('GET /approvals/pending proxies to langgraph-agent', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ approval_id: 'a1', run_id: 'r1', action: 'write_file', status: 'pending', created_at: '' }],
    })
    const app2 = express()
    app2.use(express.json())
    app2.use('/webhook/langgraph', createLanggraphRouter({
      pool: mockPool, insertEvent: mockInsert, broadcast: mockBroadcast,
      langgraphApiUrl: 'http://langgraph:8000', fetch: mockFetch as never,
    }))

    const res = await request(app2).get('/webhook/langgraph/approvals/pending')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(mockFetch).toHaveBeenCalledWith('http://langgraph:8000/approvals/pending', expect.any(Object))
  })

  it('POST /approvals/:id/approve proxies and emits approval.decided event', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ approval_id: 'a1', run_id: 'r1', action: 'write_file', status: 'approved', created_at: '', decided_at: '' }),
    })
    const app2 = express()
    app2.use(express.json())
    app2.use('/webhook/langgraph', createLanggraphRouter({
      pool: mockPool, insertEvent: mockInsert, broadcast: mockBroadcast,
      langgraphApiUrl: 'http://langgraph:8000', fetch: mockFetch as never,
    }))

    const res = await request(app2).post('/webhook/langgraph/approvals/a1/approve')
    expect(res.status).toBe(200)
    expect(mockInsert).toHaveBeenCalledWith(mockPool, expect.objectContaining({ type: 'approval.decided' }))
  })
})
