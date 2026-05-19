import pg from 'pg'

const { Pool } = pg

export function createPool(connectionString: string): pg.Pool {
  return new Pool({ connectionString })
}

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_log (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent      TEXT NOT NULL,
      type       TEXT NOT NULL,
      payload    JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS approvals (
      approval_id TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL,
      action      TEXT NOT NULL,
      status      TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at  TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS agent_heartbeat (
      agent     TEXT PRIMARY KEY,
      last_seen TIMESTAMPTZ NOT NULL,
      healthy   BOOL NOT NULL DEFAULT true
    );

    CREATE INDEX IF NOT EXISTS idx_event_log_agent_created_at ON event_log (agent, created_at DESC);

    CREATE TABLE IF NOT EXISTS providers (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL UNIQUE,
      type       TEXT NOT NULL,
      base_url   TEXT NOT NULL,
      api_key    TEXT,
      timeout_ms INT NOT NULL DEFAULT 120000,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agents (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name           TEXT NOT NULL UNIQUE,
      type           TEXT NOT NULL,
      provider_id    UUID REFERENCES providers(id) ON DELETE SET NULL,
      runtime_family TEXT NOT NULL DEFAULT 'custom',
      execution_mode TEXT NOT NULL DEFAULT 'external',
      endpoint       TEXT,
      capabilities   JSONB NOT NULL DEFAULT '[]',
      host           TEXT,
      container_name TEXT,
      ssh_user       TEXT,
      config         JSONB DEFAULT '{}',
      enabled        BOOLEAN DEFAULT true,
      created_at     TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS portal_state (
      singleton_key   TEXT PRIMARY KEY,
      chief_profile   JSONB NOT NULL,
      work_items      JSONB NOT NULL,
      status_updates  JSONB NOT NULL,
      permission_rules JSONB NOT NULL,
      audit_loops     JSONB NOT NULL,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_type_check;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS runtime_family TEXT NOT NULL DEFAULT 'custom';
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'external';
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS endpoint TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS capabilities JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_prime BOOLEAN NOT NULL DEFAULT false;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_single_prime ON agents (is_prime) WHERE is_prime;

    CREATE TABLE IF NOT EXISTS chief_profiles (
      id                TEXT PRIMARY KEY DEFAULT 'default',
      name              TEXT NOT NULL DEFAULT 'Prime',
      persona           TEXT NOT NULL,
      operating_policy  TEXT NOT NULL,
      delegation_policy JSONB NOT NULL DEFAULT '{}',
      default_provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS threads (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title      TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'active',
      metadata   JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS thread_messages (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id  UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      role       TEXT NOT NULL,
      sender     TEXT NOT NULL,
      content    TEXT NOT NULL,
      metadata   JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_thread_messages_thread_created_at
      ON thread_messages (thread_id, created_at);

    CREATE TABLE IF NOT EXISTS memories (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category         TEXT NOT NULL,
      content          TEXT NOT NULL,
      source_thread_id UUID REFERENCES threads(id) ON DELETE SET NULL,
      metadata         JSONB NOT NULL DEFAULT '{}',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_memories_category_created_at
      ON memories (category, created_at DESC);

    CREATE TABLE IF NOT EXISTS work_items (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title          TEXT NOT NULL,
      description    TEXT,
      status         TEXT NOT NULL DEFAULT 'active',
      priority       TEXT NOT NULL DEFAULT 'normal',
      lane           TEXT NOT NULL DEFAULT 'operations',
      owner_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      owner_label    TEXT NOT NULL DEFAULT 'Prime',
      thread_id      UUID REFERENCES threads(id) ON DELETE SET NULL,
      parent_id      UUID REFERENCES work_items(id) ON DELETE SET NULL,
      blocked_by     TEXT,
      due_at         TIMESTAMPTZ,
      metadata       JSONB NOT NULL DEFAULT '{}',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_work_items_status_updated_at
      ON work_items (status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS delegations (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      work_item_id   UUID REFERENCES work_items(id) ON DELETE SET NULL,
      from_agent_id  UUID REFERENCES agents(id) ON DELETE SET NULL,
      to_agent_id    UUID REFERENCES agents(id) ON DELETE SET NULL,
      status         TEXT NOT NULL DEFAULT 'queued',
      capability     TEXT NOT NULL,
      request        JSONB NOT NULL DEFAULT '{}',
      result         JSONB NOT NULL DEFAULT '{}',
      trace          JSONB NOT NULL DEFAULT '[]',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      completed_at   TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_delegations_status_updated_at
      ON delegations (status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_runtime_configs (
      agent_id       UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      protocol       TEXT NOT NULL DEFAULT 'generic-http',
      auth_ref       TEXT,
      trust_zone     TEXT NOT NULL DEFAULT 'local',
      workspace_root TEXT,
      limits         JSONB NOT NULL DEFAULT '{}',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tool_servers (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL UNIQUE,
      type       TEXT NOT NULL,
      endpoint   TEXT,
      config     JSONB NOT NULL DEFAULT '{}',
      enabled    BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS permission_rules (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      scope      TEXT NOT NULL,
      mode       TEXT NOT NULL,
      rule       JSONB NOT NULL DEFAULT '{}',
      enabled    BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tool_invocations (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      work_item_id   UUID REFERENCES work_items(id) ON DELETE SET NULL,
      delegation_id  UUID REFERENCES delegations(id) ON DELETE SET NULL,
      tool_server_id UUID REFERENCES tool_servers(id) ON DELETE SET NULL,
      tool_name      TEXT NOT NULL,
      command        TEXT,
      args           JSONB NOT NULL DEFAULT '{}',
      status         TEXT NOT NULL DEFAULT 'queued',
      approval_id    TEXT REFERENCES approvals(approval_id) ON DELETE SET NULL,
      result         JSONB NOT NULL DEFAULT '{}',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS audit_loops (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name         TEXT NOT NULL UNIQUE,
      purpose      TEXT NOT NULL,
      cadence_cron TEXT NOT NULL,
      enabled      BOOLEAN NOT NULL DEFAULT true,
      config       JSONB NOT NULL DEFAULT '{}',
      last_run_at  TIMESTAMPTZ,
      next_run_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS audit_runs (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      audit_loop_id UUID REFERENCES audit_loops(id) ON DELETE SET NULL,
      status        TEXT NOT NULL DEFAULT 'running',
      result        JSONB NOT NULL DEFAULT '{}',
      started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at   TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      work_item_id  UUID REFERENCES work_items(id) ON DELETE SET NULL,
      delegation_id UUID REFERENCES delegations(id) ON DELETE SET NULL,
      kind          TEXT NOT NULL,
      title         TEXT NOT NULL,
      uri           TEXT,
      metadata      JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS runtime_events (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type    TEXT NOT NULL,
      actor         TEXT NOT NULL,
      thread_id     UUID REFERENCES threads(id) ON DELETE SET NULL,
      work_item_id  UUID REFERENCES work_items(id) ON DELETE SET NULL,
      delegation_id UUID REFERENCES delegations(id) ON DELETE SET NULL,
      payload       JSONB NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_runtime_events_created_at
      ON runtime_events (created_at DESC);

    ALTER TABLE providers ADD COLUMN IF NOT EXISTS model TEXT;
    ALTER TABLE providers ADD COLUMN IF NOT EXISTS timeout_ms INT NOT NULL DEFAULT 120000;

    ALTER TABLE agents ADD COLUMN IF NOT EXISTS local_port INTEGER;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS worktree_path TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS system_prompt TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS soul TEXT;

    CREATE TABLE IF NOT EXISTS agent_tokens (
      agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      token TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      type TEXT NOT NULL CHECK (type IN ('http', 'stdio')),
      url TEXT,
      command TEXT,
      args TEXT[],
      env_vars JSONB,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_mcp_assignments (
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      mcp_server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
      PRIMARY KEY (agent_id, mcp_server_id)
    );

    CREATE TABLE IF NOT EXISTS agent_patterns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL CHECK (type IN ('best_practice', 'antipattern')),
      content TEXT NOT NULL,
      severity TEXT DEFAULT 'info',
      source_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      published_by UUID REFERENCES agents(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_pattern_assignments (
      pattern_id UUID NOT NULL REFERENCES agent_patterns(id) ON DELETE CASCADE,
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      PRIMARY KEY (pattern_id, agent_id)
    );

    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS agent_memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      category TEXT,
      tags TEXT[],
      importance INT DEFAULT 3,
      embedding vector(384),
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_lessons (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      context TEXT,
      category TEXT,
      severity TEXT DEFAULT 'info',
      embedding vector(384),
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_agent_memories_embedding
      ON agent_memories USING hnsw (embedding vector_cosine_ops);

    CREATE INDEX IF NOT EXISTS idx_agent_lessons_embedding
      ON agent_lessons USING hnsw (embedding vector_cosine_ops);

    CREATE TABLE IF NOT EXISTS agent_snapshots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      summary TEXT,
      payload JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_agent_snapshots_agent_created_at
    ON agent_snapshots (agent_id, created_at DESC);

-- Prime Agent Configuration and Sessions tables
CREATE TABLE IF NOT EXISTS prime_agent_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  enabled BOOLEAN NOT NULL DEFAULT false,
  cron_fast_interval_seconds INT NOT NULL DEFAULT 300,
  cron_slow_interval_seconds INT NOT NULL DEFAULT 3600,
  debounce_window_ms INT NOT NULL DEFAULT 10000,
  provider_routing JSONB NOT NULL DEFAULT '{}',
  cost_controls JSONB NOT NULL DEFAULT '{}',
  git_store JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'stopped',
  last_started_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prime_agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('event', 'cron_fast', 'cron_slow', 'prime_message')),
  trigger_payload JSONB NOT NULL,
  module_name TEXT,
  workspace_root TEXT,
  workspace_revision TEXT,
  prompt_templates JSONB NOT NULL DEFAULT '{}',
  reasoning_summary TEXT,
  actions_taken JSONB NOT NULL DEFAULT '[]',
  token_count INT NOT NULL DEFAULT 0,
  provider_used TEXT,
  model_used TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'escalated')),
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_prime_agent_sessions_started_at ON prime_agent_sessions (started_at DESC);

CREATE TABLE IF NOT EXISTS prime_queue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  actor_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  attempt INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prime_queue_items_status_created_at
ON prime_queue_items (status, created_at);

CREATE TABLE IF NOT EXISTS checkpoint_continuations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('prime_session', 'delegation')),
  owner_id UUID NOT NULL,
  actor_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  step TEXT NOT NULL,
  context_hash TEXT NOT NULL,
  context_snapshot JSONB NOT NULL,
  continuation JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_checkpoint_continuations_owner_id_status
ON checkpoint_continuations (owner_id, status);

ALTER TABLE prime_agent_sessions
  ADD COLUMN IF NOT EXISTS last_step TEXT;

ALTER TABLE prime_agent_sessions
  ADD COLUMN IF NOT EXISTS workspace_root TEXT;

ALTER TABLE prime_agent_sessions
  ADD COLUMN IF NOT EXISTS workspace_revision TEXT;

ALTER TABLE prime_agent_sessions
  ADD COLUMN IF NOT EXISTS prompt_templates JSONB NOT NULL DEFAULT '{}';

ALTER TABLE prime_agent_sessions DROP CONSTRAINT IF EXISTS prime_agent_sessions_trigger_type_check;

UPDATE prime_agent_sessions
SET trigger_type = 'prime_message'
WHERE trigger_type = 'chief_message';

ALTER TABLE prime_agent_sessions
  ADD CONSTRAINT prime_agent_sessions_trigger_type_check
  CHECK (trigger_type IN ('event', 'cron_fast', 'cron_slow', 'prime_message'));

    ALTER TABLE prime_agent_config
      ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS agent_workspace_config (
  id TEXT PRIMARY KEY DEFAULT 'default',
  mode TEXT NOT NULL DEFAULT 'local' CHECK (mode IN ('local', 'git')),
  root_path TEXT NOT NULL,
  remote_url TEXT,
  branch TEXT NOT NULL DEFAULT 'main',
  sync_status TEXT NOT NULL DEFAULT 'uninitialized',
  last_sync_at TIMESTAMPTZ,
  last_commit TEXT,
  dirty BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO agent_workspace_config (id, mode, root_path, branch, sync_status, dirty)
VALUES (
  'default',
  'local',
  COALESCE(NULLIF(current_setting('app.agent_workspace_root', true), ''), '/var/lib/agent-cp/workspace'),
  'main',
  'uninitialized',
  false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO prime_agent_config (id, enabled) VALUES ('default', false) ON CONFLICT (id) DO NOTHING;

  `)
}

export async function seedRegistry(pool: pg.Pool, env: NodeJS.ProcessEnv): Promise<void> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM agents')
  if (rows[0].count > 0) return  // already seeded

  const seeds: Array<{ name: string; type: string; config: object }> = []

  if (env['RACLETTE_API_URL']) {
    seeds.push({ name: 'raclette', type: 'hermes', config: { api_url: env['RACLETTE_API_URL'] } })
  }
  if (env['LANGGRAPH_API_URL']) {
    seeds.push({ name: 'langgraph', type: 'langgraph', config: { api_url: env['LANGGRAPH_API_URL'] } })
  }

  for (const seed of seeds) {
    await pool.query(
      `INSERT INTO agents (name, type, config) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`,
      [seed.name, seed.type, JSON.stringify(seed.config)]
    )
  }
}
