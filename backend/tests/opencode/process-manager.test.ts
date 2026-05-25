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
})
