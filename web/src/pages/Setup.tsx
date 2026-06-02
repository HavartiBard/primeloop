import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Box } from 'lucide-react'
import {
  createProvider,
  fetchModelCapability,
  fetchProviders,
  fetchSetupProviderModels,
  getApiOrigin,
  pollCodexDeviceAuth,
  readResponseBody,
  startCodexDeviceAuth,
} from '../api'
import type { ModelCapabilityAssessment } from '../types'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProviderDraft {
  id?: string
  name: string
  type: string
  base_url: string
  api_key?: string
  model?: string
  modelOptions?: string[]
  connectStatus?: 'idle' | 'connecting' | 'connected' | 'error'
  connectError?: string
  authStatus?: 'idle' | 'starting' | 'waiting' | 'complete' | 'error'
  authError?: string
  authUrl?: string
  authCode?: string | null
  active: boolean
}

interface RoutingEntry {
  provider_name: string
  model: string
}

interface RoutingDraft {
  planning: RoutingEntry[]
  dispatching: RoutingEntry[]
  discussion: RoutingEntry[]
}

export interface ProfileSectionSet {
  identity: string
  voice_tone: string
  decision_style: string
  default_behaviors: string
  approval_thresholds: string
}

export interface ProfileDraft {
  name: string
  view_mode: 'sections' | 'markdown'
  soul: { identity: string; voice_tone: string; decision_style: string }
  operating: { default_behaviors: string; approval_thresholds: string }
  shipped_defaults: ProfileSectionSet
}

const DEFAULT_IDENTITY = `Prime is the central orchestrating agent for this control plane. It coordinates specialist agents, routes incoming work, monitors queue health, and surfaces blockers to operators.

Prime does not execute implementation work directly — it delegates to the right agent for the task, tracks outcomes, and escalates when a delegation stalls or fails. Its primary loyalty is to throughput and operator visibility, not to completing tasks itself.`

const DEFAULT_VOICE_TONE = `Communicate directly and precisely. Lead with the key fact; follow with context only when it changes the decision. Prefer one clear sentence over a hedged paragraph.

When reporting status, say what is happening and what is needed. When asking for approval, explain the risk and the alternative. Do not over-explain to operators who are already familiar with the system — save detail for genuinely novel situations.`

const DEFAULT_DECISION_STYLE = `Favor reversible paths. When two approaches are equally valid, choose the one that can be undone. Avoid destructive or external-facing actions without explicit approval.

Escalate ambiguous situations rather than guessing intent. If blocked, surface the blocker immediately rather than waiting or retrying indefinitely. Prefer momentum — a clear handoff to a human is better than a silent stall.

When evaluating delegation targets, match capability to task. Do not assign complex reasoning to small models or route creative work to execution-only agents.`

const DEFAULT_BEHAVIORS = `- Poll the work queue on the fast cron interval and dispatch eligible items to capable agents
- Monitor agent heartbeats; flag any agent that has not checked in within its expected window
- Requeue stalled delegations when the assigned agent has gone silent past the timeout threshold
- Keep a running summary of active delegations visible in the operator thread
- Notify the operator when a sprint goal is completed or a delegation chain fails
- Consolidate short bursts of incoming work within the debounce window before dispatching
- Prefer assigning work to already-warm agents over spinning up new ones unnecessarily`

const DEFAULT_APPROVAL_THRESHOLDS = `Require explicit human approval before:
- Force-pushing to main or any protected branch
- Deleting database records, files, or branches outside the designated workspace
- Sending external communications (Slack messages, emails, GitHub comments, PR descriptions)
- Spending beyond the configured monthly token budget
- Creating or destroying infrastructure resources
- Spawning more than 3 new agents in a single decision cycle
- Taking any action flagged as irreversible by the executing agent`

export const INITIAL_PROFILE_STATE: ProfileDraft = {
  name: 'Prime',
  view_mode: 'sections',
  soul: {
    identity:       DEFAULT_IDENTITY,
    voice_tone:     DEFAULT_VOICE_TONE,
    decision_style: DEFAULT_DECISION_STYLE,
  },
  operating: {
    default_behaviors:   DEFAULT_BEHAVIORS,
    approval_thresholds: DEFAULT_APPROVAL_THRESHOLDS,
  },
  shipped_defaults: {
    identity:            DEFAULT_IDENTITY,
    voice_tone:          DEFAULT_VOICE_TONE,
    decision_style:      DEFAULT_DECISION_STYLE,
    default_behaviors:   DEFAULT_BEHAVIORS,
    approval_thresholds: DEFAULT_APPROVAL_THRESHOLDS,
  },
}

interface RulesDraft {
  presets: string[]
  custom: string
}

interface WorkspaceDraft {
  mode: 'local' | 'git'
  root_path: string
  remote_url: string
  branch: string
}

export interface ProviderDisplay extends ProviderDraft {
  masked_credential_state?: 'absent' | 'present' | 'needs_replacement' | 'not_required'
  connection_status?: 'idle' | 'verifying' | 'verified' | 'failed' | 'skipped' | 'unavailable'
  available_models?: string[]
  verification_error?: string
}

export interface WizardState {
  providers: ProviderDraft[]
  routing: RoutingDraft
  functionAssignments?: import('../types').FunctionAssignment[]
  profile: ProfileDraft
  rules: RulesDraft
  costControls: { monthlyTokenBudget: number }
  workspace: WorkspaceDraft
  pluginChoices?: Array<{
    plugin_id: string
    name: string
    description: string
    selected: boolean
    configuration_state: 'not_required' | 'deferred_post_launch' | 'configured' | 'unavailable'
  }>
  primeConfig?: {
    cron_fast_interval_seconds?: number
    cron_slow_interval_seconds?: number
    debounce_window_ms?: number
  }
  primeConfigDraft?: {
    enabled?: boolean
    cron_fast_interval_seconds?: number
    cron_slow_interval_seconds?: number
    debounce_window_ms?: number
  }
}

