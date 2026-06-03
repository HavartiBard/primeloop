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
      tier           TEXT NOT NULL DEFAULT 'durable',
      role           TEXT NOT NULL DEFAULT 'general',
      state          TEXT NOT NULL DEFAULT 'ready',
      persona_file   TEXT NOT NULL DEFAULT 'AGENTS.md',
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

    CREATE TABLE IF NOT EXISTS capability_profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      platform_primitives JSONB NOT NULL DEFAULT '[]',
      capability_bundles JSONB NOT NULL DEFAULT '[]',
      deny_rules JSONB NOT NULL DEFAULT '[]',
      approval_rules JSONB NOT NULL DEFAULT '{}',
      config JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS workspace_root TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS system_prompt TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS soul TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS tier TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS role TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS state TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS persona_file TEXT;
    ALTER TABLE agent_runtime_configs
      ADD COLUMN IF NOT EXISTS capability_profile_id UUID REFERENCES capability_profiles(id) ON DELETE SET NULL;

    ALTER TABLE agent_runtime_configs
      ADD COLUMN IF NOT EXISTS tool_grant_defaults JSONB NOT NULL DEFAULT '{}';

    UPDATE agents SET tier = 'durable' WHERE tier IS NULL;
    UPDATE agents SET role = COALESCE(NULLIF(type, ''), 'general') WHERE role IS NULL;
    UPDATE agents SET state = 'ready' WHERE state IS NULL;
    UPDATE agents SET persona_file = 'AGENTS.md' WHERE persona_file IS NULL;

    ALTER TABLE agents ALTER COLUMN tier SET DEFAULT 'durable';
    ALTER TABLE agents ALTER COLUMN tier SET NOT NULL;
    ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_tier_check;
    ALTER TABLE agents ADD CONSTRAINT agents_tier_check CHECK (tier IN ('durable', 'ephemeral'));

    ALTER TABLE agents ALTER COLUMN role SET DEFAULT 'general';
    ALTER TABLE agents ALTER COLUMN role SET NOT NULL;

    ALTER TABLE agents ALTER COLUMN state SET DEFAULT 'ready';
    ALTER TABLE agents ALTER COLUMN state SET NOT NULL;
    ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_state_check;
    ALTER TABLE agents ADD CONSTRAINT agents_state_check CHECK (
      state IN ('provisioning', 'ready', 'busy', 'idle', 'retiring', 'terminated', 'error')
    );

    ALTER TABLE agents ALTER COLUMN persona_file SET DEFAULT 'AGENTS.md';
    ALTER TABLE agents ALTER COLUMN persona_file SET NOT NULL;

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

    CREATE TABLE IF NOT EXISTS capability_bundle_adapters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      capability_bundle TEXT NOT NULL,
      provider_adapter_kind TEXT NOT NULL,
      provider_adapter_ref TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      config JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tool_grants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      delegation_id UUID REFERENCES delegations(id) ON DELETE SET NULL,
      work_item_id UUID REFERENCES work_items(id) ON DELETE SET NULL,
      capability_profile_id UUID REFERENCES capability_profiles(id) ON DELETE SET NULL,
      routing_capability TEXT,
      granted_primitives JSONB NOT NULL DEFAULT '[]',
      granted_capability_bundles JSONB NOT NULL DEFAULT '[]',
      selected_provider_adapters JSONB NOT NULL DEFAULT '[]',
      exclusion_reasons JSONB NOT NULL DEFAULT '[]',
      task_scope JSONB NOT NULL DEFAULT '{}',
      approval_state JSONB NOT NULL DEFAULT '{}',
      environment_context JSONB NOT NULL DEFAULT '{}',
      revocation_state TEXT NOT NULL DEFAULT 'active',
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  config JSONB DEFAULT '{}',
  setup_complete BOOLEAN NOT NULL DEFAULT false,
  model_preferences JSONB NOT NULL DEFAULT '{}',
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

