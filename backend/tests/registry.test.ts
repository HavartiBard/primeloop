import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import {
  getProviderApiKey,
  listProviders,
  insertProvider,
  updateProvider,
  deleteProvider,
  listAgents,
  getAgent,
  insertAgent,
  updateAgent,
  deleteAgent,
  getAgentRuntimeConfig,
  upsertAgentRuntimeConfig,
  insertCapabilityProfile,
  getCapabilityProfile,
  insertCapabilityBundleAdapter,
  listCapabilityBundleAdapters,
  insertToolGrant,
  getToolGrant,
  listToolGrants,
} from '../src/registry.js'
import { resolveToolGrant } from '../src/tool-grants.js'

const TEST_DB = process.env.TEST_DATABASE_URL!
process.env.SECRET_ENCRYPTION_KEY = 'a'.repeat(64)

let pool: pg.Pool

beforeAll(async () => {
  pool = createPool(TEST_DB)
  await runMigrations(pool)
  await pool.query('DELETE FROM tool_grants')
  await pool.query('DELETE FROM capability_bundle_adapters')
  await pool.query('DELETE FROM agent_runtime_configs')
  await pool.query('DELETE FROM capability_profiles')
  await pool.query('DELETE FROM delegations')
  await pool.query('DELETE FROM work_items')
  // Clean slate — agents must be deleted before providers due to FK
  await pool.query('DELETE FROM agents')
  await pool.query('DELETE FROM providers')
})

afterAll(async () => {
  await pool.query('DELETE FROM tool_grants')
  await pool.query('DELETE FROM capability_bundle_adapters')
  await pool.query('DELETE FROM agent_runtime_configs')
  await pool.query('DELETE FROM capability_profiles')
  await pool.query('DELETE FROM delegations')
  await pool.query('DELETE FROM work_items')
  await pool.query('DELETE FROM agents')
  await pool.query('DELETE FROM providers')
  await pool.end()
})

describe('registry — providers', () => {
  it('listProviders — returns empty array initially', async () => {
    const result = await listProviders(pool)
    expect(result).toEqual([])
  })

  it('insertProvider — inserts and returns provider with id', async () => {
    const provider = await insertProvider(pool, {
      name: 'test-provider',
      type: 'openai',
      base_url: 'https://api.openai.com',
      api_key: 'sk-test',
    })
    expect(provider.id).toBeTruthy()
    expect(provider.name).toBe('test-provider')
    expect(provider.type).toBe('openai')
    expect(provider.base_url).toBe('https://api.openai.com')
    expect(provider.api_key).toBe('••••••••')
    expect(provider.created_at).toBeTruthy()
  })

  it('insertProvider — works without api_key', async () => {
    const provider = await insertProvider(pool, {
      name: 'test-provider-no-key',
      type: 'ollama',
      base_url: 'http://localhost:11434',
    })
    expect(provider.id).toBeTruthy()
    expect(provider.api_key).toBeUndefined()
  })

  it('listProviders — returns inserted providers', async () => {
    const result = await listProviders(pool)
    expect(result.length).toBeGreaterThanOrEqual(2)
    const names = result.map((p) => p.name)
    expect(names).toContain('test-provider')
    expect(names).toContain('test-provider-no-key')
  })

  it('getProviderApiKey decrypts stored provider key', async () => {
    const provider = await insertProvider(pool, {
      name: 'decrypt-me-provider',
      type: 'openai',
      base_url: 'https://api.openai.com',
      api_key: 'sk-decrypt-me',
    })
    const apiKey = await getProviderApiKey(pool, provider.id)
    expect(apiKey).toBe('sk-decrypt-me')
  })

  it('updateProvider — updates fields', async () => {
    const provider = await insertProvider(pool, {
      name: 'update-me-provider',
      type: 'openai',
      base_url: 'https://api.openai.com',
    })
    const updated = await updateProvider(pool, provider.id, {
      base_url: 'https://api.openai.com/v2',
      api_key: 'sk-new-key',
    })
    expect(updated.id).toBe(provider.id)
    expect(updated.base_url).toBe('https://api.openai.com/v2')
    expect(updated.api_key).toBe('••••••••')
    expect(updated.name).toBe('update-me-provider')
  })

  it('deleteProvider — removes row', async () => {
    const provider = await insertProvider(pool, {
      name: 'delete-me-provider',
      type: 'openai',
      base_url: 'https://api.openai.com',
    })
    await deleteProvider(pool, provider.id)
    const result = await listProviders(pool)
    const ids = result.map((p) => p.id)
    expect(ids).not.toContain(provider.id)
  })
})

