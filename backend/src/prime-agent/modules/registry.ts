import { hashContextSnapshot } from '../../checkpoint-store.js'
import type pg from 'pg'
import { dispatchPrimeActions } from '../actions.js'
import { assemblePrimeContext, buildContextSnapshot } from '../context.js'
import type { PrimeAction } from '../llm-router.js'
import { validatePrimeDecision } from '../llm-router.js'
import type {
  PrimeConfiguredModule,
  PrimeModule,
  PrimeModuleConfigAudit,
  PrimeModuleConfig,
  PrimeModuleConfigPatch,
  PrimeModuleDeps,
  PrimeLoopState,
} from './types.js'

const TRIGGER_MODULE: PrimeModule = {
  id: 'trigger.event-ingress',
  stage: 'trigger',
  version: '1.0.0',
  order: 10,
  async run(state: PrimeLoopState) {
    return { detail: `accepted ${state.event.type}` }
  },
}

const DEBOUNCE_MODULE: PrimeModule = {
  id: 'debounce.pass-through',
  stage: 'debounce',
  version: '1.0.0',
  order: 20,
  async run(_state: PrimeLoopState, deps: PrimeModuleDeps) {
    const debounceWindow = deps.moduleConfig['debounce_window_ms']
    if (typeof debounceWindow === 'number') {
      return { detail: `configured debounce window ${debounceWindow}ms` }
    }
    return { detail: 'no debounce policy configured' }
  },
}

const CONTEXT_MODULE: PrimeModule = {
  id: 'context.fleet-state',
  stage: 'context',
  version: '1.0.0',
  requires_active: true,
  order: 100,
  async run(state: PrimeLoopState, deps: PrimeModuleDeps) {
    state.context = await assemblePrimeContext(deps.pool, state.event)
    return { detail: `assembled ${state.context.fleet.agents.length} agents` }
  },
}

const DECISION_MODULE: PrimeModule = {
  id: 'decision.llm-router',
  stage: 'decision',
  version: '1.0.0',
  requires_active: true,
  order: 200,
  async run(state: PrimeLoopState, deps: PrimeModuleDeps) {
    if (!state.context) {
      throw new Error('Prime decision module requires context')
    }
    state.decision = validatePrimeDecision(await deps.router.decide(state.context))
    state.budget.llmCalls += 1
    return { detail: `${state.decision.actions.length} actions proposed` }
  },
}

const POLICY_SCOPE_REQUIRED_MODULE: PrimeModule = {
  id: 'policy.scope-required',
  stage: 'policy',
  version: '1.0.0',
  order: 250,
  async run(state: PrimeLoopState, deps: PrimeModuleDeps) {
    if (!state.decision) {
      throw new Error('Prime policy module requires a decision')
    }

    const requiredCapabilities = Array.isArray(deps.moduleConfig['required_capabilities'])
      ? deps.moduleConfig['required_capabilities']
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      : ['implementation', 'code-exploration']
    const violations = state.decision.actions
      .filter((action) => action.type === 'delegate')
      .filter((action) => requiresAllowedFiles(action, requiredCapabilities))
      .filter((action) => !hasAllowedFiles(action))

    if (violations.length > 0) {
      const capabilities = violations
        .map((action) => String(action.payload['capability'] ?? 'general'))
        .join(', ')
      throw new Error(`Prime policy scope-required blocked delegate actions without allowed_files: ${capabilities}`)
    }

    return { detail: 'all scoped delegate actions passed policy checks' }
  },
}

const ACTION_MODULE: PrimeModule = {
  id: 'action.dispatch',
  stage: 'action',
  version: '1.0.0',
  requires_active: true,
  order: 300,
  async run(state: PrimeLoopState, deps: PrimeModuleDeps) {
    if (!state.context || !state.decision) {
      throw new Error('Prime action module requires context and decision')
    }
    if (deps.executionMode === 'shadow') {
      return { detail: `${state.decision.actions.length} actions observed in shadow mode` }
    }
    state.actions = await dispatchPrimeActions(deps.pool, state.context, state.decision)
    state.budget.actionsDispatched = state.actions.length
    return { detail: `${state.actions.length} actions dispatched` }
  },
}