CREATE TABLE IF NOT EXISTS prime_agent_modules (
  module_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN ('trigger', 'debounce', 'context', 'decision', 'policy', 'action', 'feedback', 'learning', 'observer')),
  default_version TEXT NOT NULL,
  pinned_version TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  rollout_mode TEXT NOT NULL DEFAULT 'active' CHECK (rollout_mode IN ('active', 'shadow')),
  config JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prime_agent_module_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id TEXT NOT NULL REFERENCES prime_agent_modules(module_id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  changed_fields JSONB NOT NULL DEFAULT '[]',
  previous_config JSONB NOT NULL,
  next_config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prime_agent_module_audits_module_created_at
ON prime_agent_module_audits (module_id, created_at DESC);

CREATE TABLE IF NOT EXISTS prime_agent_module_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES prime_agent_sessions(id) ON DELETE CASCADE,
  run_index INT NOT NULL,
  module_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('trigger', 'debounce', 'context', 'decision', 'policy', 'action', 'feedback', 'learning', 'observer')),
  version TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'active' CHECK (mode IN ('active', 'shadow')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  detail TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prime_agent_module_runs_session_index
ON prime_agent_module_runs (session_id, run_index);

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

ALTER TABLE prime_agent_module_runs
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'active';

ALTER TABLE prime_agent_modules
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

ALTER TABLE prime_agent_config
  ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}';

    ALTER TABLE prime_agent_config
      ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE prime_agent_config
  ADD COLUMN IF NOT EXISTS model_preferences JSONB NOT NULL DEFAULT '{}';

-- =============================================================
-- Onboarding session and team plan tables — Spec 018
-- Idempotent: safe to re-run. Uses CREATE TABLE IF NOT EXISTS.
-- =============================================================

CREATE TABLE IF NOT EXISTS onboarding_session (
  id TEXT PRIMARY KEY DEFAULT 'default',
  current_step TEXT NOT NULL DEFAULT 'providers' CHECK (current_step IN ('intro', 'providers', 'function_assignment', 'prime_config', 'plugins', 'workspace', 'launch', 'prime_conversation', 'complete')),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'blocked', 'ready_to_launch', 'launching', 'launched', 'complete')),
  providers JSONB NOT NULL DEFAULT '[]',
  function_assignments JSONB NOT NULL DEFAULT '[]',
  prime_config_draft JSONB NOT NULL DEFAULT '{}',
  plugin_choices JSONB NOT NULL DEFAULT '[]',
  team_plan JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES onboarding_session(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  agents JSONB NOT NULL DEFAULT '[]',
  recommended BOOLEAN NOT NULL DEFAULT false,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_plans_session_confirmed ON team_plans (session_id, confirmed);

ALTER TABLE team_plans
  ADD COLUMN IF NOT EXISTS confirmation_status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (confirmation_status IN ('proposed', 'confirmed', 'rejected', 'partially_confirmed'));

ALTER TABLE team_plans
  ADD COLUMN IF NOT EXISTS created_agent_ids JSONB NOT NULL DEFAULT '[]';

ALTER TABLE team_plans
  ADD COLUMN IF NOT EXISTS failed_agents JSONB NOT NULL DEFAULT '[]';

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

-- =============================================================
-- ACP (Agentic Control Plane) tables — Spec 016
-- Idempotent: safe to re-run. Uses CREATE TABLE IF NOT EXISTS.
-- =============================================================

-- =============================================================
-- ACP tables — migrate legacy tables to match ACP schema
-- Legacy work_items and approvals tables already exist above (UUID PK / approval_id TEXT PK).
-- We convert them idempotently BEFORE creating ACP tables that FK into them.
-- =============================================================

-- goals: brand new ACP table (no conflict with legacy)
CREATE TABLE IF NOT EXISTS goals (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  intent             TEXT NOT NULL,
  domain_summary     TEXT,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'in_progress', 'awaiting_approval', 'blocked', 'completed', 'failed', 'cancelled')),
  priority           TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  requested_by       TEXT,
  owned_by_agent_role TEXT NOT NULL DEFAULT 'prime',
  current_summary    TEXT,
  result_summary     TEXT,
  risk_summary       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ
);

