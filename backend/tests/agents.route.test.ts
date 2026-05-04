import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import express from 'express'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { createAgentsRouter } from '../src/routes/agents.js'
import type { SshExecFn } from '../src/lifecycle.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

const mockExec: SshExecFn = vi.fn().mockResolvedValue({ ok: true, output: 'restarted' })

describe('agents registry router', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    app = express()
    app.use(express.json())
    app.use('/api/agents', createAgentsRouter({
      pool,
      sshKeyPath: '/dev/null',  // not used, exec is mocked in router via mockExec
      sshUser: 'root',
      execFn: mockExec,  // inject mock exec
      onAgentCreated: vi.fn(),
      onAgentDeleted: vi.fn(),
    }))
  })

  afterAll(async () => {
    await pool.query('DELETE FROM agents')
    await pool.end()
  })

  it('GET / returns empty array initially', async () => {
    const res = await request(app).get('/api/agents')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('POST / creates an agent', async () => {
    const res = await request(app).post('/api/agents').send({
      name: 'test-agent',
      type: 'hermes',
      host: 'myhost.local',
      container_name: 'my-container',
      config: { api_url: 'http://example.com' },
    })
    expect(res.status).toBe(201)
    expect(res.body.name).toBe('test-agent')
    expect(res.body.id).toBeTruthy()
  })

  it('POST / returns 400 when name/type missing', async () => {
    const res = await request(app).post('/api/agents').send({ host: 'x' })
    expect(res.status).toBe(400)
  })

  it('GET / returns created agent', async () => {
    const res = await request(app).get('/api/agents')
    expect(res.body.some((a: any) => a.name === 'test-agent')).toBe(true)
  })

  it('PUT /:id updates an agent', async () => {
    const list = await request(app).get('/api/agents')
    const agent = list.body.find((a: any) => a.name === 'test-agent')
    const res = await request(app).put(`/api/agents/${agent.id}`).send({ host: 'newhost.local' })
    expect(res.status).toBe(200)
    expect(res.body.host).toBe('newhost.local')
  })

  it('POST /:id/lifecycle restarts agent', async () => {
    const list = await request(app).get('/api/agents')
    const agent = list.body.find((a: any) => a.name === 'test-agent')
    const res = await request(app).post(`/api/agents/${agent.id}/lifecycle`).send({ action: 'restart' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('POST /:id/lifecycle returns 400 for invalid action', async () => {
    const list = await request(app).get('/api/agents')
    const agent = list.body.find((a: any) => a.name === 'test-agent')
    const res = await request(app).post(`/api/agents/${agent.id}/lifecycle`).send({ action: 'explode' })
    expect(res.status).toBe(400)
  })

  it('POST /:id/lifecycle returns 400 if no host/container', async () => {
    // Create an agent with no host
    await request(app).post('/api/agents').send({ name: 'no-host-agent', type: 'generic' })
    const list = await request(app).get('/api/agents')
    const agent = list.body.find((a: any) => a.name === 'no-host-agent')
    const res = await request(app).post(`/api/agents/${agent.id}/lifecycle`).send({ action: 'restart' })
    expect(res.status).toBe(400)
  })

  it('DELETE /:id removes an agent', async () => {
    const list = await request(app).get('/api/agents')
    const agent = list.body.find((a: any) => a.name === 'test-agent')
    const res = await request(app).delete(`/api/agents/${agent.id}`)
    expect(res.status).toBe(204)
  })
})
