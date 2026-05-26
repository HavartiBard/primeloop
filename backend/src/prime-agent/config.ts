import type pg from 'pg'
import { assessModelCapability } from './model-capability.js'

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

/** A single Prime function assignment from onboarding. */
export interface PrimeFunctionAssignment {
  function_key: PrimeOnboardingFunctionKey | string
  display_name: string
  purpose: string
  required: boolean
  provider_id?: string | null
  model?: string | null
  is_default_choice?: boolean
  validation_status?: 'missing' | 'valid' | 'warning' | 'blocked'
  warnings?: string[]
}

/** Validation result for a function assignment. */
export interface PrimeFunctionAssignmentValidation {
  function_key: string
  provider_id?: string | null
  model?: string | null
  validation_status: 'missing' | 'valid' | 'warning' | 'blocked'
  warnings: string[]
  is_default_choice: boolean
}

/** Full launch readiness validation result. */
export interface LaunchReadinessResult {
  ready: boolean
  overall_status: 'ready' | 'warning' | 'blocked'
  required_missing: number
  warnings: number
  blocked: number
  blocking_reasons: string[]
  warning_messages: string[]
  assignments: PrimeFunctionAssignmentValidation[]
  summary: {
    required_functions: number
    assigned_required_functions: number
  }
}

/** Canonical function types that Prime uses for model selection. */
export const PRIME_MODEL_FUNCTION_TYPES = [
  'planning',
  'routing',
  'context',
  'policy',
] as const
export type PrimeModelFunctionType = typeof PRIME_MODEL_FUNCTION_TYPES[number]

/** Onboarding function keys for Prime Agent setup. */
export const PRIME_ONBOARDING_FUNCTION_KEYS = [
  'orchestration',
  'planning',
  'coding_execution',
  'review_validation',
  'platform_maintenance',
] as const
export type PrimeOnboardingFunctionKey = typeof PRIME_ONBOARDING_FUNCTION_KEYS[number]

/** Mapping from onboarding function keys to Prime runtime function types. */
export const ONBOARDING_TO_PRIME_FUNCTION_MAP: Record<PrimeOnboardingFunctionKey, PrimeModelFunctionType> = {
  orchestration: 'routing',
  planning: 'planning',
  coding_execution: 'context',
  review_validation: 'policy',
  platform_maintenance: 'policy',
}

/** Default onboarding function assignments for Prime Agent. */
export const DEFAULT_ONBOARDING_ASSIGNMENTS: Omit<PrimeFunctionAssignment, 'validation_status' | 'warnings' | 'is_default_choice'>[] = [
  {
    function_key: 'orchestration',
    display_name: 'Orchestration',
    purpose: 'Coordinate other agents and manage workflow',
    required: true,
  },
  {
    function_key: 'planning',
    display_name: 'Planning',
    purpose: 'Break down tasks and create execution plans',
    required: true,
  },
  {
    function_key: 'coding_execution',
    display_name: 'Coding & Execution',
    purpose: 'Write and execute code',
    required: true,
  },
  {
    function_key: 'review_validation',
    display_name: 'Review & Validation',
    purpose: 'Review code and validate results',
    required: true,
  },
  {
    function_key: 'platform_maintenance',
    display_name: 'Platform Maintenance',
    purpose: 'Maintain platform health and infrastructure',
    required: true,
  },
] as const

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

/** Default values for Prime Agent configuration. */
export const DEFAULT_PRIME_CONFIG: Required<
  Pick<
    PrimeConfig,
    | 'cron_fast_interval_seconds'
    | 'cron_slow_interval_seconds'
    | 'debounce_window_ms'
    | 'cost_controls'
  >
> = {
  cron_fast_interval_seconds: 300,
  cron_slow_interval_seconds: 3600,
  debounce_window_ms: 10000,
  cost_controls: {},
} as const

/**
 * Merge user-reviewed Prime config values with existing defaults.
 * Prefers user-provided values over defaults, but falls back to defaults for missing fields.
 */
export function mergePrimeConfigWithDefaults(
  userConfig: Partial<
    Pick<
      PrimeConfig,
      | 'cron_fast_interval_seconds'
      | 'cron_slow_interval_seconds'
      | 'debounce_window_ms'
      | 'cost_controls'
    >
  >,
): Required<
  Pick<
    PrimeConfig,
    | 'cron_fast_interval_seconds'
    | 'cron_slow_interval_seconds'
    | 'debounce_window_ms'
    | 'cost_controls'
  >
