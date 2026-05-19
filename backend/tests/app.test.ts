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
      primeQueue: {
        enqueue: vi.fn(async () => {}),
        process: vi.fn(),
        close: vi.fn(async () => {}),
      },
      onAgentCreated: vi.fn(),
      onAgentDeleted: vi.fn(),
    })
  })

  afterAll(async () => {
    await pool.query(`
      TRUNCATE
        runtime_events,
        artifacts,
        audit_runs,
        audit_loops,
        tool_invocations,
        permission_rules,
        tool_servers,
        delegations,
        work_items,
        memories,
        thread_messages,
        threads,
        chief_profiles,
        portal_state,
        event_log,
        approvals,
        agent_heartbeat
    `)
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

  it('GET /api/portal/state returns persistent portal state', async () => {
    const res = await request(app).get('/api/portal/state')
    expect(res.status).toBe(200)
    expect(res.body.chief_profile.name).toBe('Prime')
    expect(Array.isArray(res.body.work_items)).toBe(true)
  })

  it('runtime APIs create a thread, message, work item, and delegation', async () => {
    const thread = await request(app)
      .post('/api/threads')
      .send({ title: 'Homelab operations' })
    expect(thread.status).toBe(201)
    expect(thread.body.id).toBeTruthy()

    const message = await request(app)
      .post(`/api/threads/${thread.body.id}/messages`)
      .send({ role: 'user', sender: 'james', content: 'Audit open work.' })
    expect(message.status).toBe(201)
    expect(message.body.thread_id).toBe(thread.body.id)

    const work = await request(app)
      .post('/api/work-items')
      .send({ title: 'Audit open work', thread_id: thread.body.id, lane: 'operations' })
    expect(work.status).toBe(201)
    expect(work.body.title).toBe('Audit open work')

    const delegation = await request(app)
      .post('/api/delegations')
      .send({ work_item_id: work.body.id, capability: 'operational-audit', request: { scope: 'open-work' } })
    expect(delegation.status).toBe(201)
    expect(delegation.body.capability).toBe('operational-audit')

    const overview = await request(app).get('/api/runtime/overview')
    expect(overview.status).toBe(200)
    expect(overview.body.prime.name).toBe('Prime')
    expect(Array.isArray(overview.body.recent_events)).toBe(true)
  })
})