const FEEDBACK_APPROVAL_CONTINUATION_MODULE: PrimeModule = {
  id: 'feedback.approval-continuation',
  stage: 'feedback',
  version: '1.0.0',
  order: 400,
  async run(state: PrimeLoopState, deps: PrimeModuleDeps) {
    if (!state.context || !state.decision) {
      throw new Error('Prime feedback module requires context and decision')
    }
    if (deps.executionMode === 'shadow') {
      return { detail: 'shadow run skipped feedback side effects' }
    }

    let savedCount = 0
    for (const result of state.actions) {
      if (result.approval && !result.approval.status.includes('approved')) {
        await saveApprovalContinuation(deps, state)
        savedCount += 1
      }
    }

    return { detail: savedCount > 0 ? `saved ${savedCount} approval continuations` : 'no approval continuations required' }
  },
}

const STATIC_PRIME_MODULES: PrimeModule[] = [
  TRIGGER_MODULE,
  DEBOUNCE_MODULE,
  CONTEXT_MODULE,
  DECISION_MODULE,
  POLICY_SCOPE_REQUIRED_MODULE,
  ACTION_MODULE,
  FEEDBACK_APPROVAL_CONTINUATION_MODULE,
]

export function listPrimeModules(): PrimeModule[] {
  return [...STATIC_PRIME_MODULES].sort(comparePrimeModules)
}

export async function listConfiguredPrimeModules(pool: pg.Pool): Promise<PrimeConfiguredModule[]> {
  const modules = listPrimeModules()
  const configs = await listPrimeModuleConfigs(pool)
  const configById = new Map(configs.map((config) => [config.module_id, config]))

  return modules
    .flatMap((module) => {
      const config = configById.get(module.id)
      if (!config) return [{ module, rollout_mode: 'active' as const, config: {} }]
      validatePrimeModuleConfig(module, config)
      if (config.pinned_version && !getPrimeModuleAvailableVersions(module).includes(config.pinned_version)) {
        throw new Error(
          `Prime module version mismatch for ${module.id}: pinned ${config.pinned_version}, loaded ${module.version}`
        )
      }
      if (!config.enabled) return []
      return [{ module, rollout_mode: config.rollout_mode, config: config.config ?? {} }]
    })
}

export async function listPrimeModuleConfigs(pool: pg.Pool): Promise<PrimeModuleConfig[]> {
  await ensurePrimeModuleConfigRows(pool)
  const { rows } = await pool.query<PrimeModuleConfig>(
    `SELECT
       module_id,
       stage,
       default_version,
       pinned_version,
       enabled,
       rollout_mode,
       config,
       created_at::text,
       updated_at::text
     FROM prime_agent_modules
     ORDER BY stage, module_id`
  )

  return rows.map((row) => ({
    ...row,
    pinned_version: row.pinned_version ?? undefined,
    config: row.config ?? {},
  }))
}

export async function getPrimeModuleConfig(pool: pg.Pool, moduleId: string): Promise<PrimeModuleConfig | null> {
  await ensurePrimeModuleConfigRows(pool)
  const { rows } = await pool.query<PrimeModuleConfig>(
    `SELECT
       module_id,
       stage,
       default_version,
       pinned_version,
       enabled,
       rollout_mode,
       config,
       created_at::text,
       updated_at::text
     FROM prime_agent_modules
     WHERE module_id = $1`,
    [moduleId]
  )

  const config = rows[0]
  if (!config) return null
  return {
    ...config,
    pinned_version: config.pinned_version ?? undefined,
    config: config.config ?? {},
  }
}