const INITIAL_STATE: WizardState = {
  providers: [
    { name: 'anthropic-main', type: 'anthropic', base_url: 'https://api.anthropic.com', model: 'claude-sonnet-4-6', active: false },
    { name: 'openai-main', type: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o', active: false },
    { name: 'local-main', type: 'ollama', base_url: 'http://localhost:11434', model: '', active: true },
  ],
  routing: { planning: [], dispatching: [], discussion: [] },
  profile:   INITIAL_PROFILE_STATE,
  rules: { presets: [], custom: '' },
  costControls: { monthlyTokenBudget: 0 },
  workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' },
  pluginChoices: [],
}

const STEPS = ['Intro', 'Providers', 'Routing', 'Personality', 'Rules', 'Workspace', 'Plugins', 'Launch'] as const
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

// ─── CSS helpers ─────────────────────────────────────────────────────────────

export const INPUT_CLS =
  'w-full rounded border border-[rgba(148,163,184,0.28)] bg-[#0f1b2d] px-3 py-2 text-sm font-medium text-[#ffffff] placeholder:text-[#b8c7de] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] focus:outline-none focus:border-[#6ee7ff] focus:bg-[#15243a]'
export const LABEL_CLS = 'block text-xs text-[var(--muted)] mb-1'
export const BTN_PRIMARY =
  'px-4 py-2 text-sm font-medium rounded border border-[#6ee7ff] bg-[#1f6feb] text-white hover:bg-[#2b7fff] disabled:opacity-40 disabled:cursor-not-allowed transition'
export const BTN_SECONDARY =
  'px-4 py-2 text-sm rounded border border-[rgba(148,163,184,0.24)] bg-[rgba(30,41,59,0.96)] text-[#f8fbff] hover:bg-[rgba(51,65,85,0.98)] transition'

// ─── Preset rules (shared between StepRules and StepLaunch) ──────────────────

export const PRESET_RULES = [
  { key: 'test_before_delegate', label: 'Always run tests before delegating work to agents' },
  { key: 'no_force_push', label: 'Never force-push to main or protected branches' },
  { key: 'small_prs', label: 'Prefer small, reviewable pull requests over large ones' },
  { key: 'confirm_destructive', label: 'Ask before taking destructive or irreversible actions' },
  { key: 'humans_in_loop', label: 'Keep humans in the loop on external communications' },
]

// ─── validateAssignments ─────────────────────────────────────────────────────

export function validateAssignments(assignments: import('../types').FunctionAssignment[]): {
  readiness: { ready: boolean; warnings: string[]; blocking_reasons: string[] }
} {
  const warnings: string[] = []
  const blocking_reasons: string[] = []

  const seenModels = new Map<string, number>()
  for (const a of assignments) {
    if (!a.provider_id || !a.model) continue
    const key = `${a.provider_id}/${a.model}`
    seenModels.set(key, (seenModels.get(key) ?? 0) + 1)
  }
  for (const [key, count] of seenModels) {
    if (count > 1) warnings.push(`Reuses this provider/model ${key} across ${count} functions`)
  }

  for (const a of assignments) {
    if (!a.model) continue
    const lc = a.model.toLowerCase()
    if (lc.includes('tiny') || lc.includes('1b') || lc.includes('2b') || lc.includes('3b')) {
      blocking_reasons.push(`${a.display_name}: model ${a.model} is blocked (too small, minimum recommended 7B)`)
    } else if (lc.includes('phi') || lc.includes('7b') || lc.includes('mini')) {
      warnings.push(`${a.display_name}: model ${a.model} is below recommended 7B quality tier`)
    }
  }

  return { readiness: { ready: blocking_reasons.length === 0, warnings, blocking_reasons } }
}

// ─── StepPrimeFunctionAssignments ────────────────────────────────────────────

export function StepPrimeFunctionAssignments({
  state,
  onChange,
}: {
  state: WizardState & { functionAssignments: import('../types').FunctionAssignment[] }
  onChange: (next: typeof state) => void
}) {
  const assignments = state.functionAssignments ?? []
  const providers = state.providers.filter((p) => p.active)

  const updateAssignment = (idx: number, field: 'provider_id' | 'model', value: string) => {
    const updated = assignments.map((a, i) => i === idx ? { ...a, [field]: value || null } : a)
    onChange({ ...state, functionAssignments: updated })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">Assign a provider and model to each Prime function.</p>
      {assignments.map((a, idx) => (
        <div key={a.function_key} className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3 space-y-2">
          <div className="text-xs font-medium text-[var(--text)]">{a.display_name}</div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className={LABEL_CLS} htmlFor={`assign-provider-${idx}`}>{a.display_name} provider</label>
              <select
                id={`assign-provider-${idx}`}
                aria-label={`${a.display_name} provider`}
                value={a.provider_id ?? ''}
                onChange={(e) => updateAssignment(idx, 'provider_id', e.target.value)}
                className={INPUT_CLS}
              >
                <option value="">— select provider —</option>
                {providers.map((p) => (
                  <option key={p.name} value={p.id ?? p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className={LABEL_CLS} htmlFor={`assign-model-${idx}`}>{a.display_name} model</label>
              <input
                id={`assign-model-${idx}`}
                aria-label={`${a.display_name} model`}
                value={a.model ?? ''}
                onChange={(e) => updateAssignment(idx, 'model', e.target.value)}
                className={INPUT_CLS}
                placeholder="e.g. claude-sonnet-4-6"
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── StepPrimeConfigReview ───────────────────────────────────────────────────

export function StepPrimeConfigReview({
  state,
  onChange,
}: {
  state: WizardState
  onChange: (next: WizardState) => void
}) {
  const cfg = state.primeConfigDraft ?? state.primeConfig ?? {}
  const fieldErrors: string[] = []

  const fastVal = cfg.cron_fast_interval_seconds ?? 300
  const slowVal = cfg.cron_slow_interval_seconds ?? 3600
  const debounceVal = cfg.debounce_window_ms ?? 10000
  const budgetVal = state.costControls.monthlyTokenBudget

  if (typeof fastVal === 'number' && !Number.isInteger(fastVal) || fastVal < 0)
    fieldErrors.push('cron_fast_interval_seconds must be a positive integer')
  if (typeof debounceVal === 'number' && debounceVal < 0)
    fieldErrors.push('debounce_window_ms must be non-negative')
  if (budgetVal < 0)
    fieldErrors.push('monthly_token_budget must be non-negative')

  const update = (field: keyof NonNullable<WizardState['primeConfigDraft']>, value: number) =>
    onChange({ ...state, primeConfigDraft: { ...cfg, [field]: value } })

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">Review Prime's operational configuration before launch.</p>
      <div>
        <label className={LABEL_CLS}>Fast cron interval (seconds)</label>
        <input
          type="number"
          value={fastVal}
          onChange={(e) => update('cron_fast_interval_seconds', Number(e.target.value))}
          className={INPUT_CLS}
          aria-label="Fast cron interval (seconds)"
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Slow cron interval (seconds)</label>
        <input
          type="number"
          value={slowVal}
          onChange={(e) => update('cron_slow_interval_seconds', Number(e.target.value))}
          className={INPUT_CLS}
          aria-label="Slow cron interval (seconds)"
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Debounce window (ms)</label>
        <input
          type="number"
          value={debounceVal}
          onChange={(e) => update('debounce_window_ms', Number(e.target.value))}
          className={INPUT_CLS}
          aria-label="Debounce window (ms)"
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Monthly token budget</label>
        <input
          type="number"
          value={budgetVal}
          onChange={(e) => onChange({ ...state, costControls: { monthlyTokenBudget: Number(e.target.value) } })}
          className={INPUT_CLS}
          placeholder="0 (unlimited)"
          aria-label="Monthly token budget"
        />
      </div>
      {fieldErrors.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-400">Configuration validation errors</p>
          {fieldErrors.map((e) => (
            <p key={e} className="text-xs text-red-400">{e}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function stepProgress(state: WizardState, step: Step): number {
  if (step === 0) {
    return 0
  }

  if (step === 1) {
    const activeProviders = state.providers.filter((provider) => provider.active)
    if (activeProviders.length === 0) return 0
    const providerScores = activeProviders.map((provider) => {
      let score = 0.2
      if (provider.type === 'anthropic') {
        if (provider.api_key?.trim()) score += 0.4
        if (provider.model?.trim()) score += 0.4
      } else if (provider.type === 'openai') {
        if (provider.authStatus === 'complete') score += 0.45
        else if (provider.api_key?.trim()) score += 0.35
        if (provider.model?.trim()) score += 0.2
        if (provider.connectStatus === 'connected') score += 0.15
      } else {
        if (provider.base_url?.trim()) score += 0.35
        if (provider.connectStatus === 'connected') score += 0.3
        if (provider.model?.trim()) score += 0.35
      }
      return clamp01(score)
    })
    return clamp01(providerScores.reduce((sum, score) => sum + score, 0) / activeProviders.length)
  }

  if (step === 2) {
    let score = 0
    const routeKeys: Array<keyof RoutingDraft> = ['planning', 'dispatching', 'discussion']
    for (const key of routeKeys) {
      const entries = state.routing[key]
      if (entries.length > 0) score += 0.2
      if (entries.some((entry) => entry.provider_name.trim())) score += 0.1
      if (entries.some((entry) => entry.model.trim())) score += 0.1
    }
    if (state.costControls.monthlyTokenBudget > 0) score += 0.1
    return clamp01(score)
  }

  if (step === 3) {
    let score = 0
    if (state.profile.name.trim()) score += 0.2
    const profileSections: (keyof ProfileSectionSet)[] = ['identity', 'voice_tone', 'decision_style', 'default_behaviors', 'approval_thresholds']
    for (const key of profileSections) {
      const val = SOUL_SECTION_KEYS.includes(key)
        ? (state.profile.soul as Record<string, string>)[key]
        : (state.profile.operating as Record<string, string>)[key]
      if (val?.trim()) score += 0.16
    }
    return clamp01(score)
  }

  if (step === 4) {
    let score = 0
    score += Math.min(0.7, state.rules.presets.length * 0.18)
    if (state.rules.custom.trim()) {
      score += Math.min(0.3, state.rules.custom.trim().length / 180)
    }
    return clamp01(score)
  }

  if (step === 5) {
    let score = 0.2
    if (state.workspace.root_path.trim()) score += 0.45
    if (state.workspace.mode === 'git') {
      if (state.workspace.remote_url.trim()) score += 0.2
      if (state.workspace.branch.trim()) score += 0.15
    } else {
      score += 0.15
    }
    return clamp01(score)
  }

  if (step === 6) {
    // Plugins step - progress based on whether plugins have been selected or skipped
    const hasPluginChoices = ( state.pluginChoices ?? []).length > 0
    return hasPluginChoices ? 1 : 0.5
  }

  const activeProviders = state.providers.filter((provider) => provider.active)
  let score = 0.15
  if (activeProviders.length > 0) score += 0.25
  if (Object.values(state.routing).some((entries) => entries.length > 0)) score += 0.2
  if (state.profile.soul.identity.trim()) score += 0.2
  if (state.rules.presets.length > 0 || state.rules.custom.trim()) score += 0.2
  return clamp01(score)
}

/** Returns a short blocking reason for the current step, or null if OK to advance. */
function getStepBlocker(state: WizardState, step: Step): string | null {
  if (step === 1) {
    if (!state.providers.some((p) => p.active)) return 'Add at least one provider to continue'
    const active = state.providers.filter((p) => p.active)
    const incomplete = active.filter((p) => !p.model?.trim())
    if (incomplete.length > 0) return `Select a model for: ${incomplete.map((p) => p.name).join(', ')}`
  }
  if (step === 2) {
    const missing = (['planning', 'dispatching', 'discussion'] as const).filter(
      (key) => !state.routing[key].some((e) => e.provider_name.trim() && e.model.trim())
    )
    if (missing.length > 0) return `Configure routing for: ${missing.join(', ')}`
  }
  if (step === 3) {
    if (!state.profile.name.trim()) return 'Enter a name for the agent'
    if (!state.profile.soul.identity.trim()) return 'Fill in the Identity section'
  }
  if (step === 4) {
    if (state.rules.presets.length === 0 && !state.rules.custom.trim())
      return 'Select at least one standing rule, or enter a custom rule'
  }
  return null
}

/** Returns issues per section for the launch review screen. */
function getLaunchIssues(state: WizardState): Record<string, string> {
  const issues: Record<string, string> = {}
  if (!state.providers.some((p) => p.active)) {
    issues.providers = 'No active providers'
  } else {
    const missing = state.providers.filter((p) => p.active && !p.model?.trim())
    if (missing.length > 0) issues.providers = `Missing model: ${missing.map((p) => p.name).join(', ')}`
  }
  const missingRoutes = (['planning', 'dispatching', 'discussion'] as const).filter(
    (key) => !state.routing[key].some((e) => e.provider_name.trim() && e.model.trim())
  )
  if (missingRoutes.length > 0) issues.routing = `Not configured: ${missingRoutes.join(', ')}`
  if (!state.profile.name.trim()) issues.personality = 'Agent name is required'
  else if (!state.profile.soul.identity.trim()) issues.personality = 'Identity section is empty'
  if (state.rules.presets.length === 0 && !state.rules.custom.trim()) issues.rules = 'No rules configured'
  return issues
}

const SOUL_SECTION_KEYS: (keyof ProfileSectionSet)[] = ['identity', 'voice_tone', 'decision_style']

function ProviderLogo({ draft }: { draft: ProviderDraft }) {
  const active = draft.active
  const isAnthropic = draft.name === 'anthropic-main'
  const isOpenAI = draft.name === 'openai-main'
  const activeCls =
    isAnthropic
      ? 'border-[#d4a5ff] bg-[rgba(155,92,255,0.22)] text-[#f5deff]'
      : isOpenAI
      ? 'border-[#6ee7ff] bg-[rgba(31,111,235,0.26)] text-[#eaf6ff]'
      : 'border-[#7ef0c8] bg-[rgba(16,185,129,0.20)] text-[#e9fff7]'
  const inactiveCls = 'border-[rgba(148,163,184,0.24)] bg-[rgba(15,23,42,0.72)] text-[#6f819d]'

  return (
    <div className={`flex h-11 w-11 items-center justify-center rounded-xl border transition ${active ? activeCls : inactiveCls}`}>
      {isAnthropic ? (
        <img
          src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/anthropic-dark.svg"
          alt="Anthropic"
          className={`h-6 w-6 object-contain transition ${active ? 'grayscale-0 opacity-100' : 'grayscale opacity-60'}`}
        />
      ) : isOpenAI ? (
        <img
          src="https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/openai.svg"
          alt="OpenAI"
          className={`h-6 w-6 object-contain transition ${active ? 'grayscale-0 opacity-100' : 'grayscale opacity-60'}`}
        />
      ) : (
        <Box className="h-5 w-5" strokeWidth={2} />
      )}
    </div>
  )
}

// ─── Step components ────────────────────────────────────────────────────────

function ProviderCard({ draft, onChange, onToggle, onConnect, onDeviceAuth }: {
  draft: ProviderDraft
  onChange: (p: Partial<ProviderDraft>) => void
  onToggle: () => void
  onConnect: () => void
  onDeviceAuth: () => void
}) {
  const [openAiAuthMode, setOpenAiAuthMode] = useState<'api' | 'subscription'>('api')
  const isLocalProvider = draft.name === 'local-main'
  const label =
    draft.name === 'anthropic-main' ? 'Anthropic'
    : draft.name === 'openai-main' ? 'OpenAI'
    : 'Local'
  const description =
    draft.name === 'anthropic-main' ? 'Direct Anthropic API key and model selection.'
    : draft.name === 'openai-main' ? 'OpenAI API key or ChatGPT device login.'
    : 'Connect to Ollama or an OpenAI-compatible local endpoint.'
  const hasModelOptions = (draft.modelOptions?.length ?? 0) > 0
  const showLocalModelControl =
    !isLocalProvider || draft.type !== 'ollama' && draft.type !== 'litellm'
      ? true
      : draft.connectStatus === 'connected' || Boolean(draft.model?.trim())
  const modelControl = (placeholder: string) => (
    <div>
      <label className={LABEL_CLS}>Model</label>
      {hasModelOptions ? (
        <select
          value={draft.model || ''}
          onChange={(e) => onChange({ model: e.target.value })}
          className={INPUT_CLS}
        >
          {draft.modelOptions!.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
      ) : (
        <input
          value={draft.model || ''}
          onChange={(e) => onChange({ model: e.target.value })}
          placeholder={placeholder}
          className={INPUT_CLS}
        />
      )}
    </div>
  )
  const canDiscover = draft.type === 'ollama' || draft.type === 'litellm' || Boolean(draft.api_key?.trim())

  return (
    <div className={`rounded-lg border transition ${draft.active ? 'border-[var(--sel-bd)] bg-[var(--panel)]' : 'border-[var(--border-soft)] bg-[var(--panel-subtle)]'}`}>
      <div className="flex items-start justify-between gap-4 p-4">
        <button type="button" onClick={onToggle} className="flex flex-1 items-start gap-3 text-left cursor-pointer">
          <ProviderLogo draft={draft} />
          <div>
            <div className="text-sm font-medium text-[var(--text)]">{label}</div>
            <div className="mt-1 text-xs text-[var(--muted)]">{description}</div>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {draft.connectStatus === 'connected' && (
            <span className="rounded border border-[var(--s-ok-bd)] bg-[var(--s-ok-bg)] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--s-ok-tx)]">
              Connected
            </span>
          )}
          {!draft.connectStatus && (draft as ProviderDisplay).connection_status === 'verified' && (
            <span className="rounded border border-[var(--s-ok-bd)] bg-[var(--s-ok-bg)] px-2 py-0.5 text-[10px] text-[var(--s-ok-tx)]">Verified</span>
          )}
          {!draft.connectStatus && (draft as ProviderDisplay).connection_status === 'verifying' && (
            <span className="rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-0.5 text-[10px] text-[var(--muted)]">Verifying</span>
          )}
          {!draft.connectStatus && (draft as ProviderDisplay).connection_status === 'failed' && (
            <span className="rounded border border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)] px-2 py-0.5 text-[10px] text-[var(--s-blk-tx)]">Failed</span>
          )}
          {!draft.connectStatus && (draft as ProviderDisplay).connection_status === 'skipped' && (
            <span className="rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-0.5 text-[10px] text-[var(--muted)]">Skipped</span>
          )}
          {!draft.connectStatus && (draft as ProviderDisplay).connection_status === 'unavailable' && (
            <span className="rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-0.5 text-[10px] text-[var(--muted)]">Unavailable</span>
          )}
          {(draft as ProviderDisplay).masked_credential_state === 'present' && (
            <span className="text-[10px] text-[var(--muted)]">Credentials configured</span>
          )}
          {(draft as ProviderDisplay).masked_credential_state === 'not_required' && (
            <span className="text-[10px] text-[var(--muted)]">No credentials required</span>
          )}
          {(draft as ProviderDisplay).available_models?.length && (
            <span className="text-[10px] text-[var(--muted)]">{(draft as ProviderDisplay).available_models!.length} models found</span>
          )}
          {!draft.connectStatus && (draft as ProviderDisplay).connection_status === 'failed' && (draft as ProviderDisplay).verification_error && (
            <span className="text-[10px] text-[var(--s-blk-tx)]">{(draft as ProviderDisplay).verification_error}</span>
          )}
          {draft.authStatus === 'complete' && (
            <span className="rounded border border-[var(--s-ok-bd)] bg-[var(--s-ok-bg)] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--s-ok-tx)]">
              Authed
            </span>
          )}
          <span className="rounded border border-[var(--border-soft)] px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-[var(--muted)]">
            {draft.type}
          </span>
        </div>
      </div>
      {draft.active && (
      <div className="space-y-3 border-t border-[var(--border-soft)] p-4">
        {!draft.connectStatus && (draft as ProviderDisplay).connection_status === 'verifying' && (
          <div className="text-xs text-[var(--muted)]">Discovering models…</div>
        )}
        {!draft.connectStatus && (draft as ProviderDisplay).connection_status === 'failed' && (
          <div className="space-y-2">
            {(draft as ProviderDisplay).verification_error && (
              <p className="text-xs text-[var(--s-blk-tx)]">{(draft as ProviderDisplay).verification_error}</p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => onConnect()} className={BTN_PRIMARY} style={{ padding: '4px 10px', fontSize: '11px' }}>Retry</button>
              <button type="button" onClick={() => onChange({ connectStatus: undefined })} className={BTN_SECONDARY} style={{ padding: '4px 10px', fontSize: '11px' }}>Skip</button>
            </div>
          </div>
        )}
        {draft.type === 'anthropic' && (
          <>
            <div>
              <label className={LABEL_CLS}>API Key</label>
              <input
                type="password"
                value={draft.api_key || ''}
                onChange={(e) => onChange({ api_key: e.target.value })}
                placeholder="sk-ant-..."
                className={INPUT_CLS}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              {modelControl('claude-sonnet-4-6')}
              <button
                type="button"
                onClick={onConnect}
                disabled={!canDiscover || draft.connectStatus === 'connecting'}
                className="px-3 py-2 text-xs rounded border border-[#6ee7ff] bg-[#1f6feb] text-white hover:bg-[#2b7fff] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {draft.connectStatus === 'connecting' ? 'Connecting...' : 'Connect'}
              </button>
            </div>
          </>
        )}
        {draft.type === 'openai' && (
          <>
            <div>
              <label className={LABEL_CLS}>Auth Flow</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpenAiAuthMode('api')}
                  className={`px-3 py-1.5 text-xs rounded border transition ${
                    openAiAuthMode === 'api'
                      ? 'border-[#6ee7ff] bg-[#1f6feb] text-white'
                      : 'border-[rgba(148,163,184,0.28)] bg-[#1f2937] text-[#e2e8f0] hover:bg-[#334155] hover:text-white'
                  }`}
                >
                  API
                </button>
                <button
                  type="button"
                  onClick={() => setOpenAiAuthMode('subscription')}
                  className={`px-3 py-1.5 text-xs rounded border transition ${
                    openAiAuthMode === 'subscription'
                      ? 'border-[#6ee7ff] bg-[#1f6feb] text-white'
                      : 'border-[rgba(148,163,184,0.28)] bg-[#1f2937] text-[#e2e8f0] hover:bg-[#334155] hover:text-white'
                  }`}
                >
                  Subscription
                </button>
              </div>
            </div>
            {openAiAuthMode === 'api' && (
              <>
                <div>
                  <label className={LABEL_CLS}>API Key</label>
                  <input
                    type="password"
                    value={draft.api_key || ''}
                    onChange={(e) => onChange({ api_key: e.target.value })}
                    placeholder="sk-..."
                    className={INPUT_CLS}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  {modelControl('gpt-4o')}
                  <button
                    type="button"
                    onClick={onConnect}
                    disabled={!canDiscover || draft.connectStatus === 'connecting'}
                    className="px-3 py-2 text-xs rounded border border-[#6ee7ff] bg-[#1f6feb] text-white hover:bg-[#2b7fff] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {draft.connectStatus === 'connecting' ? 'Connecting...' : 'Connect'}
                  </button>
                </div>
              </>
            )}
            {openAiAuthMode === 'subscription' && (
              <>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  {modelControl('gpt-4o')}
                  <button
                    type="button"
                    onClick={onDeviceAuth}
                    disabled={draft.authStatus === 'starting' || draft.authStatus === 'waiting'}
                    className="px-3 py-2 text-xs rounded border border-[rgba(148,163,184,0.28)] bg-[#1f2937] text-[#f8fbff] hover:bg-[#334155] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {draft.authStatus === 'waiting' ? 'Waiting...' : draft.authStatus === 'complete' ? 'Re-auth' : 'Login'}
                  </button>
                </div>
                {draft.authStatus === 'complete' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={onConnect}
                      disabled={draft.connectStatus === 'connecting'}
                      className="px-3 py-2 text-xs rounded border border-[#6ee7ff] bg-[#1f6feb] text-white hover:bg-[#2b7fff] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {draft.connectStatus === 'connecting' ? 'Loading...' : 'Connect & load models'}
                    </button>
                    {draft.connectStatus === 'connected' && (
                      <span className="text-xs text-[var(--s-ok-tx)]">{draft.modelOptions?.length ?? 0} models found</span>
                    )}
                    {draft.connectStatus === 'error' && (
                      <span className="text-xs text-[var(--s-blk-tx)]">{draft.connectError}</span>
                    )}
                  </div>
                )}
                <p className="text-xs text-[var(--muted)]">
                  This flow still depends on the ACP backend routes behind `/api/providers/*/codex/auth`. On the Vite-only dev server it can stall or time out unless the backend is also running.
                </p>
              </>
            )}
            {draft.authUrl && (
              <div className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 text-xs">
                <div className="text-[var(--muted)] mb-1">Open this URL</div>
                <div className="font-mono text-[var(--text)] break-all">{draft.authUrl}</div>
                {draft.authCode && <div className="mt-2 font-mono text-lg tracking-widest text-[var(--s-att-tx)]">{draft.authCode}</div>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(draft.authUrl ?? '')}
                    className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline"
                  >
                    Copy URL
                  </button>
                  {draft.authCode && (
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(draft.authCode ?? '')}
                      className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline"
                    >
                      Copy code
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => window.open(draft.authUrl, '_blank')}
                    className="text-xs text-[var(--accent)] hover:underline"
                  >
                    Open in browser
                  </button>
                </div>
              </div>
            )}
            {draft.authStatus === 'complete' && <p className="text-xs text-[var(--s-ok-tx)]">OpenAI subscription login complete</p>}
            {draft.authStatus === 'error' && <p className="text-xs text-[var(--s-blk-tx)]">{draft.authError}</p>}
          </>
        )}
        {(draft.type === 'ollama' || draft.type === 'litellm') && (
          <>
            {isLocalProvider && (
              <div>
                <label className={LABEL_CLS}>Endpoint Type</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onChange({
                      type: 'ollama',
                      base_url: draft.type === 'ollama' ? draft.base_url : 'http://localhost:11434',
                      modelOptions: [],
                      connectStatus: 'idle',
                      connectError: undefined,
                    })}
                    className={`px-3 py-1.5 text-xs rounded border transition ${
                      draft.type === 'ollama'
                        ? 'border-[#6ee7ff] bg-[#1f6feb] text-white'
                        : 'border-[rgba(148,163,184,0.28)] bg-[#1f2937] text-[#e2e8f0] hover:bg-[#334155] hover:text-white'
                    }`}
                  >
                    Ollama
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange({
                      type: 'litellm',
                      base_url: draft.type === 'litellm' ? draft.base_url : 'http://localhost:4000/v1',
                      modelOptions: [],
                      connectStatus: 'idle',
                      connectError: undefined,
                    })}
                    className={`px-3 py-1.5 text-xs rounded border transition ${
                      draft.type === 'litellm'
                        ? 'border-[#6ee7ff] bg-[#1f6feb] text-white'
                        : 'border-[rgba(148,163,184,0.28)] bg-[#1f2937] text-[#e2e8f0] hover:bg-[#334155] hover:text-white'
                    }`}
                  >
                    OpenAI-compatible
                  </button>
                </div>
              </div>
            )}
            <div>
              <label className={LABEL_CLS}>Base URL</label>
              <input
                value={draft.base_url}
                onChange={(e) => onChange({ base_url: e.target.value })}
                placeholder={draft.type === 'ollama' ? 'http://localhost:11434' : 'http://localhost:4000/v1'}
                className={INPUT_CLS}
              />
              <p className="mt-1 text-xs text-[var(--muted)]">
                {draft.type === 'ollama'
                  ? 'Use the Ollama server root. ACP will query /api/tags when you connect.'
                  : 'For GoudAI or any OpenAI-compatible local server, use the API base URL ending in /v1. ACP will query /models when you connect.'}
              </p>
            </div>
            {draft.type === 'litellm' && (
              <div>
                <label className={LABEL_CLS}>API Key</label>
                <input
                  type="password"
                  value={draft.api_key || ''}
                  onChange={(e) => onChange({ api_key: e.target.value })}
                  placeholder="optional"
                  className={INPUT_CLS}
                />
              </div>
            )}
            {showLocalModelControl && modelControl(draft.type === 'ollama' ? 'llama3.2:latest' : 'provider/model')}
          </>
        )}
        {(draft.type === 'ollama' || draft.type === 'litellm') && (
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onConnect}
              disabled={!canDiscover || draft.connectStatus === 'connecting'}
              className="px-3 py-2 text-xs rounded border border-[#6ee7ff] bg-[#1f6feb] text-white hover:bg-[#2b7fff] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {draft.connectStatus === 'connecting' ? 'Connecting...' : 'Connect & load models'}
            </button>
            {draft.connectStatus === 'connected' && (
              <span className="text-xs text-[var(--s-ok-tx)]">{draft.modelOptions?.length ?? 0} models found</span>
            )}
            {draft.connectStatus === 'error' && (
              <span className="text-xs text-[var(--s-blk-tx)]">{draft.connectError}</span>
            )}
            {!showLocalModelControl && (
              <span className="text-xs text-[var(--muted)]">Connect first to load available models.</span>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  )
}

export function StepProviders({ state, onChange }: { state: WizardState; onChange: Dispatch<SetStateAction<WizardState>> }) {
  const pollRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => () => stopPolling(), [])

  const updateProvider = (name: string, patch: Partial<ProviderDraft>) => {
    onChange((current) => ({
      ...current,
      providers: current.providers.map((p) => (p.name === name ? { ...p, ...patch } : p)),
    }))
  }
  const connectProvider = async (name: string) => {
    const provider = state.providers.find((p) => p.name === name)
    if (!provider) return
    updateProvider(name, { connectStatus: 'connecting', connectError: undefined })
    try {
      const result = await fetchSetupProviderModels({
        type: provider.type,
        base_url: provider.base_url,
        api_key: provider.api_key,
      })
      if (result.error || result.models.length === 0) {
        updateProvider(name, {
          connectStatus: 'error',
          connectError: result.error ?? 'No models found',
          modelOptions: [],
        })
        return
      }
      updateProvider(name, {
        active: true,
        connectStatus: 'connected',
        modelOptions: result.models,
        model: provider.model || result.models[0],
      })
    } catch (err) {
      updateProvider(name, {
        connectStatus: 'error',
        connectError: err instanceof Error ? err.message : 'Connection failed',
      })
    }
  }
  const startDeviceAuth = async (name: string) => {
    const provider = state.providers.find((p) => p.name === name)
    if (!provider) return
    stopPolling()
    updateProvider(name, { authStatus: 'starting', authError: undefined, authUrl: undefined, authCode: undefined })
    try {
      let providerId = provider.id
      if (!providerId) {
        try {
          const created = await createProvider({
            name: provider.name,
            type: provider.type,
            base_url: provider.base_url,
            ...(provider.model ? { model: provider.model } : {}),
            ...(provider.api_key ? { api_key: provider.api_key } : {}),
            timeout_ms: 120000,
          })
          providerId = created.id
          updateProvider(name, { id: created.id })
        } catch (err) {
          if (!(err instanceof Error) || !err.message.includes('provider name already exists')) {
            throw err
          }
          const existingProviders = await fetchProviders()
          const existing = existingProviders.find((p) => p.name === provider.name)
          if (!existing) throw err
          providerId = existing.id
          updateProvider(name, { id: existing.id })
        }
      }
      if (!providerId) throw new Error('Provider id missing after creation')
      const authProviderId = providerId
      const result = await startCodexDeviceAuth(authProviderId)
      if (result.already_authenticated || !result.url) {
        stopPolling()
        updateProvider(name, {
          id: authProviderId,
          active: true,
          authStatus: 'complete',
          authUrl: undefined,
          authCode: undefined,
        })
        return
      }
      updateProvider(name, {
        id: authProviderId,
        active: true,
        authStatus: 'waiting',
        authUrl: result.url,
        authCode: result.code,
      })

      const poll = async () => {
        try {
          const status = await pollCodexDeviceAuth(authProviderId, result.session_id)
          if (status.status === 'complete') {
            stopPolling()
            updateProvider(name, { authStatus: 'complete', active: true })
          } else if (status.status === 'error') {
            stopPolling()
            updateProvider(name, { authStatus: 'error', authError: status.error ?? 'Auth failed' })
          } else {
            pollRef.current = window.setTimeout(poll, 2_000)
          }
        } catch (err) {
          stopPolling()
          updateProvider(name, {
            authStatus: 'error',
            authError: err instanceof Error ? err.message : 'Auth status check failed',
          })
        }
      }
      pollRef.current = window.setTimeout(poll, 2_000)
    } catch (err) {
      updateProvider(name, {
        authStatus: 'error',
        authError: err instanceof Error ? err.message : 'Failed to start device auth',
      })
    }
  }
  const toggleProvider = (name: string) => {
    onChange((current) => ({
      ...current,
      providers: current.providers.map((p) => (p.name === name ? { ...p, active: !p.active } : p)),
    }))
  }
  const activeProviders = state.providers.filter((p) => p.active)

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">Configure your LLM providers. At least one must be active to continue.</p>
      <div className="space-y-3">
        {state.providers.map((provider) => (
          <ProviderCard
            key={provider.name}
            draft={provider}
            onChange={(patch) => updateProvider(provider.name, patch)}
            onToggle={() => toggleProvider(provider.name)}
            onConnect={() => connectProvider(provider.name)}
            onDeviceAuth={() => startDeviceAuth(provider.name)}
          />
        ))}
      </div>
      {activeProviders.length === 0 && (
        <p className="text-xs text-[var(--s-att-tx)]">At least one provider must be active</p>
      )}
    </div>
  )
}

const ROUTE_LABELS: Record<string, string> = {
  planning: 'Planning',
  dispatching: 'Dispatching',
  discussion: 'Discussion',
}

const FALLBACK_MODELS: Record<string, string[]> = {
  openai:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3', 'o3-mini', 'o4-mini'],
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
}

function resolveModelOptions(provider: ProviderDraft): string[] {
  if (provider.modelOptions && provider.modelOptions.length > 0) return provider.modelOptions
  return FALLBACK_MODELS[provider.type] ?? []
}

function RoutingRow({ label, entries, providers, onChange }: {
  label: string
  entries: RoutingEntry[]
  providers: ProviderDraft[]
  onChange: (entries: RoutingEntry[]) => void
}) {
  const activeProviders = providers.filter((p) => p.active)
  const [modelAssessments, setModelAssessments] = useState<Record<number, ModelCapabilityAssessment>>({})
  const assessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const defaultEntries: RoutingEntry[] = entries.length > 0
    ? entries
    : [{ provider_name: activeProviders[0]?.name ?? '', model: activeProviders[0] ? resolveModelOptions(activeProviders[0])[0] ?? activeProviders[0].model ?? '' : '' }]

  const update = (i: number, patch: Partial<RoutingEntry>) => {
    onChange(defaultEntries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  }
  const remove = (i: number) => onChange(defaultEntries.filter((_, idx) => idx !== i))
  const addFallback = () => {
    const first = activeProviders[0]
    onChange([...defaultEntries, { provider_name: first?.name ?? '', model: first ? resolveModelOptions(first)[0] ?? first.model ?? '' : '' }])
  }

  // Assess model capability for each entry when model changes (debounced 300ms)
  const modelsKey = defaultEntries.map((e, i) => `${i}:${e.model}`).join(',')
  useEffect(() => {
    if (assessTimerRef.current) { clearTimeout(assessTimerRef.current); assessTimerRef.current = null }
    let cancelled = false
    assessTimerRef.current = setTimeout(() => {
      defaultEntries.forEach((entry, i) => {
        if (!entry.model.trim()) return
        fetchModelCapability(entry.model)
          .then((result) => { if (!cancelled) setModelAssessments((prev) => ({ ...prev, [i]: result })) })
          .catch(() => {})
      })
    }, 300)
    return () => {
      cancelled = true
      if (assessTimerRef.current) { clearTimeout(assessTimerRef.current); assessTimerRef.current = null }
    }
  }, [modelsKey])

  return (
    <div className="grid grid-cols-[100px_1fr] gap-3 items-start">
      <span className="pt-2 text-xs text-[var(--muted)]">{label}</span>
      <div className="space-y-2">
        {defaultEntries.map((entry, i) => {
          const assessment = modelAssessments[i]
          return (
            <div key={i}>
              <div className="flex gap-2 items-center">
                {(() => {
                  const selectedProvider = activeProviders.find((p) => p.name === entry.provider_name)
                  const modelOptions = selectedProvider ? resolveModelOptions(selectedProvider) : []
                  return (
                    <>
            <select
              value={entry.provider_name}
              onChange={(e) => {
                const prov = activeProviders.find((p) => p.name === e.target.value)
                update(i, { provider_name: e.target.value, model: prov ? resolveModelOptions(prov)[0] ?? prov.model ?? '' : '' })
              }}
              className="flex-1 bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-2 py-1.5 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--sel-bd)]"
            >
              {activeProviders.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            {modelOptions.length > 0 ? (
              <select
                value={entry.model || modelOptions[0]}
                onChange={(e) => update(i, { model: e.target.value })}
                className="flex-1 bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-2 py-1.5 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--sel-bd)]"
              >
                {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            ) : (
              <input
                value={entry.model}
                onChange={(e) => update(i, { model: e.target.value })}
                placeholder="model"
                className="flex-1 bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-2 py-1.5 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]"
              />
            )}
                    </>
                  )
                })()}
                {i > 0 && (
                  <button type="button" onClick={() => remove(i)} className="text-xs text-[var(--muted)] hover:text-[var(--s-blk-tx)]">✕</button>
                )}
              </div>
              {assessment && assessment.tier === 'blocked' && (
                <div className="mt-1.5 ml-2 rounded border border-rose-300/30 bg-rose-300/10 px-2 py-1.5">
                  <p className="text-[11px] font-semibold text-rose-300">⚠ Blocked — model too small for Prime</p>
                  <p className="mt-0.5 text-[11px] text-rose-200/70">{assessment.warning}</p>
                </div>
              )}
              {assessment && assessment.tier === 'warned' && (
                <div className="mt-1.5 ml-2 rounded border border-amber-300/30 bg-amber-300/10 px-2 py-1.5">
                  <p className="text-[11px] font-semibold text-amber-300">⚠ Warning — model may be underpowered</p>
                  <p className="mt-0.5 text-[11px] text-amber-200/70">{assessment.warning}</p>
                </div>
              )}
            </div>
          )
        })}
        <button type="button" onClick={addFallback} className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline">
          + Add fallback
        </button>
      </div>
    </div>
  )
}

function StepRouting({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  const updateRoute = (key: keyof RoutingDraft, entries: RoutingEntry[]) => {
    onChange({ ...state, routing: { ...state.routing, [key]: entries } })
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">
        Assign providers to each routing role. The planning route is used when no matching route is found.
      </p>
      <div className="space-y-4">
        {(['planning', 'dispatching', 'discussion'] as const).map((key) => (
          <RoutingRow
            key={key}
            label={ROUTE_LABELS[key]}
            entries={state.routing[key]}
            providers={state.providers}
            onChange={(entries) => updateRoute(key, entries)}
          />
        ))}
      </div>
      <div>
        <label className={LABEL_CLS}>Monthly token budget (0 = unlimited)</label>
        <input
          type="number"
          min={0}
          value={state.costControls.monthlyTokenBudget}
          onChange={(e) => onChange({ ...state, costControls: { monthlyTokenBudget: Number(e.target.value) } })}
          placeholder="0"
          className={INPUT_CLS}
        />
      </div>
    </div>
  )
}

const SECTION_LABELS: Record<keyof ProfileSectionSet, string> = {
  identity: 'Identity',
  voice_tone: 'Voice & Tone',
  decision_style: 'Decision Style',
  default_behaviors: 'Default Behaviors',
  approval_thresholds: 'Approval Thresholds',
}

const SOUL_KEYS: (keyof ProfileSectionSet)[] = ['identity', 'voice_tone', 'decision_style']
const OP_KEYS: (keyof ProfileSectionSet)[] = ['default_behaviors', 'approval_thresholds']

function getSection(profile: ProfileDraft, key: keyof ProfileSectionSet): string {
  if (SOUL_KEYS.includes(key)) return profile.soul[key as keyof ProfileDraft['soul']]
  return profile.operating[key as keyof ProfileDraft['operating']]
}

function withSection(profile: ProfileDraft, key: keyof ProfileSectionSet, value: string): ProfileDraft {
  if (SOUL_KEYS.includes(key)) {
    return { ...profile, soul: { ...profile.soul, [key]: value } }
  }
  return { ...profile, operating: { ...profile.operating, [key]: value } }
}

export function StepPersonality({ profile, onChange }: { profile: ProfileDraft; onChange: (next: ProfileDraft) => void }) {
  const setMode = (mode: ProfileDraft['view_mode']) => onChange({ ...profile, view_mode: mode })

  const clearAll = () => onChange({
    ...profile,
    soul: { identity: '', voice_tone: '', decision_style: '' },
    operating: { default_behaviors: '', approval_thresholds: '' },
  })

  const resetAll = () => onChange({
    ...profile,
    soul: {
      identity:       profile.shipped_defaults.identity,
      voice_tone:     profile.shipped_defaults.voice_tone,
      decision_style: profile.shipped_defaults.decision_style,
    },
    operating: {
      default_behaviors:   profile.shipped_defaults.default_behaviors,
      approval_thresholds: profile.shipped_defaults.approval_thresholds,
    },
  })

  const renderSectionField = (key: keyof ProfileSectionSet) => {
    const value = getSection(profile, key)
    const diverges = value.trim() !== profile.shipped_defaults[key].trim()
    return (
      <div key={key}>
        <label className={LABEL_CLS}>{SECTION_LABELS[key]}</label>
        <textarea
          aria-label={SECTION_LABELS[key]}
          value={value}
          onChange={(e) => onChange(withSection(profile, key, e.target.value))}
          rows={6}
          className={INPUT_CLS + ' resize-y'}
        />
        {diverges && (
          <button
            type="button"
            onClick={() => onChange(withSection(profile, key, profile.shipped_defaults[key]))}
            aria-label={`Reset ${SECTION_LABELS[key]}`}
            className="mt-1 text-xs text-[var(--muted)] hover:text-[var(--text)] underline"
          >
            Reset {SECTION_LABELS[key]} to default
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex-1">
          <label className={LABEL_CLS}>Name</label>
          <input
            value={profile.name}
            onChange={(e) => onChange({ ...profile, name: e.target.value })}
            placeholder="Prime"
            className={INPUT_CLS}
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('sections')}
            className={`px-3 py-1.5 text-xs rounded border transition ${profile.view_mode === 'sections' ? 'border-[#6ee7ff] bg-[#1f6feb] text-white' : 'border-[var(--border-soft)] text-[var(--muted)]'}`}
          >
            Sections
          </button>
          <button
            type="button"
            onClick={() => setMode('markdown')}
            className={`px-3 py-1.5 text-xs rounded border transition ${profile.view_mode === 'markdown' ? 'border-[#6ee7ff] bg-[#1f6feb] text-white' : 'border-[var(--border-soft)] text-[var(--muted)]'}`}
          >
            Markdown
          </button>
        </div>
      </div>

      {profile.view_mode === 'sections' ? (
        <>
          <fieldset className="rounded-lg border border-[var(--border-soft)] p-3 space-y-3">
            <legend className="px-1 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">Who Prime is</legend>
            {SOUL_KEYS.map(renderSectionField)}
          </fieldset>
          <fieldset className="rounded-lg border border-[var(--border-soft)] p-3 space-y-3">
            <legend className="px-1 text-xs uppercase tracking-[0.14em] text-[var(--muted)]">How Prime works here</legend>
            {OP_KEYS.map(renderSectionField)}
          </fieldset>
        </>
      ) : (
        <>
          <div>
            <label className={LABEL_CLS}>prime-soul.md</label>
            <textarea
              aria-label="prime-soul markdown"
              value={renderSoulMarkdown(profile)}
              onChange={(e) => onChange(applySoulMarkdown(profile, e.target.value))}
              rows={14}
              className={INPUT_CLS + ' font-mono text-xs resize-y'}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>prime.md</label>
            <textarea
              aria-label="prime operating markdown"
              value={renderOperatingMarkdown(profile)}
              onChange={(e) => onChange(applyOperatingMarkdown(profile, e.target.value))}
              rows={14}
              className={INPUT_CLS + ' font-mono text-xs resize-y'}
            />
          </div>
        </>
      )}

      <div className="flex flex-wrap gap-3 pt-2">
        <button type="button" onClick={clearAll} className={BTN_SECONDARY}>Clear all (start from scratch)</button>
        <button type="button" onClick={resetAll} className={BTN_SECONDARY}>Reset all to defaults</button>
      </div>
    </div>
  )
}

function renderSoulMarkdown(p: ProfileDraft): string {
  const parts: string[] = []
  if (p.soul.identity.trim())       parts.push(`## Identity\n${p.soul.identity.trim()}`)
  if (p.soul.voice_tone.trim())     parts.push(`## Voice & Tone\n${p.soul.voice_tone.trim()}`)
  if (p.soul.decision_style.trim()) parts.push(`## Decision Style\n${p.soul.decision_style.trim()}`)
  return parts.join('\n\n') + (parts.length ? '\n' : '')
}

function renderOperatingMarkdown(p: ProfileDraft): string {
  const parts: string[] = []
  if (p.operating.default_behaviors.trim())   parts.push(`## Default Behaviors\n${p.operating.default_behaviors.trim()}`)
  if (p.operating.approval_thresholds.trim()) parts.push(`## Approval Thresholds\n${p.operating.approval_thresholds.trim()}`)
  return parts.join('\n\n') + (parts.length ? '\n' : '')
}

function applySoulMarkdown(p: ProfileDraft, md: string): ProfileDraft {
  const sections = parseMdSections(md, { identity: 'Identity', voice_tone: 'Voice & Tone', decision_style: 'Decision Style' })
  return { ...p, soul: {
    identity:       sections.identity ?? '',
    voice_tone:     sections.voice_tone ?? '',
    decision_style: sections.decision_style ?? '',
  } }
}

function applyOperatingMarkdown(p: ProfileDraft, md: string): ProfileDraft {
  const sections = parseMdSections(md, { default_behaviors: 'Default Behaviors', approval_thresholds: 'Approval Thresholds' })
  return { ...p, operating: {
    default_behaviors:   sections.default_behaviors ?? '',
    approval_thresholds: sections.approval_thresholds ?? '',
  } }
}

function parseMdSections(md: string, headingMap: Record<string, string>): Record<string, string> {
  const lower: Record<string, string> = {}
  for (const [key, heading] of Object.entries(headingMap)) lower[heading.toLowerCase()] = key
  const out: Record<string, string> = {}
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  let currentKey: string | null = null
  let buf: string[] = []
  const flush = () => {
    if (currentKey) out[currentKey] = buf.join('\n').replace(/^\n+|\n+$/g, '')
    buf = []
  }
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line)
    if (m) {
      flush()
      currentKey = lower[m[1].trim().toLowerCase()] ?? null
      continue
    }
    if (currentKey) buf.push(line)
  }
  flush()
  return out
}

export function profileSubmitPayload(p: ProfileDraft) {
  return {
    name: p.name,
    soul: {
      identity:       p.soul.identity,
      voice_tone:     p.soul.voice_tone,
      decision_style: p.soul.decision_style,
    },
    operating: {
      default_behaviors:   p.operating.default_behaviors,
      approval_thresholds: p.operating.approval_thresholds,
    },
  }
}

function StepRules({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  const toggle = (key: string) => {
    const presets = state.rules.presets.includes(key)
      ? state.rules.presets.filter((k) => k !== key)
      : [...state.rules.presets, key]
    onChange({ ...state, rules: { ...state.rules, presets } })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {PRESET_RULES.map((rule) => {
          const on = state.rules.presets.includes(rule.key)
          return (
            <button
              key={rule.key}
              type="button"
              onClick={() => toggle(rule.key)}
              className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                on
                  ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)]'
                  : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] hover:bg-[var(--panel)]'
              }`}
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs ${
                on ? 'border-[var(--sel-bd)] bg-blue-400/20 text-blue-400' : 'border-[var(--border-soft)]'
              }`}>
                {on && '✓'}
              </span>
              <span className={`text-xs ${on ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>{rule.label}</span>
            </button>
          )
        })}
      </div>
      <div>
        <label className={LABEL_CLS}>Additional rules</label>
        <textarea
          value={state.rules.custom}
          onChange={(e) => onChange({ ...state, rules: { ...state.rules, custom: e.target.value } })}
          placeholder="Any other constraints or behaviors not listed above"
          rows={3}
          className={INPUT_CLS + ' resize-none'}
        />
      </div>
    </div>
  )
}

function StepWorkspace({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  const workspace = state.workspace
  const update = (patch: Partial<WorkspaceDraft>) =>
    onChange({ ...state, workspace: { ...workspace, ...patch } })

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">
        The Agent Workspace stores editable agent profiles, prompt templates, skills, and operating notes outside the ACP codebase.
      </p>
      <div>
        <label className={LABEL_CLS}>Workspace mode</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => update({ mode: 'local' })}
            className={`px-3 py-1.5 text-xs rounded border transition ${
              workspace.mode === 'local'
                ? 'border-[#6ee7ff] bg-[#1f6feb] text-white'
                : 'border-[rgba(148,163,184,0.28)] bg-[#1f2937] text-[#e2e8f0] hover:bg-[#334155] hover:text-white'
            }`}
          >
            Local managed
          </button>
          <button
            type="button"
            onClick={() => update({ mode: 'git' })}
            className={`px-3 py-1.5 text-xs rounded border transition ${
              workspace.mode === 'git'
                ? 'border-[#6ee7ff] bg-[#1f6feb] text-white'
                : 'border-[rgba(148,163,184,0.28)] bg-[#1f2937] text-[#e2e8f0] hover:bg-[#334155] hover:text-white'
            }`}
          >
            Git-backed
          </button>
        </div>
      </div>
      <div>
        <label className={LABEL_CLS}>Workspace root</label>
        <input
          value={workspace.root_path}
          onChange={(e) => update({ root_path: e.target.value })}
          placeholder="/var/lib/agent-cp/workspace"
          className={INPUT_CLS}
        />
      </div>
      {workspace.mode === 'git' && (
        <>
          <div>
            <label className={LABEL_CLS}>Remote URL</label>
            <input
              value={workspace.remote_url}
              onChange={(e) => update({ remote_url: e.target.value })}
              placeholder="https://gitea.example.com/org/agent-workspace.git"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>Branch</label>
            <input
              value={workspace.branch}
              onChange={(e) => update({ branch: e.target.value })}
              placeholder="main"
              className={INPUT_CLS}
            />
          </div>
        </>
      )}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3 text-xs text-[var(--muted)]">
        ACP will scaffold `agents/`, `prompts/`, `skills/`, `policies/`, `memory/`, and `config/`, then use those markdown files as the editable behavior layer for Prime.
      </div>
    </div>
  )
}

export function StepPlugins({ pluginChoices, onChange }: { pluginChoices: Array<{ plugin_id: string; name: string; description: string; selected: boolean; configuration_state: 'not_required' | 'deferred_post_launch' | 'configured' | 'unavailable' }>; onChange: (update: { plugin_choices: typeof pluginChoices }) => void }) {
  const [plugins, setPlugins] = useState<Array<{ id: string; name: string; description: string; optional: boolean; status: 'available' | 'unavailable' }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    import('../api').then(({ fetchSetupPlugins }) => {
      fetchSetupPlugins().then((data) => {
        setPlugins(data)
        setLoading(false)
      }).catch(() => {
        setLoading(false)
      })
    })
  }, [])

  const togglePlugin = (plugin: typeof plugins[0], selected: boolean) => {
    const existing = pluginChoices.find((p) => p.plugin_id === plugin.id)
    let newChoices: typeof pluginChoices
    if (existing) {
      newChoices = pluginChoices.map((p) =>
        p.plugin_id === plugin.id ? { ...p, selected } : p
      )
    } else {
      newChoices = [
        ...pluginChoices,
        {
          plugin_id: plugin.id,
          name: plugin.name,
          description: plugin.description,
          selected,
          configuration_state: 'deferred_post_launch',
        },
      ]
    }
    onChange({ plugin_choices: newChoices })
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-[var(--muted)]">Loading plugin inventory...</p>
      </div>
    )
  }

  if (plugins.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-xs text-[var(--muted)]">Select optional pi plugins to enhance Prime's capabilities.</p>
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-center">
          <p className="text-xs text-[var(--muted)]">No plugins available at this time.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">Select optional pi plugins to enhance Prime's capabilities.</p>
      <div className="space-y-3">
        {plugins.map((plugin) => {
          const selected = pluginChoices.some((p) => p.plugin_id === plugin.id && p.selected)
          return (
            <div key={plugin.id} className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-[var(--text)]">{plugin.name}</div>
                  <div className="mt-1 text-xs text-[var(--muted)]">{plugin.description}</div>
                  {selected && (
                    <div className="mt-2 rounded border border-[rgba(110,231,255,0.28)] bg-[rgba(31,111,235,0.12)] px-2 py-1">
                      <p className="text-[10px] font-semibold text-[#6ee7ff]">Post-launch configuration required</p>
                      <p className="text-[10px] text-[var(--muted)]">Configure this plugin after Prime launches.</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  {selected ? (
                    <button
                      type="button"
                      onClick={() => togglePlugin(plugin, false)}
                      className="px-3 py-1.5 text-xs rounded border border-[rgba(148,163,184,0.28)] bg-[#1f2937] text-[#e2e8f0] hover:bg-[#334155] hover:text-white"
                    >
                      Skip
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => togglePlugin(plugin, true)}
                      className="px-3 py-1.5 text-xs rounded border border-[#6ee7ff] bg-[#1f6feb] text-white hover:bg-[#2b7fff]"
                    >
                      Select
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StepIntro() {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[rgba(110,231,255,0.18)] bg-[linear-gradient(180deg,rgba(15,27,45,0.96),rgba(9,18,32,0.94))] p-5">
        <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">Agent Control Plane</div>
        <h2 className="mt-2 text-lg font-semibold text-[var(--text)]">Set up your operator layer</h2>
        <div className="mt-3 space-y-3 text-sm leading-6 text-[var(--muted)]">
          <p>
            ACP is a control surface for configuring providers, routing work across models, and shaping how your prime agent behaves.
          </p>
          <p>
            This setup walks through LLM access, routing defaults, personality, and standing rules so the system can start in a usable state.
          </p>
          <p>
            Nothing here is permanent. You can refine providers and governance settings later from the main portal.
          </p>
        </div>
      </div>
    </div>
  )
}



function SectionCard({ label, issue, onEdit, children }: {
  label: string
  issue?: string
  onEdit: () => void
  children: React.ReactNode
}) {
  const hasIssue = Boolean(issue)
  return (
    <div className={`rounded-lg border p-3 ${hasIssue ? 'border-amber-400/50 bg-amber-400/5' : 'border-[var(--border-soft)] bg-[var(--panel-subtle)]'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--text)]">{label}</span>
          {hasIssue && <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide">Action needed</span>}
        </div>
        <button type="button" onClick={onEdit} className="text-xs text-blue-400 hover:underline">Edit</button>
      </div>
      {children}
    </div>
  )
}

function StepLaunch({ state, onSubmit, submitting, error, sectionIssues, onGoToStep }: {
  state: WizardState
  onSubmit: (launch: boolean) => void
  submitting: boolean
  error: string | null
  sectionIssues: Record<string, string>
  onGoToStep: (step: Step) => void
}) {
  const activeProviders = state.providers.filter((p) => p.active)
  const hasIssues = Object.keys(sectionIssues).length > 0

  return (
    <div className="space-y-4">
      {/* Providers summary */}
      <SectionCard label="Providers" issue={sectionIssues.providers} onEdit={() => onGoToStep(1)}>
        {activeProviders.length === 0
          ? <p className="text-xs text-[var(--s-att-tx)]">No providers configured</p>
          : activeProviders.map((p) => (
              <div key={p.name} className="text-xs text-[var(--muted)] font-mono">{p.name} ({p.type}) · {p.model || '—'}</div>
            ))
        }
      </SectionCard>

      {/* Routing summary */}
      <SectionCard label="Routing" issue={sectionIssues.routing} onEdit={() => onGoToStep(2)}>
        {(['planning', 'dispatching', 'discussion'] as const).map((key) => {
          const entries = state.routing[key]
          const configured = entries.some((e) => e.provider_name.trim() && e.model.trim())
          return (
            <div key={key} className={`text-xs ${configured ? 'text-[var(--muted)]' : 'text-amber-400'}`}>
              <span className="capitalize">{key}</span>:{' '}
              {configured ? entries.map((e) => `${e.provider_name} / ${e.model}`).join(' → ') : 'not configured'}
            </div>
          )
        })}
        {state.costControls.monthlyTokenBudget > 0 && (
          <div className="text-xs text-[var(--muted)]">Budget: {state.costControls.monthlyTokenBudget.toLocaleString()} tokens/month</div>
        )}
      </SectionCard>

      {/* Personality summary */}
      <SectionCard label="Personality" issue={sectionIssues.personality} onEdit={() => onGoToStep(3)}>
        <div className="text-xs text-[var(--muted)] space-y-0.5">
          <div>Name: <span className={state.profile.name ? 'text-[var(--text)]' : 'text-amber-400'}>{state.profile.name || 'not set'}</span></div>
          <div>Identity: <span className={state.profile.soul.identity.trim() ? 'text-[var(--text)]' : 'text-amber-400'}>{state.profile.soul.identity.trim() ? `${state.profile.soul.identity.slice(0, 60)}${state.profile.soul.identity.length > 60 ? '…' : ''}` : 'empty'}</span></div>
        </div>
      </SectionCard>

      {/* Rules summary */}
      <SectionCard label="Standing Rules" issue={sectionIssues.rules} onEdit={() => onGoToStep(4)}>
        {state.rules.presets.length === 0 && !state.rules.custom
          ? <p className="text-xs text-amber-400">No rules configured — select at least one</p>
          : (
            <div className="text-xs text-[var(--muted)] space-y-0.5">
              {state.rules.presets.map((k) => {
                const rule = PRESET_RULES.find((r) => r.key === k)
                return rule ? <div key={k}>• {rule.label}</div> : null
              })}
              {state.rules.custom && <div>• {state.rules.custom}</div>}
            </div>
          )
        }
      </SectionCard>

      {/* Plugins summary */}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[var(--text)]">Plugins</span>
          <button type="button" onClick={() => onGoToStep(6)} className="text-xs text-blue-400 hover:underline">Edit</button>
        </div>
        {( state.pluginChoices ?? []).length === 0
          ? <p className="text-xs text-[var(--muted)]">No plugins selected</p>
          : (
            <div className="text-xs text-[var(--muted)] space-y-0.5">
              {(state.pluginChoices ?? []).map((p) => (
                <div key={p.plugin_id}>
                  • {p.name}{p.selected ? '' : ' (skipped)'}
                  {p.selected && p.configuration_state === 'deferred_post_launch' && (
                    <span className="ml-1 text-yellow-400">· configure after launch</span>
                  )}
                </div>
              ))}
            </div>
          )
        }
      </div>

      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[var(--text)]">Agent Workspace</span>
          <button type="button" onClick={() => onGoToStep(5)} className="text-xs text-blue-400 hover:underline">Edit</button>
        </div>
        <div className="text-xs text-[var(--muted)] space-y-0.5">
          <div>Mode: <span className="text-[var(--text)]">{state.workspace.mode === 'git' ? 'Git-backed' : 'Local managed'}</span></div>
          <div>Root: <span className="text-[var(--text)]">{state.workspace.root_path || '—'}</span></div>
          {state.workspace.mode === 'git' && (
            <>
              <div>Remote: <span className="text-[var(--text)]">{state.workspace.remote_url || '—'}</span></div>
              <div>Branch: <span className="text-[var(--text)]">{state.workspace.branch || 'main'}</span></div>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded border border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)] px-3 py-2">
          <p className="text-xs text-[var(--s-blk-tx)] font-mono">{error}</p>
          <p className="text-xs text-[var(--muted)] mt-1">The endpoint is safe to retry — providers won't be duplicated.</p>
        </div>
      )}

      {hasIssues && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/8 px-3 py-2">
          <p className="text-xs font-medium text-amber-300">Fix the highlighted sections before launching:</p>
          <ul className="mt-1 space-y-0.5">
            {Object.entries(sectionIssues).map(([section, msg]) => (
              <li key={section} className="text-xs text-amber-400">• {msg}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => onSubmit(true)} disabled={submitting || hasIssues} className={BTN_PRIMARY}>
          {submitting ? 'Launching…' : 'Launch Prime Agent'}
        </button>
        <button onClick={() => onSubmit(false)} disabled={submitting} className={BTN_SECONDARY}>
          Save & configure later
        </button>
      </div>
    </div>
  )
}

// ─── StepPostLaunch ───────────────────────────────────────────────────────────

function StepPostLaunch({
  threadId,
  teamPlan,
  onConfirmTeamPlan,
  confirming,
}: {
  threadId: string | null
  teamPlan: import('../types').TeamPlan | null
  onConfirmTeamPlan: (selectedRoles: string[]) => void
  confirming: boolean
}) {
  const [selectedRoles, setSelectedRoles] = useState<string[]>(() =>
    teamPlan?.agents.filter((a) => a.recommendation_strength === 'strongly_recommended').map((a) => a.role) ?? []
  )

  const toggleRole = (role: string) => {
    setSelectedRoles((prev) => prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role])
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
        <p className="text-sm font-medium text-[var(--text)]">Prime is ready</p>
        <p className="mt-1 text-xs text-[var(--muted)]">Setup is complete. Prime's onboarding conversation has started.</p>
        {threadId && (
          <a
            href={`/governance?thread=${threadId}`}
            className="mt-2 inline-block text-xs text-blue-400 hover:underline"
          >
            Open onboarding conversation →
          </a>
        )}
      </div>

      {teamPlan && teamPlan.confirmation_status === 'proposed' && (
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 space-y-3">
          <p className="text-sm font-medium text-[var(--text)]">Proposed Team</p>
          <p className="text-xs text-[var(--muted)]">Select the agents to create. SRE and DevOps are strongly recommended for system stability.</p>
          <div className="space-y-2">
            {teamPlan.agents.map((agent) => {
              const isSelected = selectedRoles.includes(agent.role)
              const isStrong = agent.recommendation_strength === 'strongly_recommended'
              return (
                <label key={agent.role} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleRole(agent.role)}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-xs font-medium text-[var(--text)]">{agent.name}</span>
                    {isStrong && (
                      <span className="ml-1 text-[10px] text-yellow-400 font-medium">strongly recommended</span>
                    )}
                    <p className="text-[11px] text-[var(--muted)]">{agent.rationale}</p>
                  </div>
                </label>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => onConfirmTeamPlan(selectedRoles)}
            disabled={confirming || selectedRoles.length === 0}
            className={BTN_PRIMARY}
          >
            {confirming ? 'Creating agents…' : `Confirm team (${selectedRoles.length} agents)`}
          </button>
        </div>
      )}

      {teamPlan && (teamPlan.confirmation_status === 'confirmed' || teamPlan.confirmation_status === 'partially_confirmed') && (
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
          <p className="text-xs text-[var(--text)]">
            {teamPlan.confirmation_status === 'confirmed' ? 'Team created.' : 'Team partially created.'}
            {' '}{teamPlan.created_agent_ids.length} agent{teamPlan.created_agent_ids.length !== 1 ? 's' : ''} ready.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Main Setup component ─────────────────────────────────────────────────────

export function Setup({ onSkip }: { onSkip?: () => void }) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>(0)
  const [state, setState] = useState<WizardState>(INITIAL_STATE)
  const [submitting, setSubmitting] = useState(false)
  const [launchResult, setLaunchResult] = useState<{ threadId: string | null; teamPlan: import('../types').TeamPlan | null } | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    import('../api').then(({ fetchPrimeProfile }) =>
      fetchPrimeProfile().then((res: any) => {
        setState((current) => ({
          ...current,
          profile: {
            ...current.profile,
            name: res.name,
            soul: res.soul,
            operating: res.operating,
            shipped_defaults: res.shipped_defaults,
          },
        }))
      }).catch(() => { /* keep wizard defaults */ })
    )
  }, [])
  const [submitError, setSubmitError] = useState<string | null>(null)
  const progress = (STEPS.map((_, index) => stepProgress(state, index as Step)))
  const progressSteps = STEPS.slice(1)

  const stepBlocker = getStepBlocker(state, step)
  const canAdvance = !stepBlocker

  async function handleSubmit(launch: boolean) {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const body = {
        providers: state.providers
          .filter((p) => p.active)
          .map((p) => ({
            ...(p.id ? { id: p.id } : {}),
            name: p.name,
            type: p.type,
            base_url: p.base_url,
            ...(p.api_key ? { api_key: p.api_key } : {}),
            ...(p.model ? { model: p.model } : {}),
          })),
        routing: {
          planning: state.routing.planning,
          dispatching: state.routing.dispatching,
          discussion: state.routing.discussion,
        },
        profile: profileSubmitPayload(state.profile),
        rules: {
          presets: state.rules.presets,
          custom: state.rules.custom,
        },
        cost_controls: { monthly_token_budget: state.costControls.monthlyTokenBudget },
        prime_config: {
          cron_fast_interval_seconds: state.primeConfig?.cron_fast_interval_seconds,
          cron_slow_interval_seconds: state.primeConfig?.cron_slow_interval_seconds,
          debounce_window_ms: state.primeConfig?.debounce_window_ms,
          monthly_token_budget: state.costControls.monthlyTokenBudget,
        },
        plugin_choices: (state.pluginChoices ?? []).map((p) => ({
          plugin_id: p.plugin_id,
          selected: p.selected,
        })),
        workspace: {
          mode: state.workspace.mode,
          root_path: state.workspace.root_path,
          remote_url: state.workspace.remote_url || undefined,
          branch: state.workspace.branch,
        },
        launch,
      }
      const res = await fetch(`${getApiOrigin()}/api/setup/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await readResponseBody<{ ok?: boolean; error?: string; prime_launch?: { status: string; thread_id?: string } }>(res) as { ok?: boolean; error?: string; prime_launch?: { status: string; thread_id?: string } } | null
      if (!res.ok || !data?.ok) {
        setSubmitError(data?.error ?? `HTTP ${res.status}`)
      } else {
        await queryClient.invalidateQueries({ queryKey: ['setup-status'] })
        if (launch && data?.prime_launch?.status === 'launched') {
          const { generateTeamPlan } = await import('../api')
          let teamPlan: import('../types').TeamPlan | null = null
          try {
            teamPlan = await generateTeamPlan()
          } catch { /* non-blocking */ }
          setLaunchResult({ threadId: data.prime_launch.thread_id ?? null, teamPlan })
        }
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleConfirmTeamPlan(selectedRoles: string[]) {
    if (!launchResult?.teamPlan?.id) return
    setConfirming(true)
    try {
      const { confirmTeamPlan } = await import('../api')
      const result = await confirmTeamPlan(launchResult.teamPlan.id, { selected_roles: selectedRoles, confirm: true })
      setLaunchResult((prev) => prev ? { ...prev, teamPlan: result.team_plan } : prev)
      await queryClient.invalidateQueries({ queryKey: ['agents'] })
    } catch { /* ignore */ } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-[var(--text)]">Setup</h1>
          <p className="mt-1 text-xs text-[var(--muted)]">Configure your agent control plane</p>
        </div>

        {/* Step indicator */}
        <div className="mb-6 space-y-3">
          <div className="relative overflow-hidden rounded-full border border-[rgba(148,163,184,0.2)] bg-[rgba(15,23,42,0.78)]">
            <div className="grid grid-cols-6">
              {progressSteps.map((label, index) => {
                const stepIndex = (index + 1) as Step
                const complete = stepIndex < step
                const active = stepIndex === step
                const fill = complete ? 1 : active ? progress[stepIndex] : 0
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => stepIndex < step && setStep(stepIndex)}
                    className={`group relative h-4 overflow-hidden ${stepIndex < step ? 'cursor-pointer' : 'cursor-default'} ${index < progressSteps.length - 1 ? 'border-r border-[rgba(148,163,184,0.14)]' : ''}`}
                  >
                    {fill > 0 && (
                      <div
                        className={`absolute inset-y-0 left-0 ${
                          complete
                            ? 'bg-[linear-gradient(90deg,rgba(16,185,129,0.55),rgba(110,231,255,0.28))]'
                            : 'wizard-segment-active bg-[linear-gradient(90deg,rgba(31,111,235,0.72),rgba(110,231,255,0.86))]'
                        }`}
                        style={{ width: `${complete ? 100 : Math.max(8, fill * 100)}%` }}
                      />
                    )}
                    {active && fill > 0.08 && (
                      <div
                        className="wizard-segment-scan absolute inset-y-0 left-0 w-8 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.7),transparent)] mix-blend-screen"
                        style={{ left: `${Math.max(0, fill * 100 - 16)}%` }}
                      />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {progressSteps.map((label, index) => {
              const stepIndex = (index + 1) as Step
              return (
              <button
                key={`${label}-label`}
                type="button"
                onClick={() => stepIndex < step && setStep(stepIndex)}
                className={`text-left text-[10px] uppercase tracking-[0.14em] ${
                  stepIndex < step ? 'cursor-pointer' : 'cursor-default'
                } ${
                  stepIndex === step
                    ? 'text-[#dff6ff]'
                    : stepIndex < step
                    ? 'text-[var(--s-ok-tx)]'
                    : 'text-[var(--muted)]'
                }`}
              >
                {label}
              </button>
            )})}
          </div>
        </div>

        {/* Step content */}
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] p-6">
          <h2 className="mb-4 text-sm font-medium text-[var(--text)]">{STEPS[step]}</h2>

          {step === 0 && <StepIntro />}
          {step === 1 && <StepProviders state={state} onChange={setState} />}
          {step === 2 && <StepRouting state={state} onChange={setState} />}
          {step === 3 && <StepPersonality profile={state.profile} onChange={(next) => setState((s) => ({ ...s, profile: next }))} />}
          {step === 4 && <StepRules state={state} onChange={setState} />}
          {step === 5 && <StepWorkspace state={state} onChange={setState} />}
          {step === 6 && (
            <StepPlugins
              pluginChoices={state.pluginChoices ?? []}
              onChange={(update) => setState((s) => ({ ...s, pluginChoices: update.plugin_choices }))}
            />
          )}
          {step === 7 && !launchResult && (
            <StepLaunch
              state={state}
              onSubmit={handleSubmit}
              submitting={submitting}
              error={submitError}
              sectionIssues={getLaunchIssues(state)}
              onGoToStep={(s) => setStep(s)}
            />
          )}
          {step === 7 && launchResult && (
            <StepPostLaunch
              threadId={launchResult.threadId}
              teamPlan={launchResult.teamPlan}
              onConfirmTeamPlan={handleConfirmTeamPlan}
              confirming={confirming}
            />
          )}
        </div>

        {/* Navigation */}
        <div className="mt-4 flex items-center justify-between">
          <div>
            {step > 0 && (
              <button type="button" onClick={() => setStep((s) => (s - 1) as Step)} className={BTN_SECONDARY}>
                ← Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {onSkip && (
              <button type="button" onClick={onSkip} className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline">
                Skip for now
              </button>
            )}
            {step < STEPS.length - 1 && (
              <div className="flex flex-col items-end gap-1">
                {stepBlocker && (
                  <p className="text-[11px] text-amber-400">{stepBlocker}</p>
                )}
                <button
                  type="button"
                  onClick={() => setStep((s) => (s + 1) as Step)}
                  disabled={!canAdvance}
                  className={BTN_PRIMARY}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