-- agent_roles: brand new ACP table (no conflict with legacy)
CREATE TABLE IF NOT EXISTS agent_roles (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  tier               TEXT NOT NULL CHECK (tier IN ('prime', 'durable', 'ephemeral')),
  domain_capabilities TEXT[],
  status             TEXT NOT NULL DEFAULT 'active',
  description        TEXT,
  can_request_approval BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Migrate legacy work_items (UUID PK) to TEXT PK
-- Must happen BEFORE recovery_events / learning_records creation.
-- Postgres blocks type changes on PK columns with FK dependents,
-- so we must: drop ALL FKs → convert types → re-add FKs.
-- Uses dynamic SQL to handle any referencing table.
-- ---------------------------------------------------------------

DO $$
DECLARE
  rec record;
BEGIN
  -- 1. Drop every FK constraint that references work_items(id)
  FOR rec IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = 'work_items'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', rec.tbl, rec.conname);
  END LOOP;

  -- 2. Convert work_items.id from UUID → TEXT
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='work_items' AND column_name='id' AND data_type='uuid') THEN
    ALTER TABLE work_items ALTER COLUMN id TYPE TEXT USING id::text;
  END IF;

  -- 3. Convert every referencing column from UUID → TEXT
  FOR rec IN
    SELECT conrelid::regclass AS tbl, a.attname AS col
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND c.confrelid = 'work_items'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE TEXT USING %I::text', rec.tbl, rec.col, rec.col);
  END LOOP;
END
$$;

-- Add missing ACP columns to work_items
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS goal_id TEXT REFERENCES goals(id);
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS parent_work_item_id TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS assigned_agent_role TEXT NOT NULL DEFAULT 'prime';
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS domain TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS scope TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS depends_on TEXT[];
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS decision_summary TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS outcome_summary TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Self-referencing FK for parent_work_item_id (idempotent)
DO $$
BEGIN
  ALTER TABLE work_items DROP CONSTRAINT IF EXISTS work_items_parent_work_item_id_fkey;
  ALTER TABLE work_items ADD CONSTRAINT work_items_parent_work_item_id_fkey
    FOREIGN KEY (parent_work_item_id) REFERENCES work_items(id);
EXCEPTION WHEN undefined_object THEN NULL;
END
$$;

-- ---------------------------------------------------------------
-- Migrate legacy approvals (approval_id TEXT PK) to id TEXT PK
-- Legacy table has: approval_id, run_id, action, status, created_at, decided_at
-- ACP table needs: id, goal_id, work_item_id, requested_by_agent_role,
--   action_summary, risk_summary, status, decision_notes, expires_at,
--   resolved_at, created_at
-- Wrapped in DO block for idempotency.
-- ---------------------------------------------------------------

DO $$
BEGIN
  -- Only run if legacy column 'approval_id' still exists (not yet migrated)
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='approvals' AND column_name='approval_id') THEN

    -- Convert tool_invocations.approval_id from UUID → TEXT (if needed)
    IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name='tool_invocations' AND column_name='approval_id' AND data_type='uuid') THEN
      ALTER TABLE tool_invocations ALTER COLUMN approval_id TYPE TEXT USING approval_id::text;
    END IF;

    -- Add id_text column and populate from approval_id
    ALTER TABLE approvals ADD COLUMN id_text TEXT;
    UPDATE approvals SET id_text = approval_id WHERE id_text IS NULL;
    ALTER TABLE approvals ALTER COLUMN id_text SET NOT NULL;

    -- Drop old FK/pk constraints
    ALTER TABLE tool_invocations DROP CONSTRAINT IF EXISTS tool_invocations_approval_id_fkey;
    ALTER TABLE approvals DROP CONSTRAINT approvals_pkey;

    -- Swap PK: approval_id → id
    ALTER TABLE approvals DROP COLUMN approval_id;
    ALTER TABLE approvals RENAME COLUMN id_text TO id;
    ALTER TABLE approvals ADD CONSTRAINT approvals_pkey PRIMARY KEY (id);

    -- Re-add FK: tool_invocations.approval_id → approvals(id)
    ALTER TABLE tool_invocations ADD CONSTRAINT tool_invocations_approval_id_fkey
      FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- Add missing ACP columns to approvals (always safe with IF NOT EXISTS)
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS goal_id TEXT REFERENCES goals(id);
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS work_item_id TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS requested_by_agent_role TEXT NOT NULL DEFAULT 'prime';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS action_summary TEXT NOT NULL DEFAULT '';
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS risk_summary TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS decision_notes TEXT;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE approvals ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- Add FK: approvals.work_item_id → work_items(id) (idempotent)
DO $$
BEGIN
  ALTER TABLE approvals ADD CONSTRAINT approvals_work_item_id_fkey
    FOREIGN KEY (work_item_id) REFERENCES work_items(id);
EXCEPTION WHEN undefined_column THEN NULL;
END
$$;