export async function updatePrimeModuleConfig(
  pool: pg.Pool,
  moduleId: string,
  patch: PrimeModuleConfigPatch,
  actor = 'system'
): Promise<PrimeModuleConfig | null> {
  await ensurePrimeModuleConfigRows(pool)
  const existing = await getPrimeModuleConfig(pool, moduleId)
  if (!existing) return null
  const module = requirePrimeModule(moduleId)
  validatePrimeModuleConfig(module, {
    ...existing,
    ...(patch.pinned_version !== undefined ? { pinned_version: patch.pinned_version ?? undefined } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.rollout_mode !== undefined ? { rollout_mode: patch.rollout_mode } : {}),
    ...(patch.config !== undefined ? { config: patch.config } : {}),
  })

  const values: unknown[] = [moduleId]
  const sets: string[] = []

  if ('pinned_version' in patch) {
    values.push(patch.pinned_version ?? null)
    sets.push(`pinned_version = $${values.length}`)
  }

  if ('enabled' in patch) {
    values.push(patch.enabled)
    sets.push(`enabled = $${values.length}`)
  }

  if ('rollout_mode' in patch) {
    values.push(patch.rollout_mode)
    sets.push(`rollout_mode = $${values.length}`)
  }

  if ('config' in patch) {
    values.push(JSON.stringify(patch.config ?? {}))
    sets.push(`config = $${values.length}`)
  }

  if (sets.length === 0) {
    return existing
  }

  const { rows } = await pool.query<PrimeModuleConfig>(
    `UPDATE prime_agent_modules
     SET ${sets.join(', ')}, updated_at = now()
     WHERE module_id = $1
     RETURNING
       module_id,
       stage,
       default_version,
       pinned_version,
       enabled,
       rollout_mode,
       config,
       created_at::text,
       updated_at::text`,
    values
  )

  const config = rows[0]
  if (!config) return null
  const updated = {
    ...config,
    pinned_version: config.pinned_version ?? undefined,
    config: config.config ?? {},
  }
  await pool.query(
    `INSERT INTO prime_agent_module_audits (
       module_id, actor, changed_fields, previous_config, next_config
     ) VALUES ($1, $2, $3, $4, $5)`,
    [
      moduleId,
      actor,
      JSON.stringify(diffPrimeModuleFields(existing, updated)),
      JSON.stringify(existing),
      JSON.stringify(updated),
    ]
  )
  return updated
}

