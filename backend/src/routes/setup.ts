import { Router } from 'express'
import type pg from 'pg'
import { encrypt } from '../crypto.js'
import type { RuntimeThread } from '../runtime.js'
import { appendThreadMessage, computeSynopsisInput, createThread } from '../runtime.js'
import {
  ensureWorkspaceScaffold,
  readProfileFiles,
  writeProfileFiles,
  updateWorkspaceConfig,
} from '../workspace.js'
import { buildProfileSynopsis } from '../prime-agent/profile-synopsis.js'
import type { SoulSectionKey, OperatingSectionKey } from '../prime-agent/profile-sections.js'
import type {
  PrimeFunctionAssignment,
  PrimeOnboardingFunctionKey,
  LaunchReadinessResult,
} from '../prime-agent/config.js'
import type { ProviderDraft } from '../registry.js'
import { convertAssignmentsToModelPreferences, mergePrimeConfigWithDefaults, validateFunctionAssignments, DEFAULT_ONBOARDING_ASSIGNMENTS } from '../prime-agent/config.js'
import { mapProviderToDraft, insertAgent } from '../registry.js'
import { isOpenAiCompatibleProviderType, loadLocalLlmConfig, shouldUseEnvLocalLlmApiKey } from '../local-llm.js'

// ─── Onboarding DTO Types ──────────────────────────────────────────────────────

/** Routing draft for onboarding (provider/model assignments). */
export interface RoutingDraft {
  [routeName: string]: Array<{
    provider_id: string
    model: string
  }>
}

/** Prime function assignment draft for onboarding. */
export interface FunctionAssignmentDraft {
  function_key: PrimeOnboardingFunctionKey | string
  display_name: string
  purpose: string
  required: boolean
  provider_id?: string | null
  model?: string | null
  validation_status?: 'missing' | 'valid' | 'warning' | 'blocked'
  warnings?: string[]
  is_default_choice?: boolean
}

/** Plugin choice for onboarding (internal format). */
export interface PluginChoiceInternal {
  plugin_id: string
  name: string
  description: string
  selected: boolean
  deferred_config: boolean
}

/** Plugin choice for onboarding (API response format). */
export interface PluginChoice {
  plugin_id: string
  name: string
  description: string
  availability: 'available' | 'unavailable' | 'unknown'
  selected: boolean
  configuration_state: 'not_required' | 'deferred_post_launch' | 'configured' | 'unavailable'
  post_launch_configuration_required: boolean
}

/** Transform internal plugin choice to API response format. */
function transformPluginChoice(internal: PluginChoiceInternal): PluginChoice {
  return {
    plugin_id: internal.plugin_id,
    name: internal.name,
    description: internal.description,
    availability: 'available',
    selected: internal.selected,
    configuration_state: internal.deferred_config
      ? 'deferred_post_launch'
      : 'not_required',
    post_launch_configuration_required: internal.deferred_config,
  }
}

/** Team plan draft for onboarding. */
export interface TeamPlanDraft {
  id: string
  title: string
  agents: Array<{
    name: string
    role: string
    function_key: string
    provider_id: string | null
    model: string | null
  }>
  recommended: boolean
  confirmed: boolean
}

/** Setup draft for onboarding (full state). */
export interface SetupDraftInternal {
  providers: ProviderDraft[]
  function_assignments: FunctionAssignmentDraft[]
  prime_config_draft: {
    enabled: boolean
    cron_fast_interval_seconds: number
    debounce_window_ms: number
    monthly_token_budget: number
  }
  plugin_choices: PluginChoiceInternal[]
  team_plan?: TeamPlanDraft | null
  current_step: 'intro' | 'providers' | 'function_assignment' | 'prime_config' | 'plugins' | 'workspace' | 'launch' | 'prime_conversation' | 'complete'
  status: 'not_started' | 'in_progress' | 'blocked' | 'ready_to_launch' | 'launching' | 'launched' | 'complete'
  last_error?: string
}

/** Setup draft for onboarding (full state) - API response format. */
export interface SetupDraft {
  providers: ProviderDraft[]
  function_assignments: FunctionAssignmentDraft[]
  prime_config_draft: {
    enabled: boolean
    cron_fast_interval_seconds: number
    debounce_window_ms: number
    monthly_token_budget: number
  }
  plugin_choices: PluginChoice[]
  team_plan?: TeamPlanDraft | null
  current_step: 'intro' | 'providers' | 'function_assignment' | 'prime_config' | 'plugins' | 'workspace' | 'launch' | 'prime_conversation' | 'complete'
  status: 'not_started' | 'in_progress' | 'blocked' | 'ready_to_launch' | 'launching' | 'launched' | 'complete'
  last_error?: string
}

/** Transform internal setup draft to API response format. */
function transformSetupDraft(internal: SetupDraftInternal): SetupDraft {
  return {
    ...internal,
    plugin_choices: internal.plugin_choices.map(transformPluginChoice),
  }
}

