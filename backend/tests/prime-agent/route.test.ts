import { beforeEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'

const configMocks = vi.hoisted(() => ({
  getPrimeConfig: vi.fn(),
  updatePrimeConfig: vi.fn(),
}))

const sessionMocks = vi.hoisted(() => ({
  listPrimeSessions: vi.fn(),
}))

vi.mock('../../src/prime-agent/config.js', () => ({
  getPrimeConfig: configMocks.getPrimeConfig,
  updatePrimeConfig: configMocks.updatePrimeConfig,
}))

vi.mock('../../src/prime-agent/session.js', () => ({
  listPrimeSessions: sessionMocks.listPrimeSessions,
}))

import { createPrimeAgentRouter } from '../../src/routes/prime-agent.js'

describe('prime-agent router', () => {
  const pool = {} as pg.Pool
  const queue = {
    enqueue: vi.fn(async () => {}),
    process: vi.fn(),
    close: vi.fn(async () => {}),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET /config returns the singleton config', async () => {
    configMocks.getPrimeConfig.mockResolvedValue({
      id: 'default',
      enabled: false,
      debounce_window_ms: 10000,
    })

    const res = await invokeRoute('get', '/config')

    expect(res.statusCode).toBe(200)
    expect(res.body.id).toBe('default')
    expect(res.body.enabled).toBe(false)
  })

  it('PATCH /config updates and returns config', async () => {
    configMocks.updatePrimeConfig.mockResolvedValue({
      id: 'default',
      enabled: true,
      debounce_window_ms: 5000,
      status: 'running',
    })

    const res = await invokeRoute('patch', '/config', {
      enabled: true,
      debounce_window_ms: 5000,
      status: 'running',
    })

    expect(res.statusCode).toBe(200)
    expect(configMocks.updatePrimeConfig).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        enabled: true,
        debounce_window_ms: 5000,
        status: 'running',
      })
    )
    expect(res.body.enabled).toBe(true)
  })

  it('PATCH /config returns 400 for malformed config patches', async () => {
    const res = await invokeRoute('patch', '/config', {
      provider_routing: [],
    })

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({
      error: 'invalid prime config patch: provider_routing must be an object',
    })
    expect(configMocks.updatePrimeConfig).not.toHaveBeenCalled()
  })

  it('GET /sessions returns stored sessions', async () => {
    sessionMocks.listPrimeSessions.mockResolvedValue([
      {
        id: 'session-1',
        trigger_type: 'chief_message',
      },
    ])

    const res = await invokeRoute('get', '/sessions')

    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].trigger_type).toBe('chief_message')
  })

  it('POST /events enqueues a valid Phase A event', async () => {
    configMocks.getPrimeConfig.mockResolvedValue({ enabled: true })

    const res = await invokeRoute('post', '/events', {
      type: 'chief.message',
      payload: {
        thread_id: 'thread-1',
        message_id: 'message-1',
        content: 'Handle this',
        sender: 'james',
      },
    })

    expect(res.statusCode).toBe(202)
    expect(res.body).toEqual({ queued: true, event_type: 'chief.message' })
    expect(queue.enqueue).toHaveBeenCalledWith({
      type: 'chief.message',
      payload: {
        thread_id: 'thread-1',
        message_id: 'message-1',
        content: 'Handle this',
        sender: 'james',
      },
    })
  })

  it('POST /events returns 400 for a bad payload', async () => {
    configMocks.getPrimeConfig.mockResolvedValue({ enabled: true })

    const res = await invokeRoute('post', '/events', {
      type: 'fleet.delegation.failed',
      payload: {
        delegation_id: 'delegation-1',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain('invalid prime event')
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  it('POST /events returns 409 when Prime Agent is disabled', async () => {
    configMocks.getPrimeConfig.mockResolvedValue({ enabled: false })

    const res = await invokeRoute('post', '/events', {
      type: 'cron.fast',
      payload: {
        triggered_at: '2026-05-09T23:30:00.000Z',
      },
    })

    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'prime agent is disabled' })
    expect(queue.enqueue).not.toHaveBeenCalled()
  })

  async function invokeRoute(
    method: 'get' | 'patch' | 'post',
    url: string,
    body?: unknown
  ): Promise<{ statusCode: number; body: unknown }> {
    const router = createPrimeAgentRouter({ pool, queue })

    return await new Promise((resolve, reject) => {
      const req = {
        method: method.toUpperCase(),
        url,
        originalUrl: url,
        path: url,
        body,
        query: {},
        params: {},
        headers: {},
      }

      const result = {
        statusCode: 200,
        body: undefined as unknown,
      }

      const res = {
        status(code: number) {
          result.statusCode = code
          return this
        },
        json(payload: unknown) {
          result.body = payload
          resolve(result)
          return this
        },
      }

      router.handle(req as never, res as never, (err?: unknown) => {
        if (err) reject(err)
        else resolve(result)
      })
    })
  }
})
