import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { createPool, runMigrations, seedRegistry } from '../src/db.js'

const TEST_DB = process.env.TEST_DATABASE_URL!

describe('db schema', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
  })

  afterAll(async () => {
    await pool.query(`
      DROP TABLE IF EXISTS
        runtime_events,
        artifacts,
        audit_runs,
        audit_loops,
        tool_invocations,
        permission_rules,
        tool_servers,
        tool_grants,
        capability_bundle_adapters,
        agent_runtime_configs,
        capability_profiles,
        delegations,
        work_items,
        checkpoint_continuations,
        prime_queue_items,
        prime_agent_module_runs,
        prime_agent_module_audits,
        prime_agent_modules,
        prime_agent_sessions,
        prime_agent_config,
        agent_workspace_config,
        memories,
        thread_messages,
        threads,
        chief_profiles,
        portal_state,
        agents,
        providers,
        agent_lessons,
        agent_memories,
        agent_pattern_assignments,
        agent_patterns,
        agent_mcp_assignments,
        mcp_servers,
        agent_tokens,
        agent_heartbeat,
        approvals,
        event_log
      CASCADE
    `)
    await pool.end()
  })

  it('creates event_log table', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'event_log' ORDER BY column_name`
    )
    const cols = res.rows.map((r: { column_name: string }) => r.column_name)
    expect(cols).toEqual(expect.arrayContaining(['agent', 'created_at', 'id', 'payload', 'type']))
  })

  it('creates approvals table', async () => {
    const res = await pool.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'approvals' ORDER BY column_name`
    )
    const cols = res.rows.map((r: { column_name: string }) => r.column_name)
    expect(cols).toEqual(
      expect.arrayContaining(['action', 'approval_id', 'created_at', 'decided_at', 'run_id', 'status'])
    )
    const byName = Object.fromEntries(
      res.rows.map((r: { column_name: string; data_type: string }) => [r.column_name, r.data_type])
    )
    expect(byName['created_at']).toBe('timestamp with time zone')
    expect(byName['decided_at']).toBe('timestamp with time zone')
  })

  it('creates agent_heartbeat table', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'agent_heartbeat' ORDER BY column_name`
    )
    const cols = res.rows.map((r: { column_name: string }) => r.column_name)
    expect(cols).toEqual(expect.arrayContaining(['agent', 'healthy', 'last_seen']))
  })

  it('creates providers table with correct columns', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'providers' ORDER BY column_name`
    )
    const cols = res.rows.map((r: { column_name: string }) => r.column_name)
    expect(cols).toEqual(
      expect.arrayContaining(['id', 'name', 'type', 'base_url', 'api_key', 'model', 'created_at'])
    )
  })

  it('creates agents table with correct columns', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'agents' ORDER BY column_name`
    )
    const cols = res.rows.map((r: { column_name: string }) => r.column_name)
    expect(cols).toEqual(
      expect.arrayContaining([
        'id', 'name', 'type', 'provider_id', 'host',
        'runtime_family', 'execution_mode', 'endpoint', 'capabilities',
        'container_name', 'ssh_user', 'config', 'enabled', 'created_at',
        'local_port', 'worktree_path', 'workspace_root', 'system_prompt', 'soul',
        'tier', 'role', 'state', 'persona_file',
      ])
    )
  })

  it('keeps Prime native instead of creating a worker row', async () => {
    const primeConfig = await pool.query(`SELECT id, enabled FROM prime_agent_config WHERE id = 'default'`)
    expect(primeConfig.rows).toHaveLength(1)

    const agents = await pool.query(`SELECT count(*)::int AS count FROM agents WHERE is_prime = true`)
    expect(agents.rows[0].count).toBe(0)
  })

  it('keeps delegations.capability as the routing label column', async () => {
    const res = await pool.query(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_name = 'delegations' AND column_name = 'capability'`
    )
    expect(res.rows).toEqual([{ column_name: 'capability', data_type: 'text' }])
  })

  it('adds policy linkage fields to agent_runtime_configs', async () => {
    const res = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'agent_runtime_configs'
       ORDER BY column_name`
    )
    const cols = res.rows.map((r: { column_name: string }) => r.column_name)
    expect(cols).toEqual(expect.arrayContaining(['capability_profile_id', 'tool_grant_defaults']))
  })

  it('creates portal_state table with correct columns', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'portal_state' ORDER BY column_name`
    )
    const cols = res.rows.map((r: { column_name: string }) => r.column_name)
    expect(cols).toEqual(
      expect.arrayContaining([
        'singleton_key', 'chief_profile', 'work_items', 'status_updates',
        'permission_rules', 'audit_loops', 'updated_at',
      ])
    )
  })

  it('creates runtime coordination tables', async () => {
    const expected = [
      'chief_profiles',
      'threads',
      'thread_messages',
      'memories',
      'work_items',
      'delegations',
      'agent_runtime_configs',
      'tool_servers',
      'tool_invocations',
      'permission_rules',
      'audit_loops',
      'audit_runs',
      'artifacts',
      'runtime_events',
      'agent_tokens',
      'mcp_servers',
      'agent_mcp_assignments',
      'capability_profiles',
      'capability_bundle_adapters',
      'tool_grants',
      'agent_patterns',
      'agent_pattern_assignments',
      'agent_memories',
      'agent_lessons',
      'prime_agent_config',
      'prime_agent_sessions',
      'prime_agent_modules',
      'prime_agent_module_audits',
      'prime_agent_module_runs',
      'prime_queue_items',
      'checkpoint_continuations',
      'agent_workspace_config',
    ]
    const res = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)
       ORDER BY table_name`,
      [expected]
    )
    const names = res.rows.map((r: { table_name: string }) => r.table_name)
    expect(names).toEqual(expect.arrayContaining(expected))
  })

  it('persists durable and ephemeral agent lifecycle fields', async () => {
    const durable = await pool.query(
      `INSERT INTO agents (
        name, type, runtime_family, execution_mode, capabilities, config,
        tier, role, state, persona_file, workspace_root, worktree_path
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING tier, role, state, persona_file, workspace_root, worktree_path`,
      [
        'durable-architect',
        'custom',
        'custom',
        'local',
        '[]',
        '{}',
        'durable',
        'architect',
        'idle',
        'prompts/agents/architect.md',
        '/tmp/agents/architect',
        '/tmp/worktrees/architect',
      ],
    )
    expect(durable.rows[0]).toMatchObject({
      tier: 'durable',
      role: 'architect',
      state: 'idle',
      persona_file: 'prompts/agents/architect.md',
      workspace_root: '/tmp/agents/architect',
      worktree_path: '/tmp/worktrees/architect',
    })

    const ephemeral = await pool.query(
      `INSERT INTO agents (
        name, type, runtime_family, execution_mode, capabilities, config,
        tier, role, state, persona_file, workspace_root
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING tier, role, state, persona_file, workspace_root`,
      [
        'ephemeral-qa',
        'custom',
        'custom',
        'local',
        '[]',
        '{}',
        'ephemeral',
        'qa-specialist',
        'provisioning',
        'prompts/agents/qa.md',
        '/tmp/agents/ephemeral-qa',
      ],
    )
    expect(ephemeral.rows[0]).toMatchObject({
      tier: 'ephemeral',
      role: 'qa-specialist',
      state: 'provisioning',
      persona_file: 'prompts/agents/qa.md',
      workspace_root: '/tmp/agents/ephemeral-qa',
    })
  })

  it('persists capability profiles, adapter mappings, and tool grants', async () => {
    const agentRes = await pool.query(
      `INSERT INTO agents (name, type, runtime_family, execution_mode, capabilities, config)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      ['grant-agent', 'custom', 'custom', 'local', '[]', '{}'],
    )
    const workItemRes = await pool.query(
      `INSERT INTO work_items (title) VALUES ('Inspect schema') RETURNING id`,
    )
    const delegationRes = await pool.query(
      `INSERT INTO delegations (work_item_id, status, capability, request)
       VALUES ($1, 'queued', 'implementation', '{}')
       RETURNING id, capability`,
      [workItemRes.rows[0].id],
    )
    expect(delegationRes.rows[0].capability).toBe('implementation')

    const profileRes = await pool.query(
      `INSERT INTO capability_profiles (
        name, description, platform_primitives, capability_bundles, deny_rules, approval_rules, config
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name, capability_bundles`,
      [
        'durable-architect-default',
        'Default profile for architect',
        '["update_work_item"]',
        '["repo.read","repo.write"]',
        '[]',
        '{"deploy.production":"approval-required"}',
        '{"tier":"durable"}',
      ],
    )
    expect(profileRes.rows[0]).toMatchObject({
      name: 'durable-architect-default',
      capability_bundles: ['repo.read', 'repo.write'],
    })

    const adapterRes = await pool.query(
      `INSERT INTO capability_bundle_adapters (
        capability_bundle, provider_adapter_kind, provider_adapter_ref, priority, config
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING capability_bundle, provider_adapter_kind, provider_adapter_ref`,
      ['repo.read', 'mcp_server', 'gitea', 10, '{"transport":"http"}'],
    )
    expect(adapterRes.rows[0]).toMatchObject({
      capability_bundle: 'repo.read',
      provider_adapter_kind: 'mcp_server',
      provider_adapter_ref: 'gitea',
    })

    const grantRes = await pool.query(
      `INSERT INTO tool_grants (
        agent_id, delegation_id, work_item_id, capability_profile_id, routing_capability,
        granted_primitives, granted_capability_bundles, selected_provider_adapters,
        exclusion_reasons, task_scope, approval_state, environment_context, revocation_state
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING routing_capability, granted_primitives, granted_capability_bundles,
                selected_provider_adapters, exclusion_reasons, revocation_state`,
      [
        agentRes.rows[0].id,
        delegationRes.rows[0].id,
        workItemRes.rows[0].id,
        profileRes.rows[0].id,
        'implementation',
        '["update_work_item"]',
        '["repo.read"]',
        '[{"kind":"mcp_server","ref":"gitea"}]',
        '[{"kind":"approval","bundle":"deploy.production","reason":"not-approved"}]',
        '{"allowed_files":["backend/src/db.ts"]}',
        '{"approved":false}',
        '{"environment":"test"}',
        'active',
      ],
    )
    expect(grantRes.rows[0]).toMatchObject({
      routing_capability: 'implementation',
      granted_primitives: ['update_work_item'],
      granted_capability_bundles: ['repo.read'],
      selected_provider_adapters: [{ kind: 'mcp_server', ref: 'gitea' }],
      exclusion_reasons: [{ kind: 'approval', bundle: 'deploy.production', reason: 'not-approved' }],
      revocation_state: 'active',
    })
  })
})

