import { beforeEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'

const configMocks = vi.hoisted(() => ({
  getPrimeConfig: vi.fn(),
  updatePrimeConfig: vi.fn(),
}))

const sessionMocks = vi.hoisted(() => ({
  getPrimeSession: vi.fn(),
  listPrimeSessions: vi.fn(),
}))

const moduleMocks = vi.hoisted(() => ({
  getPrimeModuleConfig: vi.fn(),
  listPrimeModuleConfigAudits: vi.fn(),
  listPrimeModuleConfigs: vi.fn(),
  updatePrimeModuleConfig: vi.fn(),
}))

vi.mock('../../src/prime-agent/config.js', () => ({
  getPrimeConfig: configMocks.getPrimeConfig,
  updatePrimeConfig: configMocks.updatePrimeConfig,
}))

vi.mock('../../src/prime-agent/session.js', () => ({
  getPrimeSession: sessionMocks.getPrimeSession,
  listPrimeSessions: sessionMocks.listPrimeSessions,
}))

vi.mock('../../src/prime-agent/modules/registry.js', () => ({
  getPrimeModuleConfig: moduleMocks.getPrimeModuleConfig,
  listPrimeModuleConfigAudits: moduleMocks.listPrimeModuleConfigAudits,
  listPrimeModuleConfigs: moduleMocks.listPrimeModuleConfigs,
  updatePrimeModuleConfig: moduleMocks.updatePrimeModuleConfig,
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
        trigger_type: 'prime_message',
        module_runs: [],
      },
    ])

    const res = await invokeRoute('get', '/sessions')

    expect(res.statusCode).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].trigger_type).toBe('prime_message')
  })

  it('GET /sessions/:id returns a stored session with module runs', async () => {
    sessionMocks.getPrimeSession.mockResolvedValue({
      id: 'session-1',
      trigger_type: 'prime_message',
      trigger_payload: {},
      prompt_templates: {},
      actions_taken: [],
      token_count: 0,
      status: 'completed',
      started_at: '2026-05-18T00:00:00.000Z',
      module_runs: [
        {
          id: 'run-1',
          session_id: 'session-1',
          run_index: 0,
          module_id: 'trigger.default',
          stage: 'trigger',
          version: '1.0.0',
          mode: 'active',
          status: 'completed',
          started_at: '2026-05-18T00:00:00.000Z',
          completed_at: '2026-05-18T00:00:01.000Z',
        },
      ],
    })

    const res = await invokeRoute('get', '/sessions/session-1')

    expect(res.statusCode).toBe(200)
    expect(sessionMocks.getPrimeSession).toHaveBeenCalledWith(pool, 'session-1')
    expect((res.body as { module_runs: unknown[] }).module_runs).toHaveLength(1)
  })

  it('GET /modules returns persisted module configs', async () => {
    moduleMocks.listPrimeModuleConfigs.mockResolvedValue([
      {
        module_id: 'trigger.event-ingress',
        stage: 'trigger',
        default_version: '1.0.0',
        enabled: true,
        rollout_mode: 'active',
        config: {},
      },
    ])

    const res = await invokeRoute('get', '/modules')

    expect(res.statusCode).toBe(200)
    expect((res.body as Array<{ module_id: string }>)[0].module_id).toBe('trigger.event-ingress')
  })

  it('PATCH /modules/:id updates a persisted module config', async () => {
    moduleMocks.getPrimeModuleConfig.mockResolvedValue({
      module_id: 'feedback.approval-continuation',
    })
    moduleMocks.updatePrimeModuleConfig.mockResolvedValue({
      module_id: 'feedback.approval-continuation',
      stage: 'feedback',
      default_version: '1.0.0',
      pinned_version: '1.0.0',
      enabled: false,
      rollout_mode: 'shadow',
      config: { note: 'disabled for rollout' },
    })

    const res = await invokeRoute('patch', '/modules/feedback.approval-continuation', {
      enabled: false,
      rollout_mode: 'shadow',
      pinned_version: '1.0.0',
      config: { note: 'disabled for rollout' },
    })

    expect(res.statusCode).toBe(200)
    expect(moduleMocks.updatePrimeModuleConfig).toHaveBeenCalledWith(
      pool,
      'feedback.approval-continuation',
      {
        enabled: false,
        rollout_mode: 'shadow',
        pinned_version: '1.0.0',
        config: { note: 'disabled for rollout' },
      },
      'api'
    )
  })

  it('PATCH /modules/:id returns 400 for invalid required-module changes', async () => {
    moduleMocks.getPrimeModuleConfig.mockResolvedValue({
      module_id: 'decision.llm-router',
    })
    moduleMocks.updatePrimeModuleConfig.mockRejectedValue(
      new Error('invalid prime module patch: decision.llm-router must remain enabled and active')
    )

    const res = await invokeRoute('patch', '/modules/decision.llm-router', {
      rollout_mode: 'shadow',
    })

    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({
      error: 'invalid prime module patch: decision.llm-router must remain enabled and active',
    })
  })

  it('GET /modules/:id/audit returns persisted module audits', async () => {
    moduleMocks.getPrimeModuleConfig.mockResolvedValue({
      module_id: 'feedback.approval-continuation',
    })
    moduleMocks.listPrimeModuleConfigAudits.mockResolvedValue([
      {
        id: 'audit-1',
        module_id: 'feedback.approval-continuation',
        actor: 'james',
        changed_fields: ['rollout_mode'],
        previous_config: { rollout_mode: 'active' },
        next_config: { rollout_mode: 'shadow' },
        created_at: '2026-05-18T00:00:00.000Z',
      },
    ])

    const res = await invokeRoute('get', '/modules/feedback.approval-continuation/audit')

    expect(res.statusCode).toBe(200)
    expect((res.body as Array<{ actor: string }>)[0].actor).toBe('james')
  })

  it('POST /events enqueues a valid Phase A event', async () => {
    configMocks.getPrimeConfig.mockResolvedValue({ enabled: true })

    const res = await invokeRoute('post', '/events', {
      type: 'prime.message',
      payload: {
        thread_id: 'thread-1',
        message_id: 'message-1',
        content: 'Handle this',
        sender: 'james',
      },
    })

    expect(res.statusCode).toBe(202)
    expect(res.body).toEqual({ queued: true, event_type: 'prime.message' })
    expect(queue.enqueue).toHaveBeenCalledWith({
      type: 'prime.message',
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
    const sessionMatch = url.match(/^\/sessions\/([^/]+)$/)
    const moduleAuditMatch = url.match(/^\/modules\/([^/]+)\/audit$/)
    const moduleMatch = !moduleAuditMatch ? url.match(/^\/modules\/([^/]+)$/) : null

    return await new Promise((resolve, reject) => {
      const req = {
        method: method.toUpperCase(),
        url,
        originalUrl: url,
        path: url,
        body,
        query: {},
        params: sessionMatch
          ? { id: sessionMatch[1] }
          : moduleAuditMatch
            ? { id: moduleAuditMatch[1] }
            : moduleMatch
              ? { id: moduleMatch[1] }
              : {},
        headers: {},
        header(name: string) {
          const value = (this.headers as Record<string, string | undefined>)[name.toLowerCase()]
          return value
        },
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