export async function listPrimeModuleConfigAudits(
  pool: pg.Pool,
  moduleId: string,
  limit = 20
): Promise<PrimeModuleConfigAudit[]> {
  const { rows } = await pool.query<PrimeModuleConfigAudit>(
    `SELECT
       id,
       module_id,
       actor,
       changed_fields,
       previous_config,
       next_config,
       created_at::text
     FROM prime_agent_module_audits
     WHERE module_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [moduleId, Math.max(1, Math.min(limit, 100))]
  )

  return rows.map((row) => ({
    ...row,
    changed_fields: Array.isArray(row.changed_fields) ? row.changed_fields : [],
    previous_config: isRecord(row.previous_config) ? row.previous_config : {},
    next_config: isRecord(row.next_config) ? row.next_config : {},
  }))
}

export function summarizePrimeModules(modules: PrimeModule[]): string {
  return modules
    .map((module) => `${module.stage}:${module.id}@${module.version}`)
    .join(', ')
}

export async function runPrimeModules(
  state: PrimeLoopState,
  deps: PrimeModuleDeps,
  modules = listPrimeModules(),
): Promise<void> {
  for (const module of modules) {
    const startedAt = new Date().toISOString()
    try {
      const result = await module.run(state, deps)
      state.moduleRuns.push({
        id: module.id,
        stage: module.stage,
        version: module.version,
        mode: deps.executionMode,
        status: 'completed',
        detail: result?.detail,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.moduleRuns.push({
        id: module.id,
        stage: module.stage,
        version: module.version,
        mode: deps.executionMode,
        status: 'failed',
        detail: message,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      })
      throw error
    }
  }
}

export async function runShadowPrimeModules(
  state: PrimeLoopState,
  deps: PrimeModuleDeps,
  modules: PrimeModule[],
): Promise<void> {
  const shadowState: PrimeLoopState = {
    event: state.event,
    session: state.session,
    context: cloneStateValue(state.context),
    decision: cloneStateValue(state.decision),
    actions: cloneStateValue(state.actions) ?? [],
    diagnostics: [...state.diagnostics],
    moduleRuns: [],
    budget: {
      ...state.budget,
    },
  }

  await runPrimeModules(shadowState, { ...deps, executionMode: 'shadow' }, modules)
  state.moduleRuns.push(...shadowState.moduleRuns)
}

function comparePrimeModules(left: PrimeModule, right: PrimeModule): number {
  if (left.order !== right.order) return left.order - right.order
  if (left.stage !== right.stage) return left.stage.localeCompare(right.stage)
  return left.id.localeCompare(right.id)
}

async function ensurePrimeModuleConfigRows(pool: pg.Pool): Promise<void> {
  for (const module of listPrimeModules()) {
    await pool.query(
      `INSERT INTO prime_agent_modules (module_id, stage, default_version)
       VALUES ($1, $2, $3)
       ON CONFLICT (module_id) DO UPDATE
       SET stage = EXCLUDED.stage,
           default_version = EXCLUDED.default_version,
           updated_at = CASE
             WHEN prime_agent_modules.stage IS DISTINCT FROM EXCLUDED.stage
               OR prime_agent_modules.default_version IS DISTINCT FROM EXCLUDED.default_version
             THEN now()
             ELSE prime_agent_modules.updated_at
           END`,
      [module.id, module.stage, module.version]
    )
  }
}

function hasAllowedFiles(action: PrimeAction): boolean {
  const allowedFiles = action.payload['allowed_files']
  return Array.isArray(allowedFiles) && allowedFiles.some((value) => typeof value === 'string' && value.trim() !== '')
}

function requiresAllowedFiles(action: PrimeAction, capabilities: string[]): boolean {
  const capability = String(action.payload['capability'] ?? '').trim().toLowerCase()
  return capabilities.includes(capability)
}

function validatePrimeModuleConfig(module: PrimeModule, config: Pick<PrimeModuleConfig, 'pinned_version' | 'config' | 'enabled' | 'rollout_mode'>): void {
  if (module.requires_active && (!config.enabled || config.rollout_mode !== 'active')) {
    throw new Error(`invalid prime module patch: ${module.id} must remain enabled and active`)
  }

  if (config.pinned_version && !getPrimeModuleAvailableVersions(module).includes(config.pinned_version)) {
    throw new Error(`invalid prime module patch: pinned_version must match available version for ${module.id}`)
  }

  const value = config.config ?? {}
  if (!isRecord(value)) {
    throw new Error(`invalid prime module patch: config for ${module.id} must be an object`)
  }

  switch (module.id) {
    case 'debounce.pass-through':
      validateAllowedKeys(module.id, value, ['debounce_window_ms'])
      if ('debounce_window_ms' in value && (!Number.isFinite(value.debounce_window_ms) || Number(value.debounce_window_ms) < 0)) {
        throw new Error('invalid prime module patch: debounce_window_ms must be a non-negative number')
      }
      return
    case 'policy.scope-required':
      validateAllowedKeys(module.id, value, ['required_capabilities'])
      if ('required_capabilities' in value) {
        if (
          !Array.isArray(value.required_capabilities) ||
          value.required_capabilities.some((entry) => typeof entry !== 'string' || entry.trim() === '')
        ) {
          throw new Error('invalid prime module patch: required_capabilities must be an array of non-empty strings')
        }
      }
      return
    default:
      validateAllowedKeys(module.id, value, [])
  }
}

function requirePrimeModule(moduleId: string): PrimeModule {
  const module = listPrimeModules().find((entry) => entry.id === moduleId)
  if (!module) {
    throw new Error(`unknown prime module: ${moduleId}`)
  }
  return module
}

function getPrimeModuleAvailableVersions(module: PrimeModule): string[] {
  return Array.from(new Set([module.version, ...(module.available_versions ?? [])]))
}

function cloneStateValue<T>(value: T): T {
  if (value === undefined || value === null) return value
  return structuredClone(value)
}

function validateAllowedKeys(moduleId: string, value: Record<string, unknown>, allowedKeys: string[]): void {
  const invalidKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key))
  if (invalidKeys.length > 0) {
    throw new Error(`invalid prime module patch: unsupported config keys for ${moduleId}: ${invalidKeys.join(', ')}`)
  }
}

function diffPrimeModuleFields(previous: PrimeModuleConfig, next: PrimeModuleConfig): string[] {
  const fields: Array<keyof Pick<PrimeModuleConfig, 'pinned_version' | 'enabled' | 'rollout_mode' | 'config'>> = [
    'pinned_version',
    'enabled',
    'rollout_mode',
    'config',
  ]
  return fields.filter((field) => JSON.stringify(previous[field] ?? null) !== JSON.stringify(next[field] ?? null))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function saveApprovalContinuation(deps: PrimeModuleDeps, state: PrimeLoopState): Promise<void> {
  const snapshot = buildContextSnapshot(state.context!)
  await deps.pool.query(
    `INSERT INTO checkpoint_continuations (owner_type, owner_id, step, context_hash, context_snapshot, continuation, status)
     VALUES ('prime_session', $1, 'awaiting_approval', $2, $3, $4, 'pending')`,
    [
      deps.sessionId,
      hashContextSnapshot(snapshot),
      JSON.stringify(snapshot),
      JSON.stringify({ decision: state.decision }),
    ]
  )
}
