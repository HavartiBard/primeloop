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
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agents (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name           TEXT NOT NULL UNIQUE,
      type           TEXT NOT NULL CHECK (type IN ('hermes','langgraph','codex-thread','generic')),
      provider_id    UUID REFERENCES providers(id) ON DELETE SET NULL,
      host           TEXT,
      container_name TEXT,
      ssh_user       TEXT,
      config         JSONB DEFAULT '{}',
      enabled        BOOLEAN DEFAULT true,
      created_at     TIMESTAMPTZ DEFAULT now()
    );
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