describe('registry — agents', () => {
  let providerId: string

  beforeAll(async () => {
    // Insert a provider for FK references
    const prov = await insertProvider(pool, {
      name: 'agent-test-provider',
      type: 'openai',
      base_url: 'https://api.openai.com',
    })
    providerId = prov.id
  })

  it('listAgents — returns empty array initially', async () => {
    const result = await listAgents(pool)
    expect(result).toEqual([])
  })

  it('insertAgent — inserts and returns agent with id', async () => {
    const agent = await insertAgent(pool, {
      name: 'test-agent',
      type: 'hermes',
      provider_id: providerId,
      runtime_family: 'hermes',
      execution_mode: 'external',
      endpoint: 'http://hermes.example.com',
      capabilities: ['coordination', 'exec'],
      host: 'agent.example.com',
      container_name: 'my-container',
      ssh_user: 'ubuntu',
      config: { timeout: 30 },
      enabled: true,
      local_port: 7777,
      worktree_path: '/tmp/worktree-a',
      workspace_root: '/tmp/agent-a',
      system_prompt: 'Be precise',
      soul: 'Builder spirit',
      tier: 'durable',
      role: 'architect',
      state: 'idle',
      persona_file: 'prompts/agents/architect.md',
    })
    expect(agent.id).toBeTruthy()
    expect(agent.name).toBe('test-agent')
    expect(agent.type).toBe('hermes')
    expect(agent.provider_id).toBe(providerId)
    expect(agent.runtime_family).toBe('hermes')
    expect(agent.execution_mode).toBe('external')
    expect(agent.endpoint).toBe('http://hermes.example.com')
    expect(agent.capabilities).toEqual(['coordination', 'exec'])
    expect(agent.host).toBe('agent.example.com')
    expect(agent.container_name).toBe('my-container')
    expect(agent.ssh_user).toBe('ubuntu')
    expect(agent.config).toEqual({ timeout: 30 })
    expect(agent.enabled).toBe(true)
    expect(agent.local_port).toBe(7777)
    expect(agent.worktree_path).toBe('/tmp/worktree-a')
    expect(agent.workspace_root).toBe('/tmp/agent-a')
    expect(agent.system_prompt).toBe('Be precise')
    expect(agent.soul).toBe('Builder spirit')
    expect(agent.tier).toBe('durable')
    expect(agent.role).toBe('architect')
    expect(agent.state).toBe('idle')
    expect(agent.persona_file).toBe('prompts/agents/architect.md')
    expect(agent.created_at).toBeTruthy()
  })

  it('insertAgent — works with minimal fields', async () => {
    const agent = await insertAgent(pool, {
      name: 'minimal-agent',
      type: 'custom',
      runtime_family: 'custom',
      execution_mode: 'external',
      capabilities: [],
      config: {},
      enabled: true,
    })
    expect(agent.id).toBeTruthy()
    expect(agent.provider_id).toBeNull()
    expect(agent.runtime_family).toBe('custom')
    expect(agent.execution_mode).toBe('external')
    expect(agent.capabilities).toEqual([])
    expect(agent.host).toBeNull()
    expect(agent.container_name).toBeNull()
    expect(agent.ssh_user).toBeNull()
    expect(agent.local_port).toBeNull()
    expect(agent.worktree_path).toBeNull()
    expect(agent.workspace_root).toBeNull()
    expect(agent.system_prompt).toBeNull()
    expect(agent.soul).toBeNull()
    expect(agent.tier).toBe('durable')
    expect(agent.role).toBe('custom')
    expect(agent.state).toBe('ready')
    expect(agent.persona_file).toBe('AGENTS.md')
  })

  it('listAgents — returns inserted agents', async () => {
    const result = await listAgents(pool)
    expect(result.length).toBeGreaterThanOrEqual(2)
    const names = result.map((a) => a.name)
    expect(names).toContain('test-agent')
    expect(names).toContain('minimal-agent')
  })

  it('getAgent — fetches by id', async () => {
    const agent = await insertAgent(pool, {
      name: 'get-me-agent',
      type: 'langgraph',
      runtime_family: 'langgraph',
      execution_mode: 'external',
      capabilities: ['workflow'],
      config: { key: 'value' },
      enabled: false,
      system_prompt: 'Route carefully',
      soul: 'Operations first',
      tier: 'ephemeral',
      role: 'verification',
      state: 'provisioning',
      persona_file: 'prompts/agents/verification.md',
    })
    const fetched = await getAgent(pool, agent.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.id).toBe(agent.id)
    expect(fetched!.name).toBe('get-me-agent')
    expect(fetched!.enabled).toBe(false)
    expect(fetched!.config).toEqual({ key: 'value' })
    expect(fetched!.system_prompt).toBe('Route carefully')
    expect(fetched!.soul).toBe('Operations first')
    expect(fetched!.tier).toBe('ephemeral')
    expect(fetched!.role).toBe('verification')
    expect(fetched!.state).toBe('provisioning')
    expect(fetched!.persona_file).toBe('prompts/agents/verification.md')
  })

  it('getAgent — returns null for unknown id', async () => {
    const result = await getAgent(pool, '00000000-0000-0000-0000-000000000000')
    expect(result).toBeNull()
  })

  it('updateAgent — updates fields', async () => {
    const agent = await insertAgent(pool, {
      name: 'update-me-agent',
      type: 'hermes',
      runtime_family: 'hermes',
      execution_mode: 'external',
      capabilities: [],
      config: { original: true },
      enabled: true,
    })
    const updated = await updateAgent(pool, agent.id, {
      runtime_family: 'openclaw',
      execution_mode: 'portal-managed',
      endpoint: 'http://openclaw.example.com',
      host: 'new-host.example.com',
      enabled: false,
      capabilities: ['research', 'audit'],
      config: { updated: true },
      local_port: 8787,
      worktree_path: '/tmp/worktree-b',
      workspace_root: '/tmp/agent-b',
      system_prompt: 'Review changes',
      soul: 'Skeptical collaborator',
      tier: 'durable',
      role: 'reviewer',
      state: 'busy',
      persona_file: 'prompts/agents/reviewer.md',
    })
    expect(updated.id).toBe(agent.id)
    expect(updated.runtime_family).toBe('openclaw')
    expect(updated.execution_mode).toBe('portal-managed')
    expect(updated.endpoint).toBe('http://openclaw.example.com')
    expect(updated.host).toBe('new-host.example.com')
    expect(updated.enabled).toBe(false)
    expect(updated.capabilities).toEqual(['research', 'audit'])
    expect(updated.config).toEqual({ updated: true })
    expect(updated.local_port).toBe(8787)
    expect(updated.worktree_path).toBe('/tmp/worktree-b')
    expect(updated.workspace_root).toBe('/tmp/agent-b')
    expect(updated.system_prompt).toBe('Review changes')
    expect(updated.soul).toBe('Skeptical collaborator')
    expect(updated.tier).toBe('durable')
    expect(updated.role).toBe('reviewer')
    expect(updated.state).toBe('busy')
    expect(updated.persona_file).toBe('prompts/agents/reviewer.md')
    expect(updated.name).toBe('update-me-agent')
  })

  it('deleteAgent — removes row', async () => {
    const agent = await insertAgent(pool, {
      name: 'delete-me-agent',
      type: 'custom',
      runtime_family: 'custom',
      execution_mode: 'external',
      capabilities: [],
      config: {},
      enabled: true,
    })
    await deleteAgent(pool, agent.id)
    const fetched = await getAgent(pool, agent.id)
    expect(fetched).toBeNull()
  })
})