function withDefaultAssignments(assignments: PrimeFunctionAssignment[]): PrimeFunctionAssignment[] {
  const byKey = new Map(assignments.map((assignment) => [assignment.function_key, assignment]))
  return DEFAULT_ONBOARDING_ASSIGNMENTS.map((defaultAssignment) => ({
    ...defaultAssignment,
    provider_id: null,
    model: null,
    ...(byKey.get(defaultAssignment.function_key) ?? {}),
  }))
}

function applyAssignmentValidation(assignments: PrimeFunctionAssignment[]): FunctionAssignmentDraft[] {
  const normalizedAssignments = withDefaultAssignments(assignments)
  const readiness = validateFunctionAssignments(normalizedAssignments)
  const validations = new Map(readiness.assignments.map((assignment) => [assignment.function_key, assignment]))
  return normalizedAssignments.map((assignment) => {
    const validation = validations.get(assignment.function_key)
    return {
      ...assignment,
      provider_id: assignment.provider_id ?? null,
      model: assignment.model ?? null,
      validation_status: validation?.validation_status ?? 'missing',
      warnings: validation?.warnings ?? [],
      is_default_choice: assignment.is_default_choice ?? !(assignment.provider_id && assignment.model),
    } as FunctionAssignmentDraft
  })
}

function toLaunchReadinessResponse(
  readiness: LaunchReadinessResult,
  providers: unknown[] = [],
  pluginChoices: unknown[] = [],
) {
  return {
    ...readiness,
    warnings: readiness.warning_messages,
    summary: {
      providers: providers.length,
      required_functions: readiness.summary.required_functions,
      selected_plugins: pluginChoices.filter((plugin) => Boolean((plugin as { selected?: boolean }).selected)).length,
    },
  }
}

