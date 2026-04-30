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
  `)
}
