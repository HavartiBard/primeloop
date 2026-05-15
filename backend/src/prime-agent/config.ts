import type pg from 'pg'

export interface PrimeConfigRoute {
  provider_id: string
  model: string
}

export interface PrimeConfig {
  id: string
  enabled: boolean
  cron_fast_interval_seconds: number
  cron_slow_interval_seconds: number
  debounce_window_ms: number
  provider_routing: Record<string, PrimeConfigRoute[]>
  cost_controls: Record<string, unknown>
  git_store: Record<string, unknown>
  status: string
  last_started_at?: string
  last_error?: string
  created_at: string
  updated_at: string
}

export interface PrimeConfigPatch {
  enabled?: boolean
  cron_fast_interval_seconds?: number
  cron_slow_interval_seconds?: number
  debounce_window_ms?: number
  provider_routing?: Record<string, PrimeConfigRoute[]>
  cost_controls?: Record<string, unknown>
  git_store?: Record<string, unknown>
  status?: string
  last_started_at?: string | null
  last_error?: string | null
}

async function ensurePrimeConfigRow(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO prime_agent_config (id, enabled)
     VALUES ('default', false)
     ON CONFLICT (id) DO NOTHING`
  )
}

export async function getPrimeConfig(pool: pg.Pool): Promise<PrimeConfig> {
  await ensurePrimeConfigRow(pool)
  const { rows } = await pool.query(`SELECT * FROM prime_agent_config WHERE id = 'default'`)
  return rows[0]
}

export async function updatePrimeConfig(pool: pg.Pool, patch: PrimeConfigPatch): Promise<PrimeConfig> {
  await ensurePrimeConfigRow(pool)

  const values: unknown[] = ['default']
  const sets: string[] = []

  const fields: Array<[keyof PrimeConfigPatch, string, (value: unknown) => unknown]> = [
    ['enabled', 'enabled', (value) => value],
    ['cron_fast_interval_seconds', 'cron_fast_interval_seconds', (value) => value],
    ['cron_slow_interval_seconds', 'cron_slow_interval_seconds', (value) => value],
    ['debounce_window_ms', 'debounce_window_ms', (value) => value],
    ['provider_routing', 'provider_routing', (value) => JSON.stringify(value ?? {})],
    ['cost_controls', 'cost_controls', (value) => JSON.stringify(value ?? {})],
    ['git_store', 'git_store', (value) => JSON.stringify(value ?? {})],
    ['status', 'status', (value) => value],
    ['last_started_at', 'last_started_at', (value) => value ?? null],
    ['last_error', 'last_error', (value) => value ?? null],
  ]

  for (const [key, column, encode] of fields) {
    if (key in patch) {
      values.push(encode(patch[key]))
      sets.push(`${column} = $${values.length}`)
    }
  }

  if (sets.length === 0) {
    return getPrimeConfig(pool)
  }

  const { rows } = await pool.query(
    `UPDATE prime_agent_config
     SET ${sets.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    values
  )

  return rows[0]
}
