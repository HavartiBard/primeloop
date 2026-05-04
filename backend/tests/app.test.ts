import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import pg from 'pg'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createPool, runMigrations } from '../src/db.js'
import { createBroadcaster } from '../src/ws/broadcast.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('app smoke tests', () => {
  let pool: pg.Pool
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    const { broadcast, addClient } = createBroadcaster()
    app = createApp({
      pool,
      broadcast,
      addClient,
      langgraphApiUrl: 'http://localhost:9999',
      sshKeyPath: '/dev/null',
      sshUser: 'root',
      onAgentCreated: vi.fn(),
      onAgentDeleted: vi.fn(),
    })
  })

  afterAll(async () => {
    await pool.query('TRUNCATE event_log, approvals, agent_heartbeat')
    await pool.end()
  })

  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })

  it('GET /events returns empty array initially', async () => {
    const res = await request(app).get('/events')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('GET /agents returns array', async () => {
    const res = await request(app).get('/agents')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('POST /webhook/langgraph stores event', async () => {
    await request(app)
      .post('/webhook/langgraph')
      .send({ type: 'run.started', agent: 'langgraph', payload: { run_id: 'x1' } })

    const res = await request(app).get('/events')
    expect(res.body[0].type).toBe('run.started')
  })
})
