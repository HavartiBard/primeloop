import request from 'supertest'
import { describe, expect, it, beforeEach } from 'vitest'
import { generateAuthToken } from '../../src/launcher/auth.js'
import { LauncherServer } from '../../src/launcher/server.js'
import type { RuntimeManager } from '../../src/launcher/runtime-manager.js'

function createRuntimeManagerStub(): Pick<RuntimeManager, 'provisionRuntime' | 'inspectRuntime' | 'restartRuntime' | 'teardownRuntime'> {
  const runtimeStatus = {
    agentId: 'agent-1',
    state: 'ready' as const,
    healthStatus: 'healthy' as const,
    containerIdentity: 'launcher-agent-1',
    sessionEndpoint: 'http://launcher-agent-1:8080',
    workdir: '/workspace/agent-1',
    mounts: [{ path: '/workspace/agent-1', mode: 'rw' as const, purpose: 'worktree' }],
    networkPolicy: { mode: 'default-deny' as const, allowlist: [] },
  }

  return {
    provisionRuntime: async () => ({
      created: true,
      agentId: 'agent-1',
      sessionEndpoint: runtimeStatus.sessionEndpoint,
      runtimeStatus,
      containerIdentity: runtimeStatus.containerIdentity,
    }),
    inspectRuntime: async () => runtimeStatus,
    restartRuntime: async () => ({ ...runtimeStatus, lastTransitionReason: 'Restart completed' }),
    teardownRuntime: async () => {},
  }
}

describe('Launcher API routes', () => {
  const token = generateAuthToken('agent-1')
  let app: ReturnType<LauncherServer['getApp']>

  beforeEach(() => {
    const server = new LauncherServer(createRuntimeManagerStub() as RuntimeManager)
    app = server.getApp()
  })

  it('allows unauthenticated health checks', async () => {
    const res = await request(app).get('/health')
    expect([200, 500]).toContain(res.status)
    if (res.status === 200) {
      expect(res.body).toHaveProperty('adapter')
    }
  })

  it('rejects provisioning without auth', async () => {
    const res = await request(app).post('/agents').send({})
    expect(res.status).toBe(401)
  })

  it('provisions with auth and returns 201', async () => {
    const res = await request(app)
      .post('/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({
        agentId: 'agent-1',
        runtimeFamily: 'pi',
        workdir: '/workspace/agent-1',
        env: {},
      })

    expect(res.status).toBe(201)
    expect(res.body.agentId).toBe('agent-1')
    expect(res.body.sessionEndpoint).toBe('http://launcher-agent-1:8080')
  })

  it('inspects an existing runtime', async () => {
    const res = await request(app)
      .get('/agents/agent-1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.agentId).toBe('agent-1')
  })

  it('restarts an existing runtime', async () => {
    const res = await request(app)
      .post('/agents/agent-1/restart')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.lastTransitionReason).toBe('Restart completed')
  })

  it('tears down an existing runtime', async () => {
    const res = await request(app)
      .delete('/agents/agent-1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(204)
  })
})
