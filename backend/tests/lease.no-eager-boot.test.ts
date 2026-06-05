import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import pg from 'pg'
import { OpenCodeProcessManager } from '../src/opencode/process-manager.js'
import { createPool, runMigrations } from '../src/db.js'
import { insertAgent, type RegistryAgent } from '../src/registry.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('lease.no-eager-boot (T041)', () => {
  let pool: pg.Pool
  let rootDir: string

  function createAgent(worktreePath: string): Omit<RegistryAgent, 'id' | 'created_at'> {
    return {
      name: 'Lazy Durable Agent',
      type: 'codex-thread',
      provider_id: undefined,
      tier: 'durable',
      role: 'implementation',
      state: 'ready',
      persona_file: 'AGENTS.md',
      runtime_family: 'codex-app-server',
      execution_mode: 'local',
      endpoint: 'http://127.0.0.1:4300',
      capabilities: ['implementation'],
      config: {},
      enabled: true,
      local_port: 4300,
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
  })

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'lease-no-eager-'))
    await pool.query(`DELETE FROM runtime_events WHERE actor IN ('runtime-lease', 'process-manager', 'agent.lifecycle.transition')`)
    await pool.query('DELETE FROM tool_grants')
    await pool.query('DELETE FROM agent_tokens')
    await pool.query('DELETE FROM agent_runtime_configs')
    await pool.query('DELETE FROM runtime_leases')
    await pool.query("DELETE FROM agents WHERE COALESCE(is_prime, false) = false")
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
    delete process.env.LAZY_PROVISIONING
  })

  afterAll(async () => {
    await pool.query(`DELETE FROM runtime_events WHERE actor IN ('runtime-lease', 'process-manager', 'agent.lifecycle.transition')`)
    await pool.query('DELETE FROM tool_grants')
    await pool.query('DELETE FROM agent_tokens')
    await pool.query('DELETE FROM agent_runtime_configs')
    await pool.query('DELETE FROM runtime_leases')
    await pool.query("DELETE FROM agents WHERE COALESCE(is_prime, false) = false")
    await pool.end()
  })

  it('prepares a durable runtime without starting a process when no work has been routed', async () => {
    process.env.LAZY_PROVISIONING = '1'

    const child = { kill: vi.fn().mockReturnValue(true), on: vi.fn(), stdout: null, stderr: null }
    const spawnFn = vi.fn().mockReturnValue(child)
    const fetchFn = vi.fn()
    const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })

    const repoRoot = path.join(rootDir, 'repo')
    const agentsRoot = path.join(rootDir, 'agents')
    const worktreePath = path.join(agentsRoot, 'lazy-durable-agent')

    const inserted = await insertAgent(pool, createAgent(worktreePath))

    const manager = new OpenCodeProcessManager(pool, {
      repoRoot,
      agentsRoot,
      controlPlaneUrl: 'http://localhost:3100',
      spawnFn: spawnFn as any,
      fetchFn: fetchFn as any,
      execFileFn: execFileFn as any,
      sleepFn: async () => {},
    })

    await manager.syncAgent(inserted)

    expect(spawnFn).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()

    const { rows: agents } = await pool.query<{ state: string }>('SELECT state FROM agents WHERE id = $1', [inserted.id])
    expect(agents[0]?.state).toBe('idle')

    const { rows: events } = await pool.query<{ event_type: string; payload: { reason?: string } }>(
      `SELECT event_type, payload
       FROM runtime_events
       WHERE event_type = 'agent.lifecycle.transition'
         AND payload->>'agent_id' = $1
       ORDER BY created_at DESC`,
      [inserted.id]
    )
    expect(events[0]?.payload?.reason).toBe('managed local runtime prepared for lazy provisioning')

    const opencodeConfig = await readFile(path.join(worktreePath, 'opencode.json'), 'utf8')
    expect(opencodeConfig).toContain('control-plane')
  })
})