-- ---------------------------------------------------------------
-- ACP tables that FK into work_items / goals (now all TEXT)
-- ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recovery_events (
  id                  TEXT PRIMARY KEY,
  goal_id             TEXT NOT NULL REFERENCES goals(id),
  work_item_id        TEXT REFERENCES work_items(id),
  detected_condition  TEXT NOT NULL,
  detected_at         TIMESTAMPTZ NOT NULL,
  severity            TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  selected_action     TEXT NOT NULL CHECK (selected_action IN ('retry', 'reroute', 'escalate', 'request_approval', 'stop')),
  action_reason       TEXT,
  result_status       TEXT NOT NULL CHECK (result_status IN ('succeeded', 'ongoing', 'failed', 'escalated')),
  result_summary      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_records (
  id                TEXT PRIMARY KEY,
  goal_id           TEXT NOT NULL REFERENCES goals(id),
  work_item_id      TEXT REFERENCES work_items(id),
  category          TEXT NOT NULL CHECK (category IN ('planning', 'delegation', 'recovery', 'approval', 'ux', 'domain_specific')),
  signal_type       TEXT NOT NULL CHECK (signal_type IN ('success', 'failure', 'inefficiency', 'operator_correction', 'missed_risk')),
  observation       TEXT NOT NULL,
  recommendation    TEXT,
  confidence        TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  applies_to_domains TEXT[],
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- canvas_layouts: persists operator card positions on the circuit canvas
CREATE TABLE IF NOT EXISTS canvas_layouts (
  canvas_key  TEXT        NOT NULL DEFAULT 'default',
  card_id     TEXT        NOT NULL,
  x           FLOAT       NOT NULL DEFAULT 0,
  y           FLOAT       NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (canvas_key, card_id)
);

-- Welcome room: always-present onboarding room shown on canvas before any goals exist
INSERT INTO threads (title, status, metadata)
SELECT 'Welcome', 'active', '{"kind":"welcome"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM threads WHERE metadata->>'kind' = 'welcome');

-- Seed initial agent roles (idempotent)
INSERT INTO agent_roles (id, name, tier, domain_capabilities, status, description, can_request_approval)
VALUES ('role_prime', 'Prime', 'prime', ARRAY['homelab','development','personal_assistant','cross_domain'], 'active',
  'Singleton orchestrator — user-facing goal intake, decomposition, approvals, narration', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO agent_roles (id, name, tier, domain_capabilities, status, description, can_request_approval)
VALUES ('role_sre_devops', 'SRE/DevOps', 'durable', ARRAY['homelab','cross_domain'], 'active',
  'Combined maintenance role — runtime health, incidents, deploys, queue recovery, environment integrity', false)
ON CONFLICT (name) DO NOTHING;

INSERT INTO agent_roles (id, name, tier, domain_capabilities, status, description, can_request_approval)
VALUES ('role_architect', 'Architect', 'durable', ARRAY['development','cross_domain'], 'active',
  'Durable quality role — grading review, playbooks, template updates, cross-cutting consistency', false)
ON CONFLICT (name) DO NOTHING;

  `)
}

export async function seedRegistry(pool: pg.Pool, env: NodeJS.ProcessEnv): Promise<void> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM agents')
  if (rows[0].count > 0) return  // already seeded

  const seeds: Array<{ 
    name: string; 
    type: string; 
    runtime_family: string; 
    execution_mode: string; 
    workspace_root?: string;
    config: object 
  }> = []

  if (env['RACLETTE_API_URL']) {
    seeds.push({ name: 'raclette', type: 'hermes', runtime_family: 'custom', execution_mode: 'external', config: { api_url: env['RACLETTE_API_URL'] } })
  }
  if (env['LANGGRAPH_API_URL']) {
    seeds.push({ name: 'langgraph', type: 'langgraph', runtime_family: 'custom', execution_mode: 'external', config: { api_url: env['LANGGRAPH_API_URL'] } })
  }


  for (const seed of seeds) {
    await pool.query(
      `INSERT INTO agents (name, type, runtime_family, execution_mode, workspace_root, config) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       ON CONFLICT (name) DO NOTHING`,
      [seed.name, seed.type, seed.runtime_family, seed.execution_mode, seed.workspace_root, JSON.stringify(seed.config)]
    )
  }
}