> {
  return {
    cron_fast_interval_seconds:
      userConfig.cron_fast_interval_seconds ?? DEFAULT_PRIME_CONFIG.cron_fast_interval_seconds,
    cron_slow_interval_seconds:
      userConfig.cron_slow_interval_seconds ?? DEFAULT_PRIME_CONFIG.cron_slow_interval_seconds,
    debounce_window_ms:
      userConfig.debounce_window_ms ?? DEFAULT_PRIME_CONFIG.debounce_window_ms,
    cost_controls: userConfig.cost_controls ?? DEFAULT_PRIME_CONFIG.cost_controls,
  }
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

// ─── Onboarding: Default assignment factory ────────────────────────────────────────────────

/** Create a default Prime function assignment with validation status. */
export function createDefaultAssignment(
  functionKey: PrimeOnboardingFunctionKey,
): PrimeFunctionAssignment {
  const assignment = DEFAULT_ONBOARDING_ASSIGNMENTS.find(a => a.function_key === functionKey)
  if (!assignment) {
    throw new Error(`Unknown onboarding function key: ${functionKey}`)
  }
  return {
    ...assignment,
    validation_status: 'missing' as const,
    warnings: [],
    is_default_choice: true,
  }
}

// ─── Onboarding: Validation helpers ────────────────────────────────────────────────────────

/** Get the Prime runtime function type for an onboarding function key. */
export function mapOnboardingToPrimeFunction(
  functionKey: PrimeOnboardingFunctionKey | string,
): PrimeModelFunctionType {
  if (functionKey in ONBOARDING_TO_PRIME_FUNCTION_MAP) {
    return ONBOARDING_TO_PRIME_FUNCTION_MAP[functionKey as PrimeOnboardingFunctionKey]
  }
  // Fallback to 'routing' for unknown keys
  return 'routing'
}

/** Validate a single function assignment. */
export function validateFunctionAssignment(
  assignment: PrimeFunctionAssignment,
): PrimeFunctionAssignmentValidation {
  const warnings: string[] = []
  let validation_status: PrimeFunctionAssignmentValidation['validation_status'] = 'valid'
  const hasProvider = Boolean(assignment.provider_id)
  const hasModel = Boolean(assignment.model?.trim())

  if (!hasProvider || !hasModel) {
    validation_status = assignment.required ? 'blocked' : 'missing'
    if (!hasProvider) warnings.push('No provider selected')
    if (!hasModel) warnings.push('No model selected')
  } else if (assignment.model) {
    const capability = assessModelCapability(assignment.model)
    if (capability.isBlocked) {
      validation_status = 'blocked'
      warnings.push(capability.warning)
    } else if (capability.tier === 'warned') {
      validation_status = 'warning'
      warnings.push(capability.warning)
    }
  }

  return {
    function_key: assignment.function_key,
    provider_id: assignment.provider_id ?? null,
    model: assignment.model ?? null,
    validation_status,
    warnings,
    is_default_choice: assignment.is_default_choice ?? true,
  }
}

/** Validate all assignments and compute launch readiness. */
export function validateFunctionAssignments(
  assignments: PrimeFunctionAssignment[],
): LaunchReadinessResult {
  const results = assignments.map((assignment) => validateFunctionAssignment(assignment))
  const assignmentByKey = new Map(assignments.map((assignment) => [assignment.function_key, assignment]))
  const reuseCounts = new Map<string, number>()

  for (const assignment of assignments) {
    if (!assignment.provider_id || !assignment.model) continue
    const reuseKey = `${assignment.provider_id}::${assignment.model}`
    reuseCounts.set(reuseKey, (reuseCounts.get(reuseKey) ?? 0) + 1)
  }

  for (const validation of results) {
    if (!validation.provider_id || !validation.model) continue
    const reuseKey = `${validation.provider_id}::${validation.model}`
    const reuseCount = reuseCounts.get(reuseKey) ?? 0
    if (reuseCount > 1) {
      validation.warnings.push('Reuses the same provider/model as another Prime function')
      if (validation.validation_status === 'valid') validation.validation_status = 'warning'
    }
  }

  const requiredAssignments = assignments.filter((assignment) => assignment.required)
  const required_missing = results.filter((validation) => {
    const assignment = assignmentByKey.get(validation.function_key)
    return assignment?.required && (!validation.provider_id || !validation.model)
  }).length
  const blocked_count = results.filter((validation) => validation.validation_status === 'blocked').length
  const warnings_count = results.filter((validation) => validation.validation_status === 'warning').length
  const overall_status: LaunchReadinessResult['overall_status'] =
    blocked_count > 0 || required_missing > 0 ? 'blocked'
      : warnings_count > 0 ? 'warning'
      : 'ready'
  const blocking_reasons = results.flatMap((validation) => {
    const assignment = assignmentByKey.get(validation.function_key)
    if (validation.validation_status !== 'blocked' && !(assignment?.required && (!validation.provider_id || !validation.model))) {
      return []
    }
    return validation.warnings.map((warning) => `${assignment?.display_name ?? validation.function_key}: ${warning}`)
  })
  const warning_messages = results.flatMap((validation) =>
    validation.validation_status === 'warning'
      ? validation.warnings.map((warning) => `${assignmentByKey.get(validation.function_key)?.display_name ?? validation.function_key}: ${warning}`)
      : [],
  )

  return {
    ready: overall_status === 'ready' || overall_status === 'warning',
    overall_status,
    required_missing,
    warnings: warnings_count,
    blocked: blocked_count,
    blocking_reasons,
    warning_messages,
    assignments: results,
    summary: {
      required_functions: requiredAssignments.length,
      assigned_required_functions: requiredAssignments.length - required_missing,
    },
  }
}

// ─── Onboarding: Conversion helpers ────────────────────────────────────────────────────────

/** Convert onboarding function assignments to Prime model_preferences format. */
export function convertAssignmentsToModelPreferences(
  assignments: PrimeFunctionAssignment[],
): ModelPreferences {
  const preferences: ModelPreferences = {}

  for (const assignment of assignments) {
    if (!assignment.provider_id || !assignment.model) {
      continue // Skip incomplete assignments
    }

    const primeFuncType = mapOnboardingToPrimeFunction(assignment.function_key)

    if (!preferences[primeFuncType]) {
      preferences[primeFuncType] = {
        primary: {
          provider_id: assignment.provider_id,
          model: assignment.model,
        },
        fallbacks: [],
      }
    } else {
      // Add as fallback if primary already exists
      preferences[primeFuncType].fallbacks.push({
        provider_id: assignment.provider_id,
        model: assignment.model,
      })
    }
  }

  return preferences
}