describe('registry — capability profiles and tool grants', () => {
  it('upsertAgentRuntimeConfig/getAgentRuntimeConfig stores capability profile linkage and defaults', async () => {
    const agent = await insertAgent(pool, {
      name: 'runtime-config-agent',
      type: 'custom',
      runtime_family: 'custom',
      execution_mode: 'local',
      capabilities: ['implementation'],
      config: {},
      enabled: true,
    })
    const profile = await insertCapabilityProfile(pool, {
      name: 'implementation-default',
      description: 'Implementation baseline',
      platform_primitives: ['work_item.update'],
      capability_bundles: ['repo.read'],
      deny_rules: [],
      approval_rules: {},
      config: {},
    })

    const saved = await upsertAgentRuntimeConfig(pool, {
      agent_id: agent.id,
      protocol: 'generic-http',
      trust_zone: 'local',
      workspace_root: '/tmp/runtime-config-agent',
      limits: { cpu: 2 },
      capability_profile_id: profile.id,
      tool_grant_defaults: {
        task_scope: { allowed_bundles: ['repo.read'] },
        approval_state: { approved: true },
      },
    })

    expect(saved.capability_profile_id).toBe(profile.id)
    expect(saved.tool_grant_defaults).toEqual({
      task_scope: { allowed_bundles: ['repo.read'] },
      approval_state: { approved: true },
    })

    const fetched = await getAgentRuntimeConfig(pool, agent.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.capability_profile_id).toBe(profile.id)
    expect(fetched!.workspace_root).toBe('/tmp/runtime-config-agent')
  })

  it('insertCapabilityProfile/getCapabilityProfile persist a reusable profile', async () => {
    const profile = await insertCapabilityProfile(pool, {
      name: 'ephemeral-qa-default',
      description: 'Minimal read-only QA profile',
      platform_primitives: ['update_work_item'],
      capability_bundles: ['repo.read', 'ci.inspect'],
      deny_rules: [{ bundle: 'repo.write', reason: 'read-only' }],
      approval_rules: { 'deploy.production': 'approval-required' },
      config: { tier: 'ephemeral' },
    })
    expect(profile.id).toBeTruthy()
    expect(profile.capability_bundles).toEqual(['repo.read', 'ci.inspect'])

    const fetched = await getCapabilityProfile(pool, profile.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.platform_primitives).toEqual(['update_work_item'])
    expect(fetched!.deny_rules).toEqual([{ bundle: 'repo.write', reason: 'read-only' }])
  })

  it('insertCapabilityBundleAdapter/listCapabilityBundleAdapters preserve provider adapter mapping', async () => {
    await insertCapabilityBundleAdapter(pool, {
      capability_bundle: 'repo.read',
      provider_adapter_kind: 'mcp_server',
      provider_adapter_ref: 'gitea',
      priority: 5,
      config: { transport: 'http' },
    })

    const adapters = await listCapabilityBundleAdapters(pool, 'repo.read')
    expect(adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability_bundle: 'repo.read',
          provider_adapter_kind: 'mcp_server',
          provider_adapter_ref: 'gitea',
          priority: 5,
        }),
      ]),
    )
  })

  it('insertToolGrant/getToolGrant persist run-scoped granted and excluded access', async () => {
    const agent = await insertAgent(pool, {
      name: 'grant-target-agent',
      type: 'custom',
      runtime_family: 'custom',
      execution_mode: 'local',
      capabilities: ['implementation'],
      config: {},
      enabled: true,
      tier: 'ephemeral',
      role: 'implementation',
      state: 'busy',
    })
    const profile = await insertCapabilityProfile(pool, {
      name: 'grant-target-profile',
      description: 'Implementation profile',
      platform_primitives: ['update_work_item'],
      capability_bundles: ['repo.read'],
      deny_rules: [],
      approval_rules: {},
      config: {},
    })
    const workItem = await pool.query(
      `INSERT INTO work_items (title) VALUES ('Implement slice 1') RETURNING id`,
    )
    const delegation = await pool.query(
      `INSERT INTO delegations (work_item_id, capability, request)
       VALUES ($1, $2, $3)
       RETURNING id, capability`,
      [workItem.rows[0].id, 'implementation', '{}'],
    )
    expect(delegation.rows[0].capability).toBe('implementation')

    const grant = await insertToolGrant(pool, {
      agent_id: agent.id,
      delegation_id: delegation.rows[0].id,
      work_item_id: workItem.rows[0].id,
      capability_profile_id: profile.id,
      routing_capability: 'implementation',
      granted_primitives: ['update_work_item'],
      granted_capability_bundles: ['repo.read'],
      selected_provider_adapters: [{ kind: 'mcp_server', ref: 'gitea' }],
      exclusion_reasons: [{ kind: 'approval', bundle: 'deploy.production', reason: 'missing approval' }],
      task_scope: { allowed_files: ['backend/src/db.ts'] },
      approval_state: { approved: false },
      environment_context: { environment: 'test' },
      revocation_state: 'active',
    })
    expect(grant.id).toBeTruthy()
    expect(grant.routing_capability).toBe('implementation')
    expect(grant.granted_capability_bundles).toEqual(['repo.read'])

    const fetched = await getToolGrant(pool, grant.id)
    expect(fetched).not.toBeNull()
    expect(fetched!.selected_provider_adapters).toEqual([{ kind: 'mcp_server', ref: 'gitea' }])
    expect(fetched!.exclusion_reasons).toEqual([
      { kind: 'approval', bundle: 'deploy.production', reason: 'missing approval' },
    ])
    expect(fetched!.revocation_state).toBe('active')
  })

  it('resolveToolGrant persists distinct grants for the same routing capability by role and task scope', async () => {
    const architect = await insertAgent(pool, {
      name: 'architect-agent',
      type: 'custom',
      runtime_family: 'custom',
      execution_mode: 'local',
      capabilities: ['implementation'],
      config: {},
      enabled: true,
      role: 'architect',
      tier: 'durable',
      state: 'idle',
    })
    const reviewer = await insertAgent(pool, {
      name: 'qa-agent',
      type: 'custom',
      runtime_family: 'custom',
      execution_mode: 'local',
      capabilities: ['implementation'],
      config: {},
      enabled: true,
      role: 'qa-specialist',
      tier: 'ephemeral',
      state: 'busy',
    })
    const profile = await insertCapabilityProfile(pool, {
      name: 'implementation-bundle',
      description: 'Shared implementation profile',
      platform_primitives: ['work_item.update', 'approval.request'],
      capability_bundles: ['repo.read', 'repo.write', 'deploy.production'],
      deny_rules: [
        {
          kind: 'bundle',
          bundle: 'repo.write',
          reason: 'qa role is read-only',
          roles: ['qa-specialist'],
        },
      ],
      approval_rules: {
        'deploy.production': 'approval-required',
      },
      config: {},
    })
    await insertCapabilityBundleAdapter(pool, {
      capability_bundle: 'repo.read',
      provider_adapter_kind: 'mcp_server',
      provider_adapter_ref: 'gitea-read',
      priority: 1,
      config: { transport: 'http' },
    })
    await insertCapabilityBundleAdapter(pool, {
      capability_bundle: 'repo.write',
      provider_adapter_kind: 'mcp_server',
      provider_adapter_ref: 'gitea-write',
      priority: 1,
      config: { transport: 'http' },
    })
    await insertCapabilityBundleAdapter(pool, {
      capability_bundle: 'deploy.production',
      provider_adapter_kind: 'mcp_server',
      provider_adapter_ref: 'gitea-deploy',
      priority: 1,
      config: { transport: 'http' },
    })

    await upsertAgentRuntimeConfig(pool, {
      agent_id: architect.id,
      protocol: 'generic-http',
      trust_zone: 'local',
      workspace_root: '/tmp/architect',
      limits: {},
      capability_profile_id: profile.id,
      tool_grant_defaults: {
        approval_state: { approved: true },
        environment_context: {
          available_provider_adapters: {
            'mcp_server:gitea-read': true,
            'mcp_server:gitea-write': true,
            'mcp_server:gitea-deploy': true,
          },
          provider_adapter_health: {
            'mcp_server:gitea-read': 'healthy',
            'mcp_server:gitea-write': 'healthy',
            'mcp_server:gitea-deploy': 'healthy',
          },
        },
      },
    })

    await upsertAgentRuntimeConfig(pool, {
      agent_id: reviewer.id,
      protocol: 'generic-http',
      trust_zone: 'local',
      workspace_root: '/tmp/qa',
      limits: {},
      capability_profile_id: profile.id,
      tool_grant_defaults: {
        task_scope: { allowed_primitives: ['work_item.update'] },
        approval_state: { approved: false },
        environment_context: {
          available_provider_adapters: {
            'mcp_server:gitea-read': true,
            'mcp_server:gitea-write': true,
            'mcp_server:gitea-deploy': true,
          },
          provider_adapter_health: {
            'mcp_server:gitea-read': 'healthy',
            'mcp_server:gitea-write': 'healthy',
            'mcp_server:gitea-deploy': 'healthy',
          },
        },
      },
    })

    const workItem = await pool.query(
      `INSERT INTO work_items (title) VALUES ('Resolve grants') RETURNING id`,
    )
    const delegation = await pool.query(
      `INSERT INTO delegations (work_item_id, capability, request)
       VALUES ($1, $2, $3)
       RETURNING id, capability`,
      [workItem.rows[0].id, 'implementation', '{}'],
    )

    const architectGrant = await resolveToolGrant(pool, {
      agent: architect,
      routingCapability: 'implementation',
      delegationId: delegation.rows[0].id,
      workItemId: workItem.rows[0].id,
      fallbackProviderAdapters: [],
    })
    const reviewerGrant = await resolveToolGrant(pool, {
      agent: reviewer,
      routingCapability: 'implementation',
      delegationId: delegation.rows[0].id,
      workItemId: workItem.rows[0].id,
      fallbackProviderAdapters: [],
    })

    expect(architectGrant.granted_capability_bundles).toEqual(['repo.read', 'repo.write', 'deploy.production'])
    expect(reviewerGrant.granted_capability_bundles).toEqual(['repo.read'])
    expect(architectGrant.selected_provider_adapters).toHaveLength(3)
    expect(reviewerGrant.selected_provider_adapters).toHaveLength(1)
    expect(reviewerGrant.exclusion_reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'deny', target: 'repo.write' }),
        expect.objectContaining({ kind: 'approval', target: 'deploy.production' }),
      ]),
    )

    const byAgent = await listToolGrants(pool, { agent_id: reviewer.id })
    const byDelegation = await listToolGrants(pool, { delegation_id: delegation.rows[0].id })
    const byWorkItem = await listToolGrants(pool, { work_item_id: workItem.rows[0].id })
    expect(byAgent.map((row) => row.id)).toContain(reviewerGrant.id)
    expect(byDelegation.map((row) => row.id)).toEqual(expect.arrayContaining([architectGrant.id, reviewerGrant.id]))
    expect(byWorkItem.map((row) => row.id)).toEqual(expect.arrayContaining([architectGrant.id, reviewerGrant.id]))
  })
})
