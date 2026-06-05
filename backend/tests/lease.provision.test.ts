import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { createDelegation, createWorkItem, getDelegation } from '../src/runtime.js'
import { insertAgent, type RegistryAgent } from '../src/registry.js'
import { OpenCodeProcessManager } from '../src/opencode/process-manager.js'
import { runDelegation, setDelegationRuntimeStarter } from '../src/delegation-runner.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('lease.provision (T042)', () => {
  let pool: pg.Pool
  let rootDir: string
  let previousFetch: typeof global.fetch | undefined

  function buildAgent(worktreePath: string): Omit<RegistryAgent, 'id' | 'created_at'> {
    return {
      name: 'Provisioned Durable Agent',
      type: 'codex-thread',
      provider_id: undefined,
      tier: 'durable',
      role: 'implementation',
      state: 'idle',
      persona_file: 'AGENTS.md',
      runtime_family: 'codex-app-server',
      execution_mode: 'local',
      endpoint: 'http://127.0.0.1:4600',
      capabilities: ['implementation'],
      config: {},
      enabled: true,
      local_port: 4600,
      worktree_path: worktreePath,
      workspace_root: undefined,
      system_prompt: 'Ship working code',
      soul: 'Calm builder',
      host: undefined,
      container_name: undefined,
      ssh_user: undefined,
    }
  }

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    previousFetch = global.fetch
  })

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'lease-provision-'))
    process.env.LAZY_PROVISIONING = '1'
    await pool.query(`DELETE FROM runtime_events WHERE actor IN ('runtime-lease', 'process-manager', 'agent.lifecycle.transition')`)
    await pool.query('DELETE FROM delegations')
    await pool.query('DELETE FROM work_items')
    await pool.query('DELETE FROM thread_messages')
    await pool.query('DELETE FROM threads')
    await pool.query('DELETE FROM tool_grants')
    await pool.query('DELETE FROM agent_tokens')
    await pool.query('DELETE FROM agent_runtime_configs')
    await pool.query('DELETE FROM runtime_leases')
    await pool.query("DELETE FROM agents WHERE COALESCE(is_prime, false) = false")
  })

  afterEach(async () => {
    setDelegationRuntimeStarter(null)
    global.fetch = previousFetch as typeof global.fetch
    delete process.env.LAZY_PROVISIONING
    await rm(rootDir, { recursive: true, force: true })
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM runtime_events WHERE actor IN ('runtime-lease', 'process-manager', 'agent.lifecycle.transition')`)
    await pool.query('DELETE FROM delegations')
    await pool.query('DELETE FROM work_items')
    await pool.query('DELETE FROM thread_messages')
    await pool.query('DELETE FROM threads')
    await pool.query('DELETE FROM tool_grants')
    await pool.query('DELETE FROM agent_tokens')
    await pool.query('DELETE FROM agent_runtime_configs')
    await pool.query('DELETE FROM runtime_leases')
    await pool.query("DELETE FROM agents WHERE COALESCE(is_prime, false) = false")
    await pool.end()
  })

  it('provisions on routed work within readiness budget while preserving agent identity', async () => {
    const child = { kill: vi.fn().mockReturnValue(true), on: vi.fn(), stdout: null, stderr: null }
    const spawnFn = vi.fn().mockReturnValue(child)
    const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })

    global.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.endsWith('/session') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'session-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/session/session-1/message') && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/event?session_id=session-1')) {
        return new Response('event: session.status\ndata: {"status":"complete"}\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      }
      return new Response(JSON.stringify({ error: `unexpected fetch ${url}` }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }) as typeof global.fetch

    const repoRoot = path.join(rootDir, 'repo')
    const agentsRoot = path.join(rootDir, 'agents')
    const worktreePath = path.join(agentsRoot, 'provisioned-durable-agent')
    const agent = await insertAgent(pool, buildAgent(worktreePath))

    const manager = new OpenCodeProcessManager(pool, {
      repoRoot,
      agentsRoot,
      controlPlaneUrl: 'http://localhost:3100',
      spawnFn: spawnFn as any,
      fetchFn: global.fetch as any,
      execFileFn: execFileFn as any,
      sleepFn: async () => {},
    })
    setDelegationRuntimeStarter((agentId) => manager.ensureAgentStarted(agentId))

    const workItem = await createWorkItem(pool, {
      title: 'Provision on dispatch',
      status: 'active',
      lane: 'operations',
      owner_label: 'Prime',
      metadata: { source: 'test' },
    })
    const delegation = await createDelegation(pool, {
      work_item_id: workItem.id,
      to_agent_id: agent.id,
      capability: 'implementation',
      request: {
        content: 'Fix the bug',
        thread_id: undefined,
        source: 'test',
      },
    })

    const startedAt = Date.now()
    const result = await runDelegation(pool, delegation.id)
    const elapsedMs = Date.now() - startedAt

    expect(result.status).toBe('completed')
    expect(result.blocked).toBe(false)
    expect(elapsedMs).toBeLessThan(10_000)

    const refreshedDelegation = await getDelegation(pool, delegation.id)
    expect(refreshedDelegation?.to_agent_id).toBe(agent.id)

    const { rows: agentRows } = await pool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM agents WHERE id = $1 AND COALESCE(is_prime, false) = false",
      [agent.id]
    )
    expect(agentRows[0]?.count).toBe(1)

    const { rows: leaseEvents } = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM runtime_events WHERE event_type = 'runtime.leased' AND payload->>'agent_id' = $1`,
      [agent.id]
    )
    expect(leaseEvents.length).toBeGreaterThan(0)
    expect(spawnFn).toHaveBeenCalledWith('opencode', ['serve', '--port', '4600'], expect.any(Object))
  })
})
