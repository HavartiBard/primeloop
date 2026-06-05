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
        agent_runtime_configs,
        delegations,
        work_items,
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
    // Accept either legacy approvals shape or Primeloop approvals shape.
    expect(cols).toEqual(expect.arrayContaining(['created_at', 'status']))
    expect(
      cols.includes('approval_id') || cols.includes('id')
    ).toBe(true)

    const byName = Object.fromEntries(
      res.rows.map((r: { column_name: string; data_type: string }) => [r.column_name, r.data_type])
    )
    expect(byName['created_at']).toBe('timestamp with time zone')
    if (byName['decided_at']) {
      expect(byName['decided_at']).toBe('timestamp with time zone')
    }
    if (byName['resolved_at']) {
      expect(byName['resolved_at']).toBe('timestamp with time zone')
    }
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
        'local_port', 'worktree_path', 'system_prompt', 'soul',
      ])
    )
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
      'agent_patterns',
      'agent_pattern_assignments',
      'agent_memories',
      'agent_lessons',
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
