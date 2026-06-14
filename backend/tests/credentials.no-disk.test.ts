import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import { OpenCodeProcessManager } from '../src/opencode/process-manager.js'
import type { RegistryAgent } from '../src/registry.js'

function createAgent(worktreePath: string): RegistryAgent {
  return {
    id: 'agent-1',
    name: 'Secret Safe Agent',
    type: 'codex-thread',
    provider_id: 'provider-1',
    // ephemeral so syncAgent starts the runtime immediately (durable agents are lazily
    // provisioned post-T057); the no-disk + env-injection assertions need a spawn.
    tier: 'ephemeral',
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
    worktree_path: worktreePath,
    system_prompt: 'Ship working code',
    soul: 'Calm builder',
  }
}

function isLifecycleUpdate(sql: string): boolean {
  return sql.includes('UPDATE agents') && sql.includes('SET state = $2')
}

function isRuntimeEventInsert(sql: string): boolean {
  return sql.includes('INSERT INTO runtime_events')
}

describe('credentials.no-disk (T023)', () => {
  let rootDir: string

  afterEach(async () => {
    if (rootDir) await rm(rootDir, { recursive: true, force: true })
    delete process.env.CREDENTIAL_BROKER
  })

  it('does not write brokered MCP or control-plane secrets into the worktree/config files', async () => {
    process.env.CREDENTIAL_BROKER = '1'
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'credentials-no-disk-'))

    const worktreePath = path.join(rootDir, 'agents', 'secret-safe-agent')
    const child = { kill: vi.fn().mockReturnValue(true), on: vi.fn(), stdout: null, stderr: null }
    const spawnFn = vi.fn().mockReturnValue(child)
    const fetchFn = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    const execFileFn = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })

    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (isLifecycleUpdate(sql) || isRuntimeEventInsert(sql)) return { rows: [], rowCount: 1 }
      if (sql.startsWith('SELECT * FROM agents WHERE id = $1')) {
        return { rows: [createAgent(worktreePath)] }
      }
      if (sql.startsWith('SELECT * FROM providers')) {
        return { rows: [{ id: 'provider-1', type: 'llm', model: 'anthropic/claude-sonnet-4-5', base_url: 'https://proxy.example.com', api_key: 'encrypted' }] }
      }
      if (sql.startsWith('SELECT * FROM agent_runtime_configs WHERE agent_id = $1')) return { rows: [] }
      if (sql.startsWith('INSERT INTO tool_grants')) {
        return {
          rows: [{
            id: 'grant-1', agent_id: 'agent-1', delegation_id: null, work_item_id: null, capability_profile_id: null,
            routing_capability: 'implementation', granted_primitives: [], granted_capability_bundles: [],
            selected_provider_adapters: [{ kind: 'http', ref: 'gitea' }], exclusion_reasons: [], task_scope: {}, approval_state: {},
            environment_context: {}, revocation_state: 'active', revoked_at: null,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
          }],
        }
      }
      if (sql.includes('FROM mcp_servers ms')) {
        return { rows: [{ id: 'mcp-1', name: 'gitea', description: 'Pull requests and issues', type: 'http', url: 'http://gitea:3000/mcp', env_vars: { GITEA_TOKEN: 'super-secret-token' } }] }
      }
      if (sql.startsWith('SELECT api_key FROM providers')) return { rows: [{ api_key: null }] }
      if (sql.startsWith("UPDATE brokered_credentials SET status = 'revoked'")) return { rows: [] }
      if (sql.startsWith('INSERT INTO brokered_credentials')) {
        const kind = params?.[1]
        if (kind === 'provider_proxy_token') return { rows: [{ id: 'cred-proxy', expires_at: new Date().toISOString() }] }
        if (kind === 'launcher_token') return { rows: [{ id: 'cred-launcher', expires_at: new Date().toISOString() }] }
        return { rows: [{ id: 'cred-secret', expires_at: new Date().toISOString() }] }
      }
      throw new Error(`unexpected query: ${sql}`)
    })

    const manager = new OpenCodeProcessManager({ query } as unknown as pg.Pool, {
      repoRoot: path.join(rootDir, 'repo'),
      agentsRoot: path.join(rootDir, 'agents'),
      controlPlaneUrl: 'http://localhost:3100',
      spawnFn: spawnFn as any,
      fetchFn: fetchFn as any,
      execFileFn: execFileFn as any,
      sleepFn: async () => {},
    })

    await manager.syncAgent(createAgent(worktreePath))

    const files = ['AGENTS.md', 'soul.md', 'TOOLS.md', 'control-plane-tools.json', 'opencode.json', 'soullayer.json']
    const contents = await Promise.all(files.map((file) => readFile(path.join(worktreePath, file), 'utf8')))
    const combined = contents.join('\n')

    expect(combined).not.toContain('super-secret-token')
    expect(combined).not.toContain('GITEA_TOKEN')
    expect(combined).not.toContain('CONTROL_PLANE_AGENT_TOKEN')
    expect(combined).not.toContain('LLM_PROXY_TOKEN')

    expect(spawnFn).toHaveBeenCalledWith('opencode', ['serve', '--port', '4200'], expect.objectContaining({
      env: expect.objectContaining({
        GITEA_TOKEN: 'super-secret-token',
        CONTROL_PLANE_AGENT_TOKEN: expect.any(String),
      }),
    }))
  })
})
