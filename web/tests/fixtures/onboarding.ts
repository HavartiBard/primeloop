/**
 * Frontend fixture builders for Prime onboarding configuration (spec 018).
 *
 * These builders produce types that match the contract:
 * - ProviderDraft, FunctionAssignment, PluginChoice, TeamPlan, LaunchReadinessResult
 * - SetupDraft, SetupDraftUpdate, TeamPlanConfirmRequest/Response
 */

import type {
  ProviderDraft,
  FunctionAssignment,
  PluginChoice,
  TeamPlan,
  TeamPlanAgent,
  LaunchReadinessResult,
  PrimeConfigDraft,
  SetupDraft,
  SetupDraftUpdate,
  TeamPlanConfirmRequest,
  TeamPlanConfirmResponse,
  PrimeOnboardingFunctionKey,
} from '../../src/types'

// ─── Provider Builders ────────────────────────────────────────────────────────

export function buildProviderDraft(
  overrides?: Partial<ProviderDraft>
): ProviderDraft {
  return {
    id: 'provider-1',
    name: 'local-ollama',
    type: 'ollama',
    base_url: 'http://localhost:11434',
    masked_credential_state: 'not_required', // Local provider doesn't need credentials
    connection_status: 'idle',
    available_models: ['qwen3-coder-next', 'llama3.1'],
    verification_error: null,
    ...overrides,
  }
}

export function buildProviderDrafts(count: number = 2): ProviderDraft[] {
  return Array.from({ length: count }, (_, i) =>
    buildProviderDraft({
      id: `provider-${i + 1}`,
      name: i === 0 ? 'local-ollama' : 'cloud-anthropic',
      type: i === 0 ? 'ollama' : 'anthropic',
      base_url: i === 0 ? 'http://localhost:11434' : 'https://api.anthropic.com',
    })
  )
}

// ─── Function Assignment Builders ─────────────────────────────────────────────

export function buildFunctionAssignment(
  overrides?: Partial<FunctionAssignment>
): FunctionAssignment {
  return {
    function_key: 'orchestration' as PrimeOnboardingFunctionKey,
    display_name: 'Orchestration',
    purpose: 'Coordinate planning, coding, and review',
    required: true,
    provider_id: null,
    model: null,
    validation_status: 'missing',
    warnings: [],
    is_default_choice: true,
    ...overrides,
  }
}

export function buildFunctionAssignments(
  assignments: Array<{ key: PrimeOnboardingFunctionKey; providerId?: string | null; model?: string | null }> = [
    { key: 'orchestration', providerId: null, model: null },
    { key: 'planning', providerId: null, model: null },
    { key: 'coding_execution', providerId: null, model: null },
    { key: 'review_validation', providerId: null, model: null },
    { key: 'platform_maintenance', providerId: null, model: null },
  ]
): FunctionAssignment[] {
  return assignments.map((a) => ({
    function_key: a.key,
    display_name: mapFunctionKeyToName(a.key),
    purpose: mapFunctionKeyToPurpose(a.key),
    required: true,
    provider_id: a.providerId ?? null,
    model: a.model ?? null,
    validation_status: a.providerId && a.model ? 'valid' : 'missing',
    warnings: [],
    is_default_choice: true,
  }))
}

function mapFunctionKeyToName(key: PrimeOnboardingFunctionKey): string {
  const names: Record<PrimeOnboardingFunctionKey, string> = {
    orchestration: 'Orchestration',
    planning: 'Planning',
    coding_execution: 'Coding & Execution',
    review_validation: 'Review & Validation',
    platform_maintenance: 'Platform Maintenance',
  }
  return names[key] ?? key
}

function mapFunctionKeyToPurpose(key: PrimeOnboardingFunctionKey): string {
  const purposes: Record<PrimeOnboardingFunctionKey, string> = {
    orchestration: 'Coordinate planning, coding, and review',
    planning: 'Break down goals and create execution plans',
    coding_execution: 'Write and execute code',
    review_validation: 'Review code and validate outputs',
    platform_maintenance: 'Maintain ACP platform infrastructure',
  }
  return purposes[key] ?? key
}

// ─── Plugin Choice Builders ───────────────────────────────────────────────────

export function buildPluginChoice(overrides?: Partial<PluginChoice>): PluginChoice {
  return {
    plugin_id: 'context-mode',
    name: 'context-mode',
    description: 'Large-output processing and searchable context support',
    availability: 'available',
    selected: false,
    configuration_state: 'deferred_post_launch',
    post_launch_configuration_required: true,
    ...overrides,
  }
}

export function buildPluginChoices(count: number = 1): PluginChoice[] {
  return Array.from({ length: count }, (_, i) =>
    buildPluginChoice({
      plugin_id: `plugin-${i + 1}`,
      name: `plugin-${i + 1}`,
      description: `Optional plugin ${i + 1}`,
    })
  )
}

// ─── Launch Readiness Result Builders ─────────────────────────────────────────