export function createSetupRouter({
  pool,
  onSetupCompleted,
}: {
  pool: pg.Pool
  onSetupCompleted?: () => Promise<void> | void
}) {
  const router = Router()

  router.get('/plugins', (_req, res) => {
    const plugins = [
      {
        id: 'spec-kit',
        name: 'Spec Kit',
        description: 'Schema and specification validation toolkit',
        optional: true,
        status: 'available' as const
      },
      {
        id: 'plan-mode',
        name: 'Plan Mode',
        description: 'Strategic planning and task decomposition helper',
        optional: true,
        status: 'available' as const
      },
      {
        id: 'code-review',
        name: 'Code Review',
        description: 'Automated code quality and style analysis',
        optional: true,
        status: 'available' as const
      },
      {
        id: 'git-hooks',
        name: 'Git Hooks',
        description: 'Pre-commit and post-merge hook automation',
        optional: true,
        status: 'available' as const
      }
    ]
    res.json(plugins)
  })

  router.get('/status', async (_req, res) => {
    try {
      const localLlm = await loadLocalLlmConfig(process.env)

      // Check for legacy completion (has providers or setup_complete)
      const { rows: providerRows } = await pool.query(
        `SELECT COUNT(*)::int AS count
         FROM providers
         WHERE NOT (type = 'codex' AND name = 'Codex (local)')`
      )
      const { rows: configRows } = await pool.query(
        "SELECT setup_complete FROM prime_agent_config WHERE id = 'default'"
      )
      const legacyComplete = providerRows[0]?.count > 0 || configRows[0]?.setup_complete

      if (legacyComplete) {
        return res.json({
          complete: true,
          ...(localLlm ? {
            local_provider_default: {
              name: localLlm.name,
              type: localLlm.type,
              base_url: localLlm.base_url,
              ...(localLlm.model ? { model: localLlm.model } : {}),
              api_key_configured: localLlm.api_key_configured,
              ...(localLlm.autodiscovered ? { autodiscovered: true } : {}),
              ...(localLlm.discovery_error ? { discovery_error: localLlm.discovery_error } : {}),
            },
          } : {}),
        })
      }

      // Check for new onboarding session
      const { rows: sessionRows } = await pool.query(
        `SELECT id, current_step, status, providers, function_assignments,
                  prime_config_draft, plugin_choices, team_plan, last_error
         FROM onboarding_session WHERE id = 'default'`
      )

      if (sessionRows.length === 0) {
        // No onboarding session yet - return empty state
        return res.json({
          complete: false,
          current_step: null,
          status: null,
          can_resume: false,
          ...(localLlm ? {
            local_provider_default: {
              name: localLlm.name,
              type: localLlm.type,
              base_url: localLlm.base_url,
              ...(localLlm.model ? { model: localLlm.model } : {}),
              api_key_configured: localLlm.api_key_configured,
              ...(localLlm.autodiscovered ? { autodiscovered: true } : {}),
              ...(localLlm.discovery_error ? { discovery_error: localLlm.discovery_error } : {}),
            },
          } : {}),
        })
      }

      const session = sessionRows[0]
      const providers = (session.providers as ProviderDraft[] | null) ?? []

      return res.json({
        complete: false,
        current_step: session.current_step,
        status: session.status,
        can_resume: true,
        has_providers: providers.length > 0,
        last_error: session.last_error ?? undefined,
        ...(localLlm ? {
          local_provider_default: {
            name: localLlm.name,
            type: localLlm.type,
            base_url: localLlm.base_url,
            ...(localLlm.model ? { model: localLlm.model } : {}),
            api_key_configured: localLlm.api_key_configured,
            ...(localLlm.autodiscovered ? { autodiscovered: true } : {}),
            ...(localLlm.discovery_error ? { discovery_error: localLlm.discovery_error } : {}),
          },
        } : {}),
      })
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/ollama-models', async (req, res) => {
    const base_url = req.query.base_url as string | undefined
    if (!base_url) {
      return res.status(400).json({ error: 'base_url query param required' })
    }
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3_000)
      const upstream = await fetch(`${base_url}/api/tags`, { signal: controller.signal })
      clearTimeout(timeout)
      const data = await upstream.json()
      res.json(data)
    } catch {
      res.json({ error: 'unreachable' })
    }
  })

  router.post('/provider-models', async (req, res) => {
    const body = req.body as { type?: string; base_url?: string; api_key?: string }
    const type = body.type?.trim()
    const baseUrl = body.base_url?.trim().replace(/\/+$/, '')
    const localLlm = await loadLocalLlmConfig(process.env)
    const apiKey = body.api_key?.trim() || (shouldUseEnvLocalLlmApiKey({ type, base_url: baseUrl }, localLlm) ? localLlm?.api_key : undefined)

    if (!type || !baseUrl) {
      return res.status(400).json({ error: 'type and base_url are required' })
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5_000)
      let upstream: Response

      if (type === 'ollama') {
        upstream = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal })
        clearTimeout(timeout)
        const data = await upstream.json() as { models?: Array<{ name?: string }> }
        const models = (data.models ?? []).map((m) => m.name).filter(Boolean)
        return res.json({ models })
      }

      if (type === 'anthropic') {
        if (!apiKey) {
          clearTimeout(timeout)
          return res.status(400).json({ error: 'api_key is required for anthropic model discovery' })
        }
        upstream = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal,
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        })
      } else if (type === 'llamacpp') {
        const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
        upstream = await fetch(`${baseUrl}/v1/models`, {
          signal: controller.signal,
          ...(headers ? { headers } : {}),
        })
        if (!upstream.ok) {
          const health = await fetch(`${baseUrl}/health`, {
            signal: controller.signal,
            ...(headers ? { headers } : {}),
          })
          clearTimeout(timeout)
          if (health.ok) {
            return res.json({ models: [] })
          }
          return res.status(upstream.status).json({ error: 'provider rejected model discovery request' })
        }
      } else if (isOpenAiCompatibleProviderType(type) && type !== 'openai' && type !== 'codex') {
        const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
        const modelsPath = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`
        upstream = await fetch(modelsPath, {
          signal: controller.signal,
          ...(headers ? { headers } : {}),
        })
      } else if (apiKey) {
        upstream = await fetch(`${baseUrl}/models`, {
          signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}` },
        })
      } else {
        // No API key for OpenAI-compatible provider (e.g. subscription/device auth flow).
        // Return sensible defaults so the UI can still populate model dropdowns.
        clearTimeout(timeout)
        return res.json({ models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o3-mini', 'o4-mini'] })
      }

      clearTimeout(timeout)
      if (!upstream.ok) {
        return res.status(upstream.status).json({ error: 'provider rejected model discovery request' })
      }

      const data = await upstream.json() as { data?: Array<{ id?: string }> }
      const models = (data.data ?? []).map((m) => m.id).filter(Boolean).sort()
      res.json({ models })
    } catch {
      res.json({ error: 'unreachable', models: [] })
    }
  })

  const PRESET_LABELS: Record<string, string> = {
    test_before_delegate: 'Always run tests before delegating work to agents',
    no_force_push: 'Never force-push to main or protected branches',
    small_prs: 'Prefer small, reviewable pull requests over large ones',
    confirm_destructive: 'Ask before taking destructive or irreversible actions',
    humans_in_loop: 'Keep humans in the loop on external communications',
  }

  router.post('/complete', async (req, res) => {
    const body = req.body as {
      providers?: Array<{ id?: string; name: string; type: string; base_url: string; api_key?: string; model?: string }>
      routing?: Record<string, Array<{ provider_name: string; model: string }>>
      profile?: {
        name?: string
        soul?: { identity?: string; voice_tone?: string; decision_style?: string }
        operating?: { default_behaviors?: string; approval_thresholds?: string }
      }
      persona?: { name: string; focus: string; tone: string; instructions?: string }
      rules?: { presets: string[]; custom: string }
      cost_controls?: { monthly_token_budget: number }
      prime_config?: {
        enabled?: boolean
        cron_fast_interval_seconds?: number
        cron_slow_interval_seconds?: number
        debounce_window_ms?: number
        monthly_token_budget?: number
      }
      workspace?: { mode?: 'local' | 'git'; root_path?: string; remote_url?: string; branch?: string }
      launch?: boolean
      function_assignments?: FunctionAssignmentDraft[]
      plugin_choices?: PluginChoice[]
    }

    if (!Array.isArray(body?.providers) || !body?.routing || !body?.rules || (!body.profile && !body.persona)) {
      const missingFields: string[] = []
      if (!Array.isArray(body?.providers) || (body?.providers as unknown[] | undefined)?.length === 0) missingFields.push('providers (at least one must be active)')
      if (!body?.routing) missingFields.push('routing')
      if (!body?.rules) missingFields.push('rules')
      if (!body?.profile && !body?.persona) missingFields.push('profile / persona')
      return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` })
    }

    try {
      const providerNameToId = new Map<string, string>()
      const localLlm = await loadLocalLlmConfig(process.env)

      for (const p of body.providers) {
        if (p.id) {
          const { rows: existingById } = await pool.query(
            'SELECT id FROM providers WHERE id = $1',
            [p.id]
          )
          if (existingById.length > 0) {
            providerNameToId.set(p.name, existingById[0].id)
            providerNameToId.set(p.id, existingById[0].id)
            continue
          }
        }

        const { rows: existing } = await pool.query(
          'SELECT id FROM providers WHERE name = $1',
          [p.name]
        )

        if (existing.length > 0) {
          const effectiveApiKey = p.api_key || (shouldUseEnvLocalLlmApiKey({ type: p.type, base_url: p.base_url }, localLlm) ? localLlm?.api_key : undefined)
          const encKey = effectiveApiKey ? encrypt(effectiveApiKey) : undefined
          if (encKey) {
            await pool.query(
              'UPDATE providers SET type=$2, base_url=$3, model=$4, api_key=$5 WHERE id=$1',
              [existing[0].id, p.type, p.base_url, p.model ?? null, encKey]
            )
          } else {
            await pool.query(
              'UPDATE providers SET type=$2, base_url=$3, model=$4 WHERE id=$1',
              [existing[0].id, p.type, p.base_url, p.model ?? null]
            )
          }
          providerNameToId.set(p.name, existing[0].id)
          if (p.id) providerNameToId.set(p.id, existing[0].id)
        } else {
          const effectiveApiKey = p.api_key || (shouldUseEnvLocalLlmApiKey({ type: p.type, base_url: p.base_url }, localLlm) ? localLlm?.api_key : undefined)
          const encKey = effectiveApiKey ? encrypt(effectiveApiKey) : null
          const { rows: inserted } = await pool.query(
            'INSERT INTO providers (name, type, base_url, api_key, model) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [p.name, p.type, p.base_url, encKey, p.model ?? null]
          )
          providerNameToId.set(p.name, inserted[0].id)
          if (p.id) providerNameToId.set(p.id, inserted[0].id)
        }
      }

      const routing: Record<string, Array<{ provider_id: string; model: string }>> = {}
      for (const [routeName, routes] of Object.entries(body.routing)) {
        const resolved = (routes ?? [])
          .filter((r) => r.provider_name && providerNameToId.has(r.provider_name))
          .map((r) => ({ provider_id: providerNameToId.get(r.provider_name)!, model: r.model }))
        if (resolved.length > 0) routing[routeName] = resolved
      }

      const functionAssignments = (body.function_assignments ?? []).map((assignment) => ({
        ...assignment,
        provider_id: assignment.provider_id && providerNameToId.has(assignment.provider_id)
          ? providerNameToId.get(assignment.provider_id)!
          : assignment.provider_id ?? null,
        model: assignment.model ?? null,
      }))
      const assignmentReadiness = functionAssignments.length > 0
        ? validateFunctionAssignments(functionAssignments as PrimeFunctionAssignment[])
        : null
      if (body.launch === true && assignmentReadiness && !assignmentReadiness.ready) {
        const reasons = assignmentReadiness.blocking_reasons ?? []
        const detail = reasons.length > 0 ? `: ${reasons.join('; ')}` : ''
        return res.status(400).json({
          error: `Prime function assignments are not launch-ready${detail}`,
          launch_readiness: assignmentReadiness,
        })
      }
      const modelPreferences = functionAssignments.length > 0
        ? convertAssignmentsToModelPreferences(functionAssignments as PrimeFunctionAssignment[])
        : {}

      // --- profile block (structured or legacy persona) ---
      const name = body.profile?.name?.trim() || body.persona?.name?.trim() || 'Prime'

      let soulSections: Record<SoulSectionKey, string>
      let operatingSections: Record<OperatingSectionKey, string>

      if (body.profile) {
        soulSections = {
          identity:       body.profile.soul?.identity       ?? '',
          voice_tone:     body.profile.soul?.voice_tone     ?? '',
          decision_style: body.profile.soul?.decision_style ?? '',
        }
        operatingSections = {
          default_behaviors:   body.profile.operating?.default_behaviors   ?? '',
          approval_thresholds: body.profile.operating?.approval_thresholds ?? '',
        }
      } else {
        const p = body.persona!
        const toneLabel =
          p.tone === 'direct' ? 'Direct & concise.'
          : p.tone === 'thorough' ? 'Thorough & deliberate.'
          : 'Collaborative & inquisitive.'
        soulSections = {
          identity:       `You are ${name}, ${p.focus || 'the coordination agent'}.`,
          voice_tone:     toneLabel,
          decision_style: (p.instructions ?? '').trim() || 'Smallest useful next step wins.',
        }
        operatingSections = { default_behaviors: '', approval_thresholds: '' }
      }

      await ensureWorkspaceScaffold(pool)

      // Seed chief_profiles row if missing; writeProfileFiles overwrites it immediately after.
      await pool.query(
        `INSERT INTO chief_profiles (id, name, persona, operating_policy)
         VALUES ('default', $1, '', '')
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
        [name],
      )

      // Read existing so unknown sections are preserved across legacy → structured upgrade
      const current = await readProfileFiles(pool)
      current.soul.sections = soulSections
      if (body.profile) {
        current.operating.sections = operatingSections
      }
      await writeProfileFiles(pool, current)

      // --- standing rules ---
      const rules = body.rules
      const presetLines = rules.presets.map((k) => PRESET_LABELS[k]).filter(Boolean)
      const policyParts = [...presetLines]
      if (rules.custom?.trim()) policyParts.push('', rules.custom.trim())

      await pool.query(
        `UPDATE chief_profiles SET operating_policy = $1, updated_at = now() WHERE id = 'default'`,
        [policyParts.join('\n')],
      )

      // --- validate prime config fields before persistence ---
      const primeConfig = body.prime_config ?? {}
      const cronFast = primeConfig.cron_fast_interval_seconds
      const cronSlow = primeConfig.cron_slow_interval_seconds
      const debounceMs = primeConfig.debounce_window_ms
      const monthlyBudget = primeConfig.monthly_token_budget

      if (typeof cronFast !== 'undefined' && (!Number.isInteger(cronFast) || cronFast <= 0)) {
        return res.status(400).json({
          error: 'cron_fast_interval_seconds must be a positive integer',
        })
      }

      if (typeof cronSlow !== 'undefined' && (!Number.isInteger(cronSlow) || cronSlow <= 0)) {
        return res.status(400).json({
          error: 'cron_slow_interval_seconds must be a positive integer',
        })
      }

      if (typeof cronFast !== 'undefined' && typeof cronSlow !== 'undefined' && cronSlow < cronFast) {
        return res.status(400).json({
          error: 'cron_slow_interval_seconds must be greater than or equal to cron_fast_interval_seconds',
        })
      }

      if (typeof debounceMs !== 'undefined' && (!Number.isInteger(debounceMs) || debounceMs < 0)) {
        return res.status(400).json({
          error: 'debounce_window_ms must be a non-negative integer',
        })
      }

      if (typeof monthlyBudget !== 'undefined' && (typeof monthlyBudget !== 'number' || monthlyBudget < 0)) {
        return res.status(400).json({
          error: 'monthly_token_budget must be a non-negative number',
        })
      }

      // --- cost controls + workspace + launch ---
      const costControls = body.cost_controls ?? { monthly_token_budget: 0 }
      const launch = body.launch === true
      const workspace = body.workspace ?? {}

      await updateWorkspaceConfig(pool, {
        mode: workspace.mode === 'git' ? 'git' : 'local',
        ...(workspace.root_path ? { root_path: workspace.root_path } : {}),
        remote_url: workspace.remote_url?.trim() || null,
        branch: workspace.branch?.trim() || 'main',
      })

      // Merge cost_controls with prime_config values for persistence
      const finalCostControls = {
        monthly_token_budget: primeConfig.monthly_token_budget ?? costControls.monthly_token_budget,
      }

      // Use the helper to merge Prime config values with defaults
      const mergedPrimeConfig = mergePrimeConfigWithDefaults({
        cron_fast_interval_seconds: primeConfig.cron_fast_interval_seconds,
        cron_slow_interval_seconds: primeConfig.cron_slow_interval_seconds,
        debounce_window_ms: primeConfig.debounce_window_ms,
        cost_controls: finalCostControls,
      })

      // Persist plugin_choices in the finalized snapshot
      const apiPluginChoices = (body.plugin_choices ?? []) as PluginChoice[]
      const pluginChoicesInternal: PluginChoiceInternal[] = apiPluginChoices.map((pc) => ({
        plugin_id: pc.plugin_id,
        name: pc.name,
        description: pc.description,
        selected: pc.selected,
        deferred_config: pc.post_launch_configuration_required ?? pc.configuration_state === 'deferred_post_launch',
      }))

      await pool.query(
        `UPDATE prime_agent_config
         SET provider_routing=$1, cost_controls=$2,
             enabled = CASE WHEN $3 THEN true ELSE enabled END,
             setup_complete=true,
             cron_fast_interval_seconds = $4, cron_slow_interval_seconds = $5, debounce_window_ms = $6,
             model_preferences = CASE WHEN $7::jsonb = '{}'::jsonb THEN model_preferences ELSE $7::jsonb END,
             updated_at = now()
         WHERE id='default'`,
        [JSON.stringify(routing), JSON.stringify(finalCostControls), launch, mergedPrimeConfig.cron_fast_interval_seconds, mergedPrimeConfig.cron_slow_interval_seconds, mergedPrimeConfig.debounce_window_ms, JSON.stringify(modelPreferences)]
      )

      // Create or reuse onboarding thread when launch is true
      let primeLaunchResult: { status: 'launched' | 'error'; thread_id?: string; error?: string } | undefined

      if (launch) {
        try {
          const primeName = name
          const synopsis = buildProfileSynopsis(await computeSynopsisInput(pool))

          // Check for existing onboarding thread for this session
          const { rows: existingThreadRows } = await pool.query(
            `SELECT id, metadata FROM threads
             WHERE metadata->>'kind' = 'onboarding'
             ORDER BY created_at DESC LIMIT 1`
          )

          let onboardingThread: RuntimeThread
          if (existingThreadRows.length > 0) {
            // Reuse existing onboarding thread
            onboardingThread = {
              id: existingThreadRows[0].id,
              title: existingThreadRows[0].metadata?.title || `Getting started with ${primeName}`,
              status: 'active',
              metadata: existingThreadRows[0].metadata,
              created_at: existingThreadRows[0].created_at,
              updated_at: existingThreadRows[0].updated_at,
            }
          } else {
            // Create new onboarding thread
            onboardingThread = await createThread(pool, {
              title: `Getting started with ${primeName}`,
              metadata: {
                kind: 'onboarding',
                source: 'setup-launch',
              },
            })
          }

          // Build configuration context message
          const routingEntries = Object.entries(routing).length
          const pluginCount = pluginChoicesInternal.filter((p) => p.selected).length
          const configContext = [
            `Setup complete. Configuration:`,
            `- Providers: ${body.providers?.length ?? 0}, Routes: ${routingEntries}`,
            `- Plugins selected: ${pluginCount}/${pluginChoicesInternal.length}`,
            `- Prime cron_fast_interval_seconds: ${mergedPrimeConfig.cron_fast_interval_seconds}`,
            `- Prime debounce_window_ms: ${mergedPrimeConfig.debounce_window_ms}`,
            `- Prime monthly_token_budget: ${finalCostControls.monthly_token_budget}`,
          ].join('\n')

          const initialContent = `${configContext}\n\nI'm ${primeName}. ${synopsis}`

          await appendThreadMessage(pool, onboardingThread.id, {
            role: 'assistant',
            sender: primeName,
            content: initialContent,
            metadata: {
              kind: 'greeting',
            },
          })

          primeLaunchResult = { status: 'launched', thread_id: onboardingThread.id }
          console.log('[setup] Prime launch complete, thread_id=%s', onboardingThread.id)
        } catch (err) {
          console.error('[setup] Prime thread creation failed:', err)
          primeLaunchResult = { status: 'error', error: (err as Error).message ?? 'failed to create onboarding thread' }
        }
      }

      await onSetupCompleted?.()

      // Return response with launch result if applicable
      if (launch) {
        res.json({ ok: true, prime_launch: primeLaunchResult })
      } else {
        res.json({ ok: true })
      }


    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  // ─── Onboarding: Setup draft helpers ─────────────────────────────────────────

  /** Load the current onboarding session draft from the database. */
  router.get('/draft', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, current_step, status, providers, function_assignments,
                  prime_config_draft, plugin_choices, team_plan, last_error
         FROM onboarding_session WHERE id = 'default'`
      )

      let functionAssignments: FunctionAssignmentDraft[]
      if (rows.length === 0 || !rows[0].function_assignments || rows[0].function_assignments.length === 0) {
        // Return default assignments for new onboarding or empty session
        // Include provider_id and model keys with null values as required by contract
        functionAssignments = DEFAULT_ONBOARDING_ASSIGNMENTS.map(assignment => ({
          function_key: assignment.function_key,
          display_name: assignment.display_name,
          purpose: assignment.purpose,
          required: assignment.required,
          provider_id: null,
          model: null,
          validation_status: 'missing' as const,
          warnings: [],
          is_default_choice: true,
        }))
      } else {
        functionAssignments = rows[0].function_assignments ?? []
      }

      functionAssignments = applyAssignmentValidation(functionAssignments as PrimeFunctionAssignment[])
      const draftProviders = rows.length > 0 ? (rows[0].providers ?? []) : []
      const draftPluginsRaw = rows.length > 0 ? (rows[0].plugin_choices ?? []) : []
      // Transform internal plugin choices to API response format
      const draftPlugins: PluginChoice[] = draftPluginsRaw.map(transformPluginChoice)
      const launchReadiness = validateFunctionAssignments(functionAssignments as PrimeFunctionAssignment[])

      const response = {
        providers: draftProviders,
        function_assignments: functionAssignments,
        prime_config_draft: {
          enabled: rows.length > 0 ? (rows[0].prime_config_draft?.enabled ?? false) : false,
          cron_fast_interval_seconds: rows.length > 0 ? (rows[0].prime_config_draft?.cron_fast_interval_seconds ?? 300) : 300,
          cron_slow_interval_seconds: rows.length > 0 ? (rows[0].prime_config_draft?.cron_slow_interval_seconds ?? 3600) : 3600,
          debounce_window_ms: rows.length > 0 ? (rows[0].prime_config_draft?.debounce_window_ms ?? 10000) : 10000,
          monthly_token_budget: rows.length > 0 ? (rows[0].prime_config_draft?.monthly_token_budget ?? 0) : 0,
        },
        plugin_choices: draftPlugins,
        team_plan: rows.length > 0 ? (rows[0].team_plan ?? undefined) : undefined,
        current_step: rows.length > 0 ? rows[0].current_step : 'providers',
        status: rows.length > 0 ? rows[0].status : 'not_started',
        last_error: rows.length > 0 ? (rows[0].last_error ?? undefined) : undefined,
        launch_readiness: toLaunchReadinessResponse(launchReadiness, draftProviders, draftPlugins),
      }

      res.json(response)
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  /** Save the current onboarding session draft to the database. */
  router.put('/draft', async (req, res) => {
    try {
      const body = req.body as {
        providers?: ProviderDraft[]
        function_assignments?: FunctionAssignmentDraft[]
        prime_config_draft?: {
          enabled?: boolean
          cron_fast_interval_seconds?: number
          cron_slow_interval_seconds?: number
          debounce_window_ms?: number
          monthly_token_budget?: number
        }
        plugin_choices?: PluginChoice[]
        team_plan?: TeamPlanDraft
        current_step?: SetupDraft['current_step']
        status?: SetupDraft['status']
      }

      const providers = body.providers ?? []
      let functionAssignments = body.function_assignments ?? []
      const primeConfigDraft = {
        enabled: body.prime_config_draft?.enabled,
        cron_fast_interval_seconds: body.prime_config_draft?.cron_fast_interval_seconds,
        cron_slow_interval_seconds: body.prime_config_draft?.cron_slow_interval_seconds,
        debounce_window_ms: body.prime_config_draft?.debounce_window_ms,
        monthly_token_budget: body.prime_config_draft?.monthly_token_budget,
      }
      // Transform API plugin choices (frontend format) to internal format for storage
      const apiPluginChoices = body.plugin_choices ?? []
      const pluginChoicesInternal: PluginChoiceInternal[] = apiPluginChoices.map((pc) => ({
        plugin_id: pc.plugin_id,
        name: pc.name,
        description: pc.description,
        selected: pc.selected,
        deferred_config: pc.post_launch_configuration_required ?? pc.configuration_state === 'deferred_post_launch',
      }))
      const teamPlan = body.team_plan ?? null
      const currentStep = body.current_step ?? 'providers'
      const status = body.status ?? 'in_progress'
      functionAssignments = applyAssignmentValidation(functionAssignments as PrimeFunctionAssignment[])

      await pool.query(
        `INSERT INTO onboarding_session (id, current_step, status, providers, function_assignments,
                                        prime_config_draft, plugin_choices, team_plan)
         VALUES ('default', $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           current_step = EXCLUDED.current_step,
           status = EXCLUDED.status,
           providers = EXCLUDED.providers,
           function_assignments = EXCLUDED.function_assignments,
           prime_config_draft = EXCLUDED.prime_config_draft,
           plugin_choices = EXCLUDED.plugin_choices,
           team_plan = EXCLUDED.team_plan,
           last_error = NULL,
           updated_at = now()`,
        [
          currentStep,
          status,
          JSON.stringify(providers),
          JSON.stringify(functionAssignments),
          JSON.stringify(primeConfigDraft),
          JSON.stringify(pluginChoicesInternal),
          teamPlan ? JSON.stringify(teamPlan) : null,
        ]
      )

      const launchReadiness = validateFunctionAssignments(functionAssignments as PrimeFunctionAssignment[])

      // Transform internal plugin choices back to API format for response
      const pluginChoicesApi: PluginChoice[] = pluginChoicesInternal.map(transformPluginChoice)

      res.json({
        ok: true,
        launch_readiness: toLaunchReadinessResponse(launchReadiness, providers, pluginChoicesApi),
      })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  router.post('/validate-launch', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT providers, function_assignments, plugin_choices, prime_config_draft
         FROM onboarding_session WHERE id = 'default'`
      )
      const providers = rows.length > 0 ? (rows[0].providers ?? []) : []
      const pluginChoices = rows.length > 0 ? (rows[0].plugin_choices ?? []) : []
      const rawAssignments = rows.length > 0 && Array.isArray(rows[0].function_assignments) && rows[0].function_assignments.length > 0
        ? rows[0].function_assignments
        : []
      const functionAssignments = applyAssignmentValidation(rawAssignments as PrimeFunctionAssignment[])
      const launchReadiness = validateFunctionAssignments(functionAssignments as PrimeFunctionAssignment[])

      // Validate prime config fields if present
      const primeConfigDraft = rows.length > 0 ? (rows[0].prime_config_draft ?? {}) : {}
      const cronFast = primeConfigDraft.cron_fast_interval_seconds
      const cronSlow = primeConfigDraft.cron_slow_interval_seconds
      const debounceMs = primeConfigDraft.debounce_window_ms
      const monthlyBudget = primeConfigDraft.monthly_token_budget

      const validationErrors: string[] = []

      if (typeof cronFast !== 'undefined' && (!Number.isInteger(cronFast) || cronFast <= 0)) {
        validationErrors.push('cron_fast_interval_seconds must be a positive integer')
      }

      if (typeof cronSlow !== 'undefined' && (!Number.isInteger(cronSlow) || cronSlow <= 0)) {
        validationErrors.push('cron_slow_interval_seconds must be a positive integer')
      }

      if (typeof cronFast !== 'undefined' && typeof cronSlow !== 'undefined' && cronSlow < cronFast) {
        validationErrors.push('cron_slow_interval_seconds must be greater than or equal to cron_fast_interval_seconds')
      }

      if (typeof debounceMs !== 'undefined' && (!Number.isInteger(debounceMs) || debounceMs < 0)) {
        validationErrors.push('debounce_window_ms must be a non-negative integer')
      }

      if (typeof monthlyBudget !== 'undefined' && (typeof monthlyBudget !== 'number' || monthlyBudget < 0)) {
        validationErrors.push('monthly_token_budget must be a non-negative number')
      }

      const result = toLaunchReadinessResponse(launchReadiness, providers, pluginChoices)

      // Add prime config validation errors to the response
      if (validationErrors.length > 0) {
        result.ready = false
        if (!result.blocking_reasons) result.blocking_reasons = []
        result.blocking_reasons.push(...validationErrors)
      }

      res.json(result)
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  // ─── Team Plan Endpoints ─────────────────────────────────────────────────────

  /** GET /api/setup/team-plan/:id - Fetch a team plan by ID */
  router.post('/team-plan/generate', async (_req, res) => {
    try {
      const { generateTeamPlan } = await import('../prime-agent/service.js')
      const plan = await generateTeamPlan(pool, 'default')
      res.json(plan)
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  router.get('/team-plan/:id', async (req, res) => {
    try {
      const { id } = req.params
      const { rows } = await pool.query(
        `SELECT id, title, confirmation_status, agents, created_agent_ids
         FROM team_plans WHERE id = $1`,
        [id]
      )

      if (rows.length === 0) {
        return res.status(404).json({ error: 'team plan not found' })
      }

      const teamPlan = rows[0]
      res.json({
        team_plan: {
          id: teamPlan.id,
          title: teamPlan.title,
          confirmation_status: teamPlan.confirmation_status,
          agents: teamPlan.agents,
          created_agent_ids: teamPlan.created_agent_ids,
        },
      })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  /** POST /api/setup/team-plan/:id/confirm - Confirm and create agents from team plan */
  router.post('/team-plan/:id/confirm', async (req, res) => {
    try {
      const { id } = req.params
      const { selected_roles, confirm } = req.body as { selected_roles: string[]; confirm: boolean }

      if (confirm !== true) {
        return res.status(400).json({ error: 'confirm must be true' })
      }

      // Fetch team plan by id
      const { rows: teamPlanRows } = await pool.query(
        `SELECT agents FROM team_plans WHERE id = $1`,
        [id]
      )

      if (teamPlanRows.length === 0) {
        return res.status(404).json({ error: 'team plan not found' })
      }

      const teamPlan = teamPlanRows[0]
      const agents = teamPlan.agents as Array<{
        name: string
        role: string
        function_key: string
        provider_id: string | null
        model: string | null
        capabilities?: unknown
      }>

      const createdAgentIds: string[] = []
      const failedAgents: Array<{ name: string; reason: string }> = []

      // Process each agent where role is in selected_roles
      for (const agent of agents) {
        if (!selected_roles.includes(agent.role)) {
          continue
        }

        try {
          const created = await insertAgent(pool, {
            name: agent.name,
            type: 'ephemeral',
            runtime_family: 'custom',
            execution_mode: 'external',
            capabilities: Array.isArray(agent.capabilities) ? agent.capabilities as string[] : [],
            config: { onboarding_created: true, role: agent.role },
            enabled: true,
          })
          createdAgentIds.push(created.id)
        } catch (err) {
          console.error('[setup] team-plan agent creation failed for role=%s:', agent.role, err)
          failedAgents.push({
            name: agent.name,
            reason: (err as Error).message ?? 'unknown error',
          })
        }
      }

      // Determine confirmation status
      const allSucceeded = failedAgents.length === 0
      const confirmationStatus = allSucceeded ? 'confirmed' : 'partially_confirmed'

      // Update team plan
      await pool.query(
        `UPDATE team_plans
         SET confirmation_status = $1,
             confirmed = true,
             created_agent_ids = $2,
             failed_agents = $3,
             updated_at = now()
         WHERE id = $4`,
        [confirmationStatus, JSON.stringify(createdAgentIds), JSON.stringify(failedAgents), id]
      )

      res.json({
        team_plan: {
          id,
          confirmation_status: confirmationStatus,
          created_agent_ids: createdAgentIds,
        },
      })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })

  return router
}
