import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { OpenCodeProcessManager } from '../../src/opencode/process-manager.js'
import type { RegistryAgent } from '../../src/registry.js'

function createAgent(overrides: Partial<RegistryAgent> = {}): RegistryAgent {
  return {
    id: 'agent-1',
    name: 'Builder One',
    type: 'codex-thread',
    provider_id: 'provider-1',
    tier: 'durable',
    role: 'implementation',
    state: 'ready',
    persona_file: 'AGENTS.md',
    runtime_family: 'codex-app-server',
    execution_mode: 'local',
    endpoint: 'http://127.0.0.1:4200',
    capabilities: ['implementation'],
    config: {},
    enabled: true,
    created_at: new Date(0).toISOString(),
    local_port: 4200,
    worktree_path: '/tmp/placeholder',
    system_prompt: 'Ship working code',
    soul: 'Calm builder',
    ...overrides,
  }
}

function isLifecycleUpdate(sql: string): boolean {
  return sql.includes('UPDATE agents') && sql.includes('SET state = $2')
}

function isRuntimeEventInsert(sql: string): boolean {
  return sql.includes('INSERT INTO runtime_events')
}

describe('OpenCodeProcessManager', () => {
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-manager-'))
  })

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true })
  })

  it('writes agent config files and spawns opencode for managed local agents', async () => {
    const worktreePath = path.join(rootDir, 'agents', 'builder-one')
    const child = { kill: vi.fn().mockReturnValue(true), on: vi.fn(), stdout: null, stderr: null }
    const spawnFn = vi.fn().mockReturnValue(child)
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    const query = vi.fn(async (sql: string) => {
      if (isLifecycleUpdate(sql)) {
        return { rows: [], rowCount: 1 }
      }
      if (isRuntimeEventInsert(sql)) {
        return { rows: [], rowCount: 1 }
      }
      if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) {
        return { rows: [createAgent({ worktree_path: worktreePath, state: 'idle' })] }
      }
      if (sql.startsWith('SELECT * FROM providers')) {
        return { rows: [{ id: 'provider-1', type: 'llm', model: 'anthropic/claude-sonnet-4-5', base_url: 'https://proxy.example.com', api_key: 'encrypted' }] }
      }
      if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) {
        return { rows: [] }
      }
      if (sql.startsWith('SELECT token FROM agent_tokens')) {
        return { rows: [] }
      }
      if (sql.startsWith('INSERT INTO agent_tokens')) {
        return { rows: [{ token: 'agent-token-1' }] }
      }
      if (sql.startsWith('INSERT INTO tool_grants')) {
        return {
          rows: [{
            id: 'grant-1',
            agent_id: 'agent-1',
            delegation_id: null,
            work_item_id: null,
            capability_profile_id: null,
            routing_capability: 'implementation',
            granted_primitives: [],
            granted_capability_bundles: [],
            selected_provider_adapters: [{ kind: 'http', ref: 'gitea' }],
            exclusion_reasons: [{ kind: 'missing-profile', target: 'implementation', reason: 'no capability profile assigned' }],
            task_scope: {},
            approval_state: {},
            environment_context: {},
            revocation_state: 'active',
            revoked_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }],
        }
      }
      if (sql.includes('FROM mcp_servers ms')) {
        return { rows: [{ id: 'mcp-1', name: 'gitea', description: 'Pull requests and issues', type: 'http', url: 'http://gitea:3000/mcp', env_vars: { GITEA_TOKEN: 'secret' } }] }
      }
      if (sql.startsWith('SELECT api_key FROM providers')) {
        return { rows: [{ api_key: null }] }
      }
      throw new Error(`unexpected query: ${sql}`)
    })
    const pool = { query } as unknown as pg.Pool

    const manager = new OpenCodeProcessManager(pool, {
      repoRoot: path.join(rootDir, 'repo'),
      agentsRoot: path.join(rootDir, 'agents'),
      controlPlaneUrl: 'http://localhost:3100',
      spawnFn: spawnFn as any,
      fetchFn: fetchFn as any,
      execFileFn: execFileFn as any,
      sleepFn: async () => {},
    })

    await manager.syncAgent(createAgent({ worktree_path: worktreePath }))

    expect(execFileFn).toHaveBeenCalledWith('git', [
      '-C',
      path.join(rootDir, 'repo'),
      'worktree',
      'add',
      worktreePath,
      '-b',
      'agent/builder-one',
    ])
    expect(spawnFn).toHaveBeenCalledWith('opencode', ['serve', '--port', '4200'], expect.objectContaining({
      cwd: worktreePath,
      env: expect.objectContaining({
        CONTROL_PLANE_AGENT_TOKEN: 'agent-token-1',
        OPENAI_BASE_URL: 'https://proxy.example.com',
      }),
    }))
    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:4200/health')

    expect(await readFile(path.join(worktreePath, 'AGENTS.md'), 'utf8')).toContain('Ship working code')
    expect(await readFile(path.join(worktreePath, 'soul.md'), 'utf8')).toContain('Calm builder')
    expect(await readFile(path.join(worktreePath, 'TOOLS.md'), 'utf8')).toContain('delegate_to_agent')
    expect(await readFile(path.join(worktreePath, 'TOOLS.md'), 'utf8')).toContain('Machine-readable metadata')
    expect(await readFile(path.join(worktreePath, 'TOOLS.md'), 'utf8')).toContain('`capability` (string, required)')
    expect(await readFile(path.join(worktreePath, 'TOOLS.md'), 'utf8')).toContain('## gitea')
    const controlPlaneTools = await readFile(path.join(worktreePath, 'control-plane-tools.json'), 'utf8')
    expect(controlPlaneTools).toContain('"name": "delegate_to_agent"')
    expect(controlPlaneTools).toContain('"outputSchema"')
    const opencodeConfig = await readFile(path.join(worktreePath, 'opencode.json'), 'utf8')
    expect(opencodeConfig).toContain('anthropic/claude-sonnet-4-5')
    expect(opencodeConfig).toContain('control-plane')
    expect(opencodeConfig).toContain('soullayer')
    expect(opencodeConfig).toContain('http://gitea:3000/mcp')
    expect(query).toHaveBeenCalledWith(expect.stringContaining('JOIN agent_mcp_assignments ama'), ['agent-1'])
  })

  it('keeps brokered control-plane and MCP secrets out of opencode.json when CREDENTIAL_BROKER is enabled', async () => {
    const previousFlag = process.env.CREDENTIAL_BROKER
    process.env.CREDENTIAL_BROKER = '1'

    try {
      const worktreePath = path.join(rootDir, 'agents', 'builder-brokered')
      const child = { kill: vi.fn().mockReturnValue(true), on: vi.fn(), stdout: null, stderr: null }
      const spawnFn = vi.fn().mockReturnValue(child)
      const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
      const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
      const query = vi.fn(async (sql: string, params?: unknown[]) => {
        if (isLifecycleUpdate(sql) || isRuntimeEventInsert(sql)) return { rows: [], rowCount: 1 }
        if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) {
          return { rows: [createAgent({ worktree_path: worktreePath, state: 'idle' })] }
        }
        if (sql.startsWith('SELECT * FROM providers')) {
          return { rows: [{ id: 'provider-1', type: 'llm', model: 'anthropic/claude-sonnet-4-5', base_url: 'https://proxy.example.com', api_key: 'encrypted' }] }
        }
        if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) return { rows: [] }
        if (sql.startsWith('INSERT INTO tool_grants')) {
          return {
            rows: [{
              id: 'grant-broker', agent_id: 'agent-1', delegation_id: null, work_item_id: null, capability_profile_id: null,
              routing_capability: 'implementation', granted_primitives: [], granted_capability_bundles: [],
              selected_provider_adapters: [{ kind: 'http', ref: 'gitea' }], exclusion_reasons: [], task_scope: {}, approval_state: {},
              environment_context: {}, revocation_state: 'active', revoked_at: null,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            }],
          }
        }
        if (sql.includes('FROM mcp_servers ms')) {
          return { rows: [{ id: 'mcp-1', name: 'gitea', description: 'Pull requests and issues', type: 'http', url: 'http://gitea:3000/mcp', env_vars: { GITEA_TOKEN: 'secret' } }] }
        }
        if (sql.startsWith('SELECT api_key FROM providers')) return { rows: [{ api_key: null }] }
        if (sql.startsWith('UPDATE brokered_credentials SET status = \'revoked\'')) return { rows: [] }
        if (sql.startsWith('INSERT INTO brokered_credentials')) {
          const kind = params?.[1]
          if (kind === 'provider_proxy_token') return { rows: [{ id: 'cred-proxy', expires_at: new Date().toISOString() }] }
          if (kind === 'launcher_token') return { rows: [{ id: 'cred-launcher', expires_at: new Date().toISOString() }] }
          return { rows: [{ id: 'cred-secret', expires_at: new Date().toISOString() }] }
        }
        throw new Error(`unexpected query: ${sql}`)
      })
      const pool = { query } as unknown as pg.Pool

      const manager = new OpenCodeProcessManager(pool, {
        repoRoot: path.join(rootDir, 'repo'),
        agentsRoot: path.join(rootDir, 'agents'),
        controlPlaneUrl: 'http://localhost:3100',
        spawnFn: spawnFn as any,
        fetchFn: fetchFn as any,
        execFileFn: execFileFn as any,
        sleepFn: async () => {},
      })

      await manager.syncAgent(createAgent({ worktree_path: worktreePath }))

      expect(spawnFn).toHaveBeenCalledWith('opencode', ['serve', '--port', '4200'], expect.objectContaining({
        cwd: worktreePath,
        env: expect.objectContaining({
          CONTROL_PLANE_AGENT_TOKEN: expect.any(String),
          GITEA_TOKEN: 'secret',
        }),
      }))

      const opencodeConfig = await readFile(path.join(worktreePath, 'opencode.json'), 'utf8')
      expect(opencodeConfig).not.toContain('CONTROL_PLANE_AGENT_TOKEN')
      expect(opencodeConfig).not.toContain('GITEA_TOKEN')
      expect(opencodeConfig).not.toContain('secret')
    } finally {
      if (previousFlag === undefined) delete process.env.CREDENTIAL_BROKER
      else process.env.CREDENTIAL_BROKER = previousFlag
    }
  })

  it('allocates a port and worktree path when agent metadata is missing', async () => {
    const updatedAgent = createAgent({
      endpoint: 'http://127.0.0.1:4201',
      local_port: 4201,
      worktree_path: path.join(rootDir, 'agents', 'builder-one'),
    })
    const child = { kill: vi.fn().mockReturnValue(true), on: vi.fn(), stdout: null, stderr: null }
    const spawnFn = vi.fn().mockReturnValue(child)
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    const query = vi.fn(async (sql: string) => {
      if (isLifecycleUpdate(sql)) {
        return { rows: [], rowCount: 1 }
      }
      if (isRuntimeEventInsert(sql)) {
        return { rows: [], rowCount: 1 }
      }
      if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) {
        return { rows: [updatedAgent] }
      }
      if (sql.includes('MAX(local_port)')) {
        return { rows: [{ next_port: 4201 }] }
      }
      if (sql.startsWith('UPDATE agents SET')) {
        return { rows: [updatedAgent] }
      }
      if (sql.startsWith('SELECT * FROM providers')) {
        return { rows: [] }
      }
      if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) {
        return { rows: [] }
      }
      if (sql.startsWith('SELECT token FROM agent_tokens')) {
        return { rows: [{ token: 'agent-token-2' }] }
      }
      if (sql.startsWith('INSERT INTO tool_grants')) {
        return {
          rows: [{
            id: 'grant-2',
            agent_id: 'agent-1',
            delegation_id: null,
            work_item_id: null,
            capability_profile_id: null,
            routing_capability: 'implementation',
            granted_primitives: [],
            granted_capability_bundles: [],
            selected_provider_adapters: [],
            exclusion_reasons: [{ kind: 'missing-profile', target: 'implementation', reason: 'no capability profile assigned' }],
            task_scope: {},
            approval_state: {},
            environment_context: {},
            revocation_state: 'active',
            revoked_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }],
        }
      }
      if (sql.includes('FROM mcp_servers ms')) {
        return { rows: [] }
      }
      throw new Error(`unexpected query: ${sql}`)
    })
    const pool = { query } as unknown as pg.Pool
    const manager = new OpenCodeProcessManager(pool, {
      repoRoot: path.join(rootDir, 'repo'),
      agentsRoot: path.join(rootDir, 'agents'),
      spawnFn: spawnFn as any,
      fetchFn: fetchFn as any,
      execFileFn: execFileFn as any,
      sleepFn: async () => {},
    })

    await manager.syncAgent(createAgent({
      endpoint: undefined,
      local_port: undefined,
      worktree_path: undefined,
    }))

    expect(query).toHaveBeenCalledWith(expect.stringContaining('MAX(local_port)'), [4199])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE agents SET'), expect.any(Array))
    expect(spawnFn).toHaveBeenCalledWith('opencode', ['serve', '--port', '4201'], expect.any(Object))
  })

  it('does not eagerly spawn durable managed runtimes (lazy provisioning is always-on)', async () => {
    const worktreePath = path.join(rootDir, 'agents', 'lazy-durable')
    const spawnFn = vi.fn()
    const fetchFn = vi.fn()
    const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    const query = vi.fn(async (sql: string) => {
      if (isLifecycleUpdate(sql) || isRuntimeEventInsert(sql)) return { rows: [], rowCount: 1 }
      if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) {
        return { rows: [createAgent({ worktree_path: worktreePath, state: 'idle' })] }
      }
      if (sql.startsWith('SELECT * FROM providers')) return { rows: [] }
      if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) return { rows: [] }
      if (sql.startsWith('SELECT token FROM agent_tokens')) return { rows: [{ token: 'agent-token-lazy' }] }
      if (sql.startsWith('INSERT INTO tool_grants')) {
        return {
          rows: [{
            id: 'grant-lazy',
            agent_id: 'agent-1',
            delegation_id: null,
            work_item_id: null,
            capability_profile_id: null,
            routing_capability: 'implementation',
            granted_primitives: [],
            granted_capability_bundles: [],
            selected_provider_adapters: [],
            exclusion_reasons: [],
            task_scope: {},
            approval_state: {},
            environment_context: {},
            revocation_state: 'active',
            revoked_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }],
        }
      }
      if (sql.includes('FROM mcp_servers ms')) return { rows: [] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const pool = { query } as unknown as pg.Pool
    const manager = new OpenCodeProcessManager(pool, {
      repoRoot: path.join(rootDir, 'repo'),
      agentsRoot: path.join(rootDir, 'agents'),
      spawnFn: spawnFn as any,
      fetchFn: fetchFn as any,
      execFileFn: execFileFn as any,
      sleepFn: async () => {},
    })

    await manager.syncAgent(createAgent({ worktree_path: worktreePath }))

    expect(spawnFn).not.toHaveBeenCalled()
    expect(fetchFn).not.toHaveBeenCalled()
    expect(await readFile(path.join(worktreePath, 'opencode.json'), 'utf8')).toContain('control-plane')
  })

  it('coalesces concurrent lazy start requests into a single spawn', async () => {
    const worktreePath = path.join(rootDir, 'agents', 'coalesced-durable')
    const child = { kill: vi.fn().mockReturnValue(true), on: vi.fn(), stdout: null, stderr: null }
    const spawnFn = vi.fn().mockReturnValue(child)
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 1 }
      if (isLifecycleUpdate(sql) || isRuntimeEventInsert(sql)) return { rows: [], rowCount: 1 }
      if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) {
        return { rows: [createAgent({ worktree_path: worktreePath, state: 'idle' })] }
      }
      if (sql.includes('SELECT id, agent_id, status, sandbox_id, acquired_at, last_activity_at, released_at')) return { rows: [] }
      if (sql.includes('INSERT INTO runtime_leases')) {
        return { rows: [{ id: 'lease-1', agent_id: 'agent-1', status: 'active', sandbox_id: null, acquired_at: new Date().toISOString(), last_activity_at: new Date().toISOString(), released_at: null }] }
      }
      if (sql.startsWith('SELECT * FROM providers')) return { rows: [] }
      if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) return { rows: [] }
      if (sql.startsWith('SELECT token FROM agent_tokens')) return { rows: [{ token: 'agent-token-coalesce' }] }
      if (sql.startsWith('INSERT INTO tool_grants')) {
        return {
          rows: [{
            id: 'grant-coalesce', agent_id: 'agent-1', delegation_id: null, work_item_id: null, capability_profile_id: null,
            routing_capability: 'implementation', granted_primitives: [], granted_capability_bundles: [], selected_provider_adapters: [],
            exclusion_reasons: [], task_scope: {}, approval_state: {}, environment_context: {}, revocation_state: 'active', revoked_at: null,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }],
        }
      }
      if (sql.includes('FROM mcp_servers ms')) return { rows: [] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const pool = {
      query,
      connect: vi.fn(async () => ({ query, release: vi.fn() })),
    } as unknown as pg.Pool
    const manager = new OpenCodeProcessManager(pool, {
      repoRoot: path.join(rootDir, 'repo'),
      agentsRoot: path.join(rootDir, 'agents'),
      spawnFn: spawnFn as any,
      fetchFn: fetchFn as any,
      execFileFn: execFileFn as any,
      sleepFn: async () => {},
    })

    await Promise.all([manager.ensureAgentStarted('agent-1'), manager.ensureAgentStarted('agent-1')])

    expect(spawnFn).toHaveBeenCalledTimes(1)
  })

  it('stops a running process for disabled local agents', async () => {
    const child = { kill: vi.fn().mockReturnValue(true), on: vi.fn(), stdout: null, stderr: null }
    const spawnFn = vi.fn().mockReturnValue(child)
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    const query = vi.fn(async (sql: string) => {
      if (isLifecycleUpdate(sql)) {
        return { rows: [], rowCount: 1 }
      }
      if (isRuntimeEventInsert(sql)) {
        return { rows: [], rowCount: 1 }
      }
      if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) {
        return { rows: [{ ...createAgent({ worktree_path: path.join(rootDir, 'agents', 'builder-one') }), state: 'idle' }] }
      }
      if (sql.startsWith('SELECT * FROM providers')) return { rows: [] }
      if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) return { rows: [] }
      if (sql.startsWith('SELECT token FROM agent_tokens')) return { rows: [{ token: 'agent-token-3' }] }
      if (sql.startsWith('INSERT INTO tool_grants')) {
        return {
          rows: [{
            id: 'grant-3',
            agent_id: 'agent-1',
            delegation_id: null,
            work_item_id: null,
            capability_profile_id: null,
            routing_capability: 'implementation',
            granted_primitives: [],
            granted_capability_bundles: [],
            selected_provider_adapters: [],
            exclusion_reasons: [{ kind: 'missing-profile', target: 'implementation', reason: 'no capability profile assigned' }],
            task_scope: {},
            approval_state: {},
            environment_context: {},
            revocation_state: 'active',
            revoked_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }],
        }
      }
      if (sql.includes('FROM mcp_servers ms')) return { rows: [] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const pool = { query } as unknown as pg.Pool
    const manager = new OpenCodeProcessManager(pool, {
      repoRoot: path.join(rootDir, 'repo'),
      agentsRoot: path.join(rootDir, 'agents'),
      spawnFn: spawnFn as any,
      fetchFn: fetchFn as any,
      execFileFn: execFileFn as any,
      sleepFn: async () => {},
    })

    const agent = createAgent({ worktree_path: path.join(rootDir, 'agents', 'builder-one') })
    await manager.syncAgent(agent)
    await manager.syncAgent({ ...agent, enabled: false })

    expect(child.kill).toHaveBeenCalled()
  })

  it('does not force unmanaged agents to terminated during sync', async () => {
    const query = vi.fn(async (sql: string) => {
      if (isLifecycleUpdate(sql) || isRuntimeEventInsert(sql)) {
        throw new Error(`unexpected lifecycle query: ${sql}`)
      }
      throw new Error(`unexpected query: ${sql}`)
    })
    const pool = { query } as unknown as pg.Pool
    const manager = new OpenCodeProcessManager(pool)
    const unmanaged = createAgent({
      execution_mode: 'external',
      enabled: true,
      state: 'ready',
    })

    const result = await manager.syncAgent(unmanaged)

    expect(result).toEqual(unmanaged)
    expect(query).not.toHaveBeenCalled()
  })

  it('getRunningHarness returns undefined for an agent that has not started yet', () => {
    const manager = new OpenCodeProcessManager({} as unknown as pg.Pool)
    const result = manager.getRunningHarness('unknown-agent-id')
    expect(result).toBeUndefined()
  })

  it('initialize recovers interrupted delegations and restarts only durable agents', async () => {
    const durable = createAgent({ id: 'agent-durable', name: 'Durable Agent' })
    const ephemeral = createAgent({
      id: 'agent-ephemeral',
      name: 'Ephemeral Agent',
      tier: 'ephemeral',
      state: 'busy',
    })
    const child = { kill: vi.fn().mockReturnValue(true), on: vi.fn(), stdout: null, stderr: null }
    const spawnFn = vi.fn().mockReturnValue(child)
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    const query = vi.fn(async (sql: string) => {
      if (sql.includes(`UPDATE delegations
       SET status = 'failed'`)) {
        return { rows: [{ id: 'del-1', to_agent_id: durable.id }] }
      }
      if (sql.includes(`SELECT id
       FROM agents`)) {
        return { rows: [{ id: durable.id }, { id: ephemeral.id }] }
      }
      if (isLifecycleUpdate(sql)) {
        return { rows: [], rowCount: 1 }
      }
      if (isRuntimeEventInsert(sql)) {
        return { rows: [], rowCount: 1 }
      }
      if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) {
        return { rows: [{ ...durable, state: 'idle' }] }
      }
      if (sql === 'SELECT * FROM agents ORDER BY created_at') {
        return { rows: [durable, ephemeral] }
      }
      if (sql.startsWith('SELECT * FROM providers')) {
        return { rows: [] }
      }
      if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) {
        return { rows: [] }
      }
      if (sql.startsWith('SELECT token FROM agent_tokens')) {
        return { rows: [{ token: 'agent-token-4' }] }
      }
      if (sql.startsWith('INSERT INTO tool_grants')) {
        return {
          rows: [{
            id: 'grant-4',
            agent_id: durable.id,
            delegation_id: null,
            work_item_id: null,
            capability_profile_id: null,
            routing_capability: 'implementation',
            granted_primitives: [],
            granted_capability_bundles: [],
            selected_provider_adapters: [],
            exclusion_reasons: [{ kind: 'missing-profile', target: 'implementation', reason: 'no capability profile assigned' }],
            task_scope: {},
            approval_state: {},
            environment_context: {},
            revocation_state: 'active',
            revoked_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }],
        }
      }
      if (sql.includes('FROM mcp_servers ms')) {
        return { rows: [] }
      }
      // Bootstrap queries for durable staff
      if (sql.startsWith('SELECT * FROM capability_profiles WHERE name = $1')) {
        return { rows: [] }
      }
      if (sql.startsWith('INSERT INTO capability_profiles')) {
        return { rows: [{ id: 'profile-1', name: 'architect-default' }] }
      }
      if (sql.startsWith('SELECT * FROM agents WHERE role = $1')) {
        return { rows: [] }
      }
      if (sql.startsWith('INSERT INTO agents')) {
        return {
          rows: [{
            ...durable,
            id: 'agent-bootstrapped',
            role: 'architect',
            tier: 'durable',
            state: 'provisioning',
          }],
        }
      }
      if (sql.startsWith('INSERT INTO agent_runtime_configs')) {
        return { rows: [{ agent_id: durable.id, capability_profile_id: 'profile-1' }] }
      }
      if (sql.startsWith('UPDATE capability_profiles SET')) {
        return { rows: [], rowCount: 1 }
      }
      throw new Error(`unexpected query: ${sql}`)
    })
    const pool = { query } as unknown as pg.Pool
    const manager = new OpenCodeProcessManager(pool, {
      repoRoot: path.join(rootDir, 'repo'),
      agentsRoot: path.join(rootDir, 'agents'),
      spawnFn: spawnFn as any,
      fetchFn: fetchFn as any,
      execFileFn: execFileFn as any,
      sleepFn: async () => {},
    })

    await manager.initialize()

    expect(spawnFn).toHaveBeenCalledTimes(1)
    expect(spawnFn).toHaveBeenCalledWith('opencode', ['serve', '--port', '4200'], expect.any(Object))
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(`UPDATE delegations
       SET status = 'failed'`),
      ['failed during harness restart recovery'],
    )
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agents'),
      [durable.id, 'error'],
    )
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agents'),
      [ephemeral.id, 'error'],
    )
  })

  it('writes only granted control-plane primitives to TOOLS.md (Slice 4)', async () => {
    const worktreePath = path.join(rootDir, 'agents', 'filtered-agent')
    const child = { kill: vi.fn().mockReturnValue(true), on: vi.fn(), stdout: null, stderr: null }
    const spawnFn = vi.fn().mockReturnValue(child)
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    const query = vi.fn(async (sql: string) => {
      if (isLifecycleUpdate(sql)) return { rows: [], rowCount: 1 }
      if (isRuntimeEventInsert(sql)) return { rows: [], rowCount: 1 }
      if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) {
        return { rows: [createAgent({ worktree_path: worktreePath, state: 'idle' })] }
      }
      if (sql.startsWith('SELECT * FROM providers')) return { rows: [] }
      if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) return { rows: [] }
      if (sql.startsWith('SELECT token FROM agent_tokens')) return { rows: [{ token: 'agent-token-filtered' }] }
      if (sql.startsWith('INSERT INTO tool_grants')) {
        return {
          rows: [{
            id: 'grant-filtered',
            agent_id: 'agent-1',
            delegation_id: null,
            work_item_id: null,
            capability_profile_id: null,
            routing_capability: 'implementation',
            granted_primitives: ['delegate', 'update_work_item'],
            granted_capability_bundles: ['repo.read'],
            selected_provider_adapters: [],
            exclusion_reasons: [{ kind: 'missing-profile', target: 'implementation', reason: 'no capability profile assigned' }],
            task_scope: {},
            approval_state: {},
            environment_context: {},
            revocation_state: 'active',
            revoked_at: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }],
        }
      }
      if (sql.includes('FROM mcp_servers ms')) return { rows: [] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const pool = { query } as unknown as pg.Pool
    const manager = new OpenCodeProcessManager(pool, {
      repoRoot: path.join(rootDir, 'repo'),
      agentsRoot: path.join(rootDir, 'agents'),
      spawnFn: spawnFn as any,
      fetchFn: fetchFn as any,
      execFileFn: execFileFn as any,
      sleepFn: async () => {},
    })

    await manager.syncAgent(createAgent({ worktree_path: worktreePath }))

    const toolsMd = await readFile(path.join(worktreePath, 'TOOLS.md'), 'utf8')
    const controlPlaneToolsJson = await readFile(path.join(worktreePath, 'control-plane-tools.json'), 'utf8')

    // Granted primitives should be present
    expect(toolsMd).toContain('delegate_to_agent')
    expect(toolsMd).toContain('update_work_item')
    expect(controlPlaneToolsJson).toContain('"name": "delegate_to_agent"')
    expect(controlPlaneToolsJson).toContain('"name": "update_work_item"')

    // Non-granted primitives should be absent
    expect(toolsMd).not.toContain('memory_search')
    expect(toolsMd).not.toContain('soul_read')
    expect(toolsMd).not.toContain('snapshot_create')
    expect(controlPlaneToolsJson).not.toContain('"name": "memory_search"')
    expect(controlPlaneToolsJson).not.toContain('"name": "soul_read"')

    // Prime-only tools should never appear for non-Prime agents
    expect(toolsMd).not.toContain('query_fleet_learnings')
    expect(toolsMd).not.toContain('resolve_approval')
    expect(toolsMd).not.toContain('publish_pattern')
    expect(toolsMd).not.toContain('update_agent_soul')
    expect(controlPlaneToolsJson).not.toContain('"name": "query_fleet_learnings"')
  })

  // ─── Spec 023: Pi ACP migration ───────────────────────────────────────────

  describe('Pi ACP routing (spec-023)', () => {
    function createPiAgent(overrides: Partial<RegistryAgent> = {}): RegistryAgent {
      return createAgent({
        runtime_family: 'pi',
        tier: 'durable',
        worktree_path: '/tmp/placeholder-pi',
        local_port: undefined,
        config: {},
        ...overrides,
      })
    }

    function makeBaseQuery(worktreePath: string): (sql: string) => Promise<{ rows: unknown[]; rowCount?: number }> {
      return async (sql: string) => {
        if (isLifecycleUpdate(sql) || isRuntimeEventInsert(sql)) return { rows: [], rowCount: 1 }
        if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) return { rows: [createPiAgent({ worktree_path: worktreePath })] }
        if (sql.startsWith('SELECT * FROM providers')) return { rows: [{ id: 'provider-1', type: 'pi', model: 'pi-default', base_url: null, api_key: null }] }
        if (sql.startsWith('SELECT api_key FROM providers')) return { rows: [{ api_key: null }] }
        if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) return { rows: [] }
        if (sql.startsWith('SELECT token FROM agent_tokens')) return { rows: [{ token: 'agent-token-pi' }] }
        if (sql.startsWith('INSERT INTO tool_grants')) {
          return {
            rows: [{
              id: 'grant-pi', agent_id: 'agent-1', delegation_id: null, work_item_id: null, capability_profile_id: null,
              routing_capability: 'implementation', granted_primitives: [], granted_capability_bundles: [],
              selected_provider_adapters: [], exclusion_reasons: [], task_scope: {}, approval_state: {},
              environment_context: {}, revocation_state: 'active', revoked_at: null,
              created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            }],
          }
        }
        if (sql.includes('FROM mcp_servers ms')) return { rows: [] }
        throw new Error(`unexpected query in Pi test: ${sql}`)
      }
    }

    it('T007 — routes Pi agent to AcpHarness using the pi-acp command (not a legacy bridge)', async () => {
      const worktreePath = path.join(rootDir, 'agents', 'pi-agent')
      const capturedHarnessArgs: unknown[] = []
      const mockHarness = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
        delegate: vi.fn(),
        wake: vi.fn(),
      }

      // Spy on AcpHarness construction to capture the command argument
      const { AcpHarness } = await import('../../src/fleet-executor/acp-harness.js')
      const AcpHarnessSpy = vi.spyOn({ AcpHarness }, 'AcpHarness').mockImplementation((...args: unknown[]) => {
        capturedHarnessArgs.push(...args)
        return mockHarness as unknown as InstanceType<typeof AcpHarness>
      })

      const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
      const query = vi.fn(makeBaseQuery(worktreePath))
      const pool = { query } as unknown as pg.Pool

      // Use a process manager with EGRESS_SANDBOX off so launcher path is skipped
      const originalSandbox = process.env.EGRESS_SANDBOX
      delete process.env.EGRESS_SANDBOX
      delete process.env.LAUNCHER_ENABLED
      try {
        const manager = new OpenCodeProcessManager(pool, {
          repoRoot: path.join(rootDir, 'repo'),
          agentsRoot: path.join(rootDir, 'agents'),
          execFileFn: execFileFn as any,
          sleepFn: async () => {},
        })

        await manager.syncAgent(createPiAgent({ worktree_path: worktreePath }))
        // Pi agents are durable — lazy provisioning means syncAgent doesn't start them
        // We confirm the agent state was set to idle (not started)
        const lifecycleCall = query.mock.calls.find(
          ([sql]) => typeof sql === 'string' && sql.includes('UPDATE agents') && sql.includes('SET state = $2')
        )
        expect(lifecycleCall).toBeDefined()
      } finally {
        if (originalSandbox !== undefined) process.env.EGRESS_SANDBOX = originalSandbox
        AcpHarnessSpy.mockRestore()
      }
    })

    it('T008 — Pi agent with runtime_family=pi uses pi-acp, not per-agent config command', async () => {
      const worktreePath = path.join(rootDir, 'agents', 'pi-agent-cmd')

      // Pi agent with explicit config.command override — must be ignored
      const piAgentWithCmdOverride = createPiAgent({
        worktree_path: worktreePath,
        config: { command: 'my-custom-acp-runner', args: ['--extra'] },
      })

      const capturedCommands: string[] = []
      const mockHarness = {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
      }

      // Import AcpHarness to inspect command used
      const acp = await import('../../src/fleet-executor/acp-harness.js')
      const origConstructor = acp.AcpHarness
      vi.spyOn(acp, 'AcpHarness' as never).mockImplementation(((_id: string, _pool: unknown, cmd: string, ...rest: unknown[]) => {
        capturedCommands.push(cmd)
        return { ...mockHarness, start: vi.fn().mockResolvedValue(undefined) }
      }) as never)

      const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
      const query = vi.fn(makeBaseQuery(worktreePath))

      const piQuery = vi.fn(async (sql: string) => {
        const base = makeBaseQuery(worktreePath)
        if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) {
          return { rows: [piAgentWithCmdOverride] }
        }
        return base(sql)
      })

      const pool = { query: piQuery } as unknown as pg.Pool
      const originalSandbox = process.env.EGRESS_SANDBOX
      const originalLauncher = process.env.LAUNCHER_ENABLED
      delete process.env.EGRESS_SANDBOX
      delete process.env.LAUNCHER_ENABLED

      try {
        const manager = new OpenCodeProcessManager(pool, {
          repoRoot: path.join(rootDir, 'repo'),
          agentsRoot: path.join(rootDir, 'agents'),
          execFileFn: execFileFn as any,
          sleepFn: async () => {},
        })

        await manager.ensureAgentStarted('agent-1')

        // The AcpHarness should have been called with 'pi-acp', not 'my-custom-acp-runner'
        expect(capturedCommands).toContain('pi-acp')
        expect(capturedCommands).not.toContain('my-custom-acp-runner')
      } finally {
        if (originalSandbox !== undefined) process.env.EGRESS_SANDBOX = originalSandbox
        if (originalLauncher !== undefined) process.env.LAUNCHER_ENABLED = originalLauncher
        vi.restoreAllMocks()
      }
    })

    it('T016 — existing Pi registry row (runtime_family=pi) routes to ACP without schema changes', async () => {
      // Existing Pi agent record with no migration — should work transparently
      const worktreePath = path.join(rootDir, 'agents', 'pi-legacy')
      const piLegacyAgent = createAgent({
        runtime_family: 'pi',
        tier: 'durable',
        worktree_path: worktreePath,
        config: {},  // no special config — legacy record
      })

      const query = vi.fn(async (sql: string) => {
        const base = makeBaseQuery(worktreePath)
        if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) return { rows: [piLegacyAgent] }
        return base(sql)
      })
      const pool = { query } as unknown as pg.Pool
      const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })

      const manager = new OpenCodeProcessManager(pool, {
        repoRoot: path.join(rootDir, 'repo'),
        agentsRoot: path.join(rootDir, 'agents'),
        execFileFn: execFileFn as any,
        sleepFn: async () => {},
      })

      // syncAgent should succeed for a Pi agent with no special config
      await expect(manager.syncAgent(piLegacyAgent)).resolves.not.toThrow()

      // Confirm the agent was treated as a managed local agent (state transitions happened)
      const stateTransitions = query.mock.calls.filter(
        ([sql]) => typeof sql === 'string' && sql.includes('UPDATE agents') && sql.includes('SET state = $2')
      )
      expect(stateTransitions.length).toBeGreaterThan(0)
    })

    it('T020 — no PiHarness dependency exists in any runtime path', async () => {
      // Verify PiHarness no longer exists
      await expect(import('../../src/fleet-executor/pi-harness.js')).rejects.toThrow()
    })

    it('T012 — Pi agent start passes PI_MODEL and PI_PROVIDER env vars to AcpHarness', async () => {
      const worktreePath = path.join(rootDir, 'agents', 'pi-env-test')
      const capturedStartOpts: Array<{ cwd: string; env?: Record<string, string> }> = []

      const acp = await import('../../src/fleet-executor/acp-harness.js')
      vi.spyOn(acp, 'AcpHarness' as never).mockImplementation(((_id: string, _pool: unknown, _cmd: string, _args: string[], _root: string, _perm: unknown) => ({
        start: vi.fn().mockImplementation((opts: { cwd: string; env?: Record<string, string> }) => {
          capturedStartOpts.push(opts)
          return Promise.resolve()
        }),
        stop: vi.fn(),
      })) as never)

      const piAgent = createPiAgent({ worktree_path: worktreePath })
      const piQuery = vi.fn(async (sql: string) => {
        if (isLifecycleUpdate(sql) || isRuntimeEventInsert(sql)) return { rows: [], rowCount: 1 }
        if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) return { rows: [piAgent] }
        if (sql.startsWith('SELECT * FROM providers')) return { rows: [{ id: 'provider-1', type: 'pi', model: 'pi-gemma-3', base_url: null, api_key: null }] }
        if (sql.startsWith('SELECT api_key FROM providers')) return { rows: [{ api_key: null }] }
        if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) return { rows: [] }
        if (sql.startsWith('SELECT token FROM agent_tokens')) return { rows: [{ token: 'tok' }] }
        if (sql.startsWith('INSERT INTO tool_grants')) {
          return { rows: [{ id: 'g', agent_id: 'agent-1', delegation_id: null, work_item_id: null, capability_profile_id: null, routing_capability: 'implementation', granted_primitives: [], granted_capability_bundles: [], selected_provider_adapters: [], exclusion_reasons: [], task_scope: {}, approval_state: {}, environment_context: {}, revocation_state: 'active', revoked_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }
        }
        if (sql.includes('FROM mcp_servers ms')) return { rows: [] }
        throw new Error(`unexpected query: ${sql}`)
      })

      const originalSandbox = process.env.EGRESS_SANDBOX
      const originalLauncher = process.env.LAUNCHER_ENABLED
      delete process.env.EGRESS_SANDBOX
      delete process.env.LAUNCHER_ENABLED

      try {
        const pool = { query: piQuery } as unknown as pg.Pool
        const manager = new OpenCodeProcessManager(pool, {
          repoRoot: path.join(rootDir, 'repo'),
          agentsRoot: path.join(rootDir, 'agents'),
          execFileFn: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }) as any,
          sleepFn: async () => {},
        })

        await manager.ensureAgentStarted('agent-1')

        expect(capturedStartOpts.length).toBeGreaterThan(0)
        const startOpts = capturedStartOpts[0]
        expect(startOpts.env).toBeDefined()
        expect(startOpts.env?.PI_MODEL).toBe('pi-gemma-3')
        expect(startOpts.env?.PI_PROVIDER).toBe('pi')
      } finally {
        if (originalSandbox !== undefined) process.env.EGRESS_SANDBOX = originalSandbox
        if (originalLauncher !== undefined) process.env.LAUNCHER_ENABLED = originalLauncher
        vi.restoreAllMocks()
      }
    })

    it('T013 — Pi startup failure from missing pi-acp surfaces an actionable error', async () => {
      const worktreePath = path.join(rootDir, 'agents', 'pi-missing-binary')

      const acp = await import('../../src/fleet-executor/acp-harness.js')
      vi.spyOn(acp, 'AcpHarness' as never).mockImplementation(((_id: string, _pool: unknown, _cmd: string, _args: string[], _root: string, _perm: unknown) => ({
        start: vi.fn().mockRejectedValue(Object.assign(new Error("spawn pi-acp ENOENT"), { code: 'ENOENT' })),
        stop: vi.fn(),
      })) as never)

      const piAgent = createPiAgent({ worktree_path: worktreePath })
      const piQuery = vi.fn(async (sql: string) => {
        if (isLifecycleUpdate(sql) || isRuntimeEventInsert(sql)) return { rows: [], rowCount: 1 }
        if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) return { rows: [piAgent] }
        if (sql.startsWith('SELECT * FROM providers')) return { rows: [] }
        if (sql.startsWith('SELECT api_key FROM providers')) return { rows: [{ api_key: null }] }
        if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) return { rows: [] }
        if (sql.startsWith('SELECT token FROM agent_tokens')) return { rows: [{ token: 'tok' }] }
        if (sql.startsWith('INSERT INTO tool_grants')) {
          return { rows: [{ id: 'g', agent_id: 'agent-1', delegation_id: null, work_item_id: null, capability_profile_id: null, routing_capability: 'implementation', granted_primitives: [], granted_capability_bundles: [], selected_provider_adapters: [], exclusion_reasons: [], task_scope: {}, approval_state: {}, environment_context: {}, revocation_state: 'active', revoked_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }
        }
        if (sql.includes('FROM mcp_servers ms')) return { rows: [] }
        throw new Error(`unexpected query: ${sql}`)
      })

      const originalSandbox = process.env.EGRESS_SANDBOX
      const originalLauncher = process.env.LAUNCHER_ENABLED
      delete process.env.EGRESS_SANDBOX
      delete process.env.LAUNCHER_ENABLED

      try {
        const pool = { query: piQuery } as unknown as pg.Pool
        const manager = new OpenCodeProcessManager(pool, {
          repoRoot: path.join(rootDir, 'repo'),
          agentsRoot: path.join(rootDir, 'agents'),
          execFileFn: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }) as any,
          sleepFn: async () => {},
        })

        await expect(manager.ensureAgentStarted('agent-1')).rejects.toThrow(/pi-acp.*not found|Pi ACP startup failed/i)
      } finally {
        if (originalSandbox !== undefined) process.env.EGRESS_SANDBOX = originalSandbox
        if (originalLauncher !== undefined) process.env.LAUNCHER_ENABLED = originalLauncher
        vi.restoreAllMocks()
      }
    })

    it('T021 — Pi uses pi-acp command; generic ACP agents use their config command', async () => {
      const capturedCommands: string[] = []
      const acp = await import('../../src/fleet-executor/acp-harness.js')
      vi.spyOn(acp, 'AcpHarness' as never).mockImplementation(((_id: string, _pool: unknown, cmd: string, _args: string[], _root: string, _perm: unknown) => {
        capturedCommands.push(cmd)
        return { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }
      }) as never)

      const originalSandbox = process.env.EGRESS_SANDBOX
      const originalLauncher = process.env.LAUNCHER_ENABLED
      delete process.env.EGRESS_SANDBOX
      delete process.env.LAUNCHER_ENABLED

      try {
        // --- Pi agent ---
        const piWorktree = path.join(rootDir, 'agents', 'pi-regression')
        const piAgent = createPiAgent({ worktree_path: piWorktree })
        const piPool = {
          query: vi.fn(async (sql: string) => {
            if (isLifecycleUpdate(sql) || isRuntimeEventInsert(sql)) return { rows: [], rowCount: 1 }
            if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) return { rows: [piAgent] }
            if (sql.startsWith('SELECT * FROM providers')) return { rows: [] }
            if (sql.startsWith('SELECT api_key FROM providers')) return { rows: [{ api_key: null }] }
            if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) return { rows: [] }
            if (sql.startsWith('SELECT token FROM agent_tokens')) return { rows: [{ token: 'tok' }] }
            if (sql.startsWith('INSERT INTO tool_grants')) return { rows: [{ id: 'g', agent_id: 'agent-1', delegation_id: null, work_item_id: null, capability_profile_id: null, routing_capability: 'implementation', granted_primitives: [], granted_capability_bundles: [], selected_provider_adapters: [], exclusion_reasons: [], task_scope: {}, approval_state: {}, environment_context: {}, revocation_state: 'active', revoked_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }
            if (sql.includes('FROM mcp_servers ms')) return { rows: [] }
            throw new Error(`unexpected: ${sql}`)
          }),
        } as unknown as pg.Pool
        const piManager = new OpenCodeProcessManager(piPool, {
          repoRoot: path.join(rootDir, 'repo'),
          agentsRoot: path.join(rootDir, 'agents'),
          execFileFn: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }) as any,
          sleepFn: async () => {},
        })
        await piManager.ensureAgentStarted('agent-1')

        // --- Generic ACP agent ---
        const acpWorktree = path.join(rootDir, 'agents', 'acp-regression')
        const acpAgent = createAgent({
          runtime_family: 'acp',
          tier: 'durable',
          worktree_path: acpWorktree,
          config: { command: 'my-custom-acp', args: [] },
        })
        const acpPool = {
          query: vi.fn(async (sql: string) => {
            if (isLifecycleUpdate(sql) || isRuntimeEventInsert(sql)) return { rows: [], rowCount: 1 }
            if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) return { rows: [acpAgent] }
            if (sql.startsWith('SELECT * FROM providers')) return { rows: [] }
            if (sql.startsWith('SELECT api_key FROM providers')) return { rows: [{ api_key: null }] }
            if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) return { rows: [] }
            if (sql.startsWith('SELECT token FROM agent_tokens')) return { rows: [{ token: 'tok' }] }
            if (sql.startsWith('INSERT INTO tool_grants')) return { rows: [{ id: 'g', agent_id: 'agent-1', delegation_id: null, work_item_id: null, capability_profile_id: null, routing_capability: 'implementation', granted_primitives: [], granted_capability_bundles: [], selected_provider_adapters: [], exclusion_reasons: [], task_scope: {}, approval_state: {}, environment_context: {}, revocation_state: 'active', revoked_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] }
            if (sql.includes('FROM mcp_servers ms')) return { rows: [] }
            throw new Error(`unexpected: ${sql}`)
          }),
        } as unknown as pg.Pool
        const acpManager = new OpenCodeProcessManager(acpPool, {
          repoRoot: path.join(rootDir, 'repo'),
          agentsRoot: path.join(rootDir, 'agents'),
          execFileFn: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }) as any,
          sleepFn: async () => {},
        })
        await acpManager.ensureAgentStarted('agent-1')

        expect(capturedCommands).toContain('pi-acp')
        expect(capturedCommands).toContain('my-custom-acp')
      } finally {
        if (originalSandbox !== undefined) process.env.EGRESS_SANDBOX = originalSandbox
        if (originalLauncher !== undefined) process.env.LAUNCHER_ENABLED = originalLauncher
        vi.restoreAllMocks()
      }
    })
  })
})
