import type pg from 'pg'

// ─── Model Preferences Schema ────────────────────────────────────────────────

/** A single model route entry referencing a provider and model name. */
export interface ModelRouteEntry {
  provider_id: string
  model: string
}

/** Per-function model preference with primary + ordered fallback chain. */
export interface FunctionModelPreference {
  primary: ModelRouteEntry
  fallbacks: ModelRouteEntry[]
}

/** Map of function type → model preference (e.g. planning, routing). */
export type ModelPreferences = Record<string, FunctionModelPreference>

/** Canonical function types that Prime uses for model selection. */
export const PRIME_MODEL_FUNCTION_TYPES = [
  'planning',
  'routing',
  'context',
  'policy',
] as const
export type PrimeModelFunctionType = typeof PRIME_MODEL_FUNCTION_TYPES[number]

// ─── Legacy Types (preserved for backward compatibility) ──────────────────────

/** @deprecated Use ModelRouteEntry instead. */
export interface PrimeConfigRoute {
  provider_id: string
  model: string
}

// ─── Main Config Types ───────────────────────────────────────────────────────

export interface PrimeConfig {
  id: string
  enabled: boolean
  cron_fast_interval_seconds: number
  cron_slow_interval_seconds: number
  debounce_window_ms: number
  /** @deprecated Use model_preferences instead. */
  provider_routing: Record<string, PrimeConfigRoute[]>
  cost_controls: Record<string, unknown>
  git_store: Record<string, unknown>
  model_preferences: ModelPreferences
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
  /** @deprecated Use model_preferences instead. */
  provider_routing?: Record<string, PrimeConfigRoute[]>
  cost_controls?: Record<string, unknown>
  git_store?: Record<string, unknown>
  model_preferences?: ModelPreferences
  status?: string
  last_started_at?: string | null
  last_error?: string | null
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

async function ensurePrimeConfigRow(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO prime_agent_config (id, enabled)
     VALUES ('default', false)
     ON CONFLICT (id) DO NOTHING`
  )
}

/**
 * Migrate legacy provider_routing data to model_preferences format.
 * Only runs when model_preferences is empty but provider_routing has data.
 */
async function migrateProviderRoutingToModelPreferences(
  pool: pg.Pool,
  config: PrimeConfig,
): Promise<PrimeConfig | null> {
  if (Object.keys(config.model_preferences ?? {}).length > 0) {
    return null // already migrated
  }
  const routing = config.provider_routing ?? {}
  const entries = Object.entries(routing)
  if (entries.length === 0) {
    return null
  }

  const preferences: ModelPreferences = {}
  for (const [funcType, routes] of entries) {
    if (!Array.isArray(routes) || routes.length === 0) continue
    preferences[funcType] = {
      primary: routes[0],
      fallbacks: routes.slice(1),
    }
  }

  if (Object.keys(preferences).length === 0) return null

  await pool.query(
    `UPDATE prime_agent_config SET model_preferences = $1, updated_at = now() WHERE id = 'default'`,
    [JSON.stringify(preferences)],
  )

  // Return updated config
  const { rows } = await pool.query<PrimeConfig>(`SELECT * FROM prime_agent_config WHERE id = 'default'`)
  return rows[0] ?? null
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getPrimeConfig(pool: pg.Pool): Promise<PrimeConfig> {
  await ensurePrimeConfigRow(pool)
  const { rows } = await pool.query<PrimeConfig>(`SELECT * FROM prime_agent_config WHERE id = 'default'`)
  const config = rows[0]

  // Auto-migrate legacy provider_routing → model_preferences on first read
  const migrated = await migrateProviderRoutingToModelPreferences(pool, config)
  return migrated ?? config
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
    ['model_preferences', 'model_preferences', (value) => JSON.stringify(value ?? {})],
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

  const { rows } = await pool.query<PrimeConfig>(
    `UPDATE prime_agent_config
     SET ${sets.join(', ')}, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    values,
  )

  return rows[0]
}

// ─── Utility: convert model_preferences to ordered route array (for LLM router) ──────────────────

/**
 * Build an ordered list of PrimeConfigRoute entries for a given function type.
 * Order: [primary, ...fallbacks]. Falls back to legacy provider_routing if preferences are empty.
 */
export function resolveModelRoutes(
  config: PrimeConfig,
  funcType: string,
): PrimeConfigRoute[] {
  // Try model_preferences first
  const prefs = config.model_preferences?.[funcType]
  if (prefs && prefs.primary) {
    return [prefs.primary, ...(prefs.fallbacks ?? [])]
  }

  // Fall back to legacy provider_routing
  const legacyRoutes = config.provider_routing?.[funcType]
  if (Array.isArray(legacyRoutes) && legacyRoutes.length > 0) {
    return legacyRoutes
  }

  // Try the generic 'routing' key as a last resort for planning
  if (funcType === 'planning') {
    const fallback = config.provider_routing?.['routing']
    if (Array.isArray(fallback) && fallback.length > 0) {
      return fallback
    }
  }

  return []
}