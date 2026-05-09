import { describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import type pg from 'pg'
import { createControlPlaneRouter } from '../src/routes/control-plane.js'

const baseAgent = {
  id: 'agent-1',
  name: 'external-agent',
  type: 'worker',
  runtime_family: 'generic-http',
  execution_mode: 'external',
  capabilities: ['implementation'],
  config: {},
  enabled: true,
  created_at: new Date(0).toISOString(),
}

describe('control-plane HTTP bridge', () => {
  it('lists tools for an authenticated agent token', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ ...baseAgent, token: 'secret-token' }],
      }),
    } as unknown as pg.Pool
    const app = express()
    app.use(express.json())
    app.use('/api/control-plane', createControlPlaneRouter({ pool }))

    const res = await request(app)
      .get('/api/control-plane/tools')
      .set('Authorization', 'Bearer secret-token')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.tools)).toBe(true)
    expect(res.body.tools.some((tool: { name: string }) => tool.name === 'memory_store')).toBe(true)
  })

  it('calls a control-plane tool for an authenticated agent token', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ ...baseAgent, token: 'secret-token', soul: 'Be direct.' }],
      }),
    } as unknown as pg.Pool
    const app = express()
    app.use(express.json())
    app.use('/api/control-plane', createControlPlaneRouter({ pool }))

    const res = await request(app)
      .post('/api/control-plane/tools/soul_read')
      .set('Authorization', 'Bearer secret-token')
      .send({ arguments: {} })

    expect(res.status).toBe(200)
    expect(res.body.tool).toBe('soul_read')
    expect(res.body.structuredContent.agent_id).toBe('agent-1')
  })

  it('rejects missing or invalid bearer tokens', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as pg.Pool
    const app = express()
    app.use(express.json())
    app.use('/api/control-plane', createControlPlaneRouter({ pool }))

    const missing = await request(app).get('/api/control-plane/tools')
    expect(missing.status).toBe(401)

    const invalid = await request(app)
      .get('/api/control-plane/tools')
      .set('Authorization', 'Bearer nope')
    expect(invalid.status).toBe(401)
  })
})