export function buildLaunchReadinessResult(
  overrides?: Partial<LaunchReadinessResult>
): LaunchReadinessResult {
  return {
    ready: false,
    blocking_reasons: [],
    ...overrides,
  }
}

export function buildLaunchReadinessReady(): LaunchReadinessResult {
  return buildLaunchReadinessResult({
    ready: true,
    blocking_reasons: [],
    summary: { providers: 2, required_functions: 5, selected_plugins: 1 },
  })
}

// ─── Team Plan Builders ───────────────────────────────────────────────────────

export function buildTeamPlanAgent(
  overrides?: Partial<TeamPlanAgent>
): TeamPlanAgent {
  return {
    role: 'sre',
    name: 'SRE Agent',
    rationale: 'Manage infrastructure and platform reliability',
    recommendation_strength: 'strongly_recommended' as const,
    category: 'platform_maintenance' as const,
    capabilities: ['infrastructure', 'monitoring', 'incident_response'],
    ...overrides,
  }
}

export function buildTeamPlan(overrides?: Partial<TeamPlan>): TeamPlan {
  return {
    id: 'team-plan-1',
    purpose: 'Initial team setup for ACP',
    confirmation_status: 'proposed',
    agents: [
      buildTeamPlanAgent({ role: 'sre', name: 'SRE Agent' }),
      buildTeamPlanAgent({ role: 'devops', name: 'DevOps Agent' }),
    ],
    created_agent_ids: [],
    ...overrides,
  }
}

// ─── Setup Draft Builders ─────────────────────────────────────────────────────

export function buildSetupDraft(overrides?: Partial<SetupDraft>): SetupDraft {
  return {
    providers: [],
    function_assignments: [],
    prime_config_draft: {
      enabled: false,
      cron_fast_interval_seconds: 300,
      debounce_window_ms: 10000,
    },
    plugin_choices: [],
    current_step: 'providers',
    status: 'not_started',
    ...overrides,
  }
}

export function buildSetupDraftUpdate(
  overrides?: Partial<SetupDraftUpdate>
): SetupDraftUpdate {
  return {
    providers: [],
    function_assignments: [],
    prime_config_draft: {},
    plugin_choices: [],
    current_step: 'providers',
    status: 'in_progress',
    ...overrides,
  }
}

// ─── Team Plan Confirmation Builders ──────────────────────────────────────────

export function buildTeamPlanConfirmRequest(
  overrides?: Partial<TeamPlanConfirmRequest>
): TeamPlanConfirmRequest {
  return {
    selected_roles: ['sre', 'devops'],
    confirm: true,
    ...overrides,
  }
}

export function buildTeamPlanConfirmResponse(
  overrides?: Partial<TeamPlanConfirmResponse>
): TeamPlanConfirmResponse {
  return {
    team_plan: buildTeamPlan({ confirmation_status: 'confirmed', created_agent_ids: ['agent-1', 'agent-2'] }),
    ...overrides,
  }
}

// ─── Default Fixture Sets ─────────────────────────────────────────────────────

export const FIXTURE_PROVIDERS: ProviderDraft[] = [
  buildProviderDraft({ id: 'prov-local', name: 'local-ollama', type: 'ollama' }),
  buildProviderDraft({ id: 'prov-cloud', name: 'cloud-anthropic', type: 'anthropic' }),
]

export const FIXTURE_ASSIGNMENTS: FunctionAssignment[] = [
  buildFunctionAssignment({ function_key: 'orchestration', provider_id: 'prov-local', model: 'qwen3-coder-next', validation_status: 'valid' }),
  buildFunctionAssignment({ function_key: 'planning', provider_id: 'prov-cloud', model: 'claude-sonnet-4-6', validation_status: 'valid' }),
  buildFunctionAssignment({ function_key: 'coding_execution', provider_id: 'prov-local', model: 'qwen3-coder-next', validation_status: 'valid' }),
  buildFunctionAssignment({ function_key: 'review_validation', provider_id: 'prov-cloud', model: 'claude-sonnet-4-6', validation_status: 'valid' }),
  buildFunctionAssignment({ function_key: 'platform_maintenance', provider_id: null, model: null, validation_status: 'missing' }),
]

export const FIXTURE_PLUGIN_CHOICES: PluginChoice[] = [
  buildPluginChoice({ plugin_id: 'context-mode', name: 'context-mode', selected: true }),
]

export const FIXTURE_TEAM_PLAN: TeamPlan = buildTeamPlan({
  agents: [
    buildTeamPlanAgent({ role: 'sre', name: 'SRE Agent' }),
    buildTeamPlanAgent({ role: 'devops', name: 'DevOps Agent' }),
  ],
})

export const FIXTURE_SETUP_DRAFT: SetupDraft = buildSetupDraft({
  providers: FIXTURE_PROVIDERS,
  function_assignments: FIXTURE_ASSIGNMENTS,
  plugin_choices: FIXTURE_PLUGIN_CHOICES,
  current_step: 'function_assignment',
  status: 'ready_to_launch',
})