describe('seedRegistry', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    // Clean agents table before each suite run
    await pool.query('DELETE FROM agents')
  })

  afterAll(async () => {
    await pool.query('DELETE FROM agents')
    await pool.end()
  })

  it('inserts a raclette agent when RACLETTE_API_URL is set', async () => {
    await seedRegistry(pool, { RACLETTE_API_URL: 'http://raclette.example.com' })
    const res = await pool.query(`SELECT name, type, config FROM agents WHERE name = 'raclette'`)
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].name).toBe('raclette')
    expect(res.rows[0].type).toBe('hermes')
    expect(res.rows[0].config).toEqual({ api_url: 'http://raclette.example.com' })
  })

  it('is idempotent — calling twice does not duplicate rows', async () => {
    await seedRegistry(pool, { RACLETTE_API_URL: 'http://raclette.example.com' })
    const res = await pool.query(`SELECT count(*)::int AS count FROM agents WHERE name = 'raclette'`)
    expect(res.rows[0].count).toBe(1)
  })

  it('inserts a langgraph agent when LANGGRAPH_API_URL is set', async () => {
    await pool.query('DELETE FROM agents')
    await seedRegistry(pool, { LANGGRAPH_API_URL: 'http://langgraph.example.com' })
    const res = await pool.query(`SELECT name, type, config FROM agents WHERE name = 'langgraph'`)
    expect(res.rows).toHaveLength(1)
    expect(res.rows[0].type).toBe('langgraph')
    expect(res.rows[0].config).toEqual({ api_url: 'http://langgraph.example.com' })
  })

  it('inserts nothing when no env vars are set', async () => {
    await pool.query('DELETE FROM agents')
    await seedRegistry(pool, {})
    const res = await pool.query(`SELECT count(*)::int AS count FROM agents`)
    expect(res.rows[0].count).toBe(0)
  })
})
