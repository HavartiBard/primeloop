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

interface PersonaDraft {
  name: string
  focus: string
  tone: 'direct' | 'thorough' | 'collaborative'
  instructions: string
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

interface WizardState {
  providers: ProviderDraft[]
  routing: RoutingDraft
  persona: PersonaDraft
  rules: RulesDraft
  costControls: { monthlyTokenBudget: number }
  workspace: WorkspaceDraft
}

const INITIAL_STATE: WizardState = {
  providers: [
    { name: 'anthropic-main', type: 'anthropic', base_url: 'https://api.anthropic.com', model: 'claude-sonnet-4-6', active: false },
    { name: 'openai-main', type: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o', active: false },
    { name: 'local-main', type: 'ollama', base_url: 'http://localhost:11434', model: '', active: false },
  ],
  routing: { planning: [], dispatching: [], discussion: [] },
  persona: { name: 'Prime', focus: '', tone: 'direct', instructions: '' },
  rules: { presets: [], custom: '' },
  costControls: { monthlyTokenBudget: 0 },
  workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' },
}

const STEPS = ['Intro', 'Providers', 'Routing', 'Personality', 'Rules', 'Workspace', 'Launch'] as const
type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6

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
    let score = 0.15
    if (state.persona.name.trim()) score += 0.25
    if (state.persona.focus.trim()) score += 0.35
    if (state.persona.tone) score += 0.15
    if (state.persona.instructions.trim()) score += Math.min(0.1, state.persona.instructions.trim().length / 400)
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

  const activeProviders = state.providers.filter((provider) => provider.active)
  let score = 0.15
  if (activeProviders.length > 0) score += 0.25
  if (Object.values(state.routing).some((entries) => entries.length > 0)) score += 0.2
  if (state.persona.focus.trim()) score += 0.2
  if (state.rules.presets.length > 0 || state.rules.custom.trim()) score += 0.2
  return clamp01(score)
}

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
                {modelControl('gpt-4o')}
                <button
                  type="button"
                  onClick={onDeviceAuth}
                  disabled={draft.authStatus === 'starting' || draft.authStatus === 'waiting'}
                  className="w-full px-3 py-2 text-xs rounded border border-[rgba(148,163,184,0.28)] bg-[#1f2937] text-[#f8fbff] hover:bg-[#334155] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {draft.authStatus === 'waiting' ? 'Waiting for device login...' : 'Start subscription login'}
                </button>
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

function StepProviders({ state, onChange }: { state: WizardState; onChange: Dispatch<SetStateAction<WizardState>> }) {
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

function RoutingRow({ label, entries, providers, onChange }: {
  label: string
  entries: RoutingEntry[]
  providers: ProviderDraft[]
  onChange: (entries: RoutingEntry[]) => void
}) {
  const activeProviders = providers.filter((p) => p.active)
  const [modelAssessments, setModelAssessments] = useState<Record<number, ModelCapabilityAssessment>>({})
  const assessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addFallback = () => onChange([...entries, { provider_name: activeProviders[0]?.name ?? '', model: '' }])
  const update = (i: number, patch: Partial<RoutingEntry>) => {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  }
  const remove = (i: number) => onChange(entries.filter((_, idx) => idx !== i))

  const defaultEntries: RoutingEntry[] = entries.length > 0
    ? entries
    : [{ provider_name: activeProviders[0]?.name ?? '', model: activeProviders[0]?.model ?? '' }]

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
                  const modelOptions = selectedProvider?.modelOptions ?? []
                  return (
                    <>
            <select
              value={entry.provider_name}
              onChange={(e) => {
                const prov = activeProviders.find((p) => p.name === e.target.value)
                update(i, { provider_name: e.target.value, model: prov?.model ?? entry.model })
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

const TONE_OPTIONS: Array<{ value: PersonaDraft['tone']; label: string }> = [
  { value: 'direct', label: 'Direct & concise' },
  { value: 'thorough', label: 'Thorough & deliberate' },
  { value: 'collaborative', label: 'Collaborative & inquisitive' },
]

function StepPersonality({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const update = (patch: Partial<PersonaDraft>) =>
    onChange({ ...state, persona: { ...state.persona, ...patch } })

  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL_CLS}>Name</label>
        <input
          value={state.persona.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Prime"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Focus</label>
        <input
          value={state.persona.focus}
          onChange={(e) => update({ focus: e.target.value })}
          placeholder="e.g. Senior backend engineer, DevOps specialist"
          className={INPUT_CLS}
        />
      </div>
      <div>
        <label className={LABEL_CLS}>Tone</label>
        <div className="flex flex-wrap gap-2">
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update({ tone: opt.value })}
              className={`px-3 py-1.5 text-xs rounded-full border transition ${
                state.persona.tone === opt.value
                  ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-400'
                  : 'border-[var(--border-soft)] text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
        >
          <span>{showAdvanced ? '▾' : '▸'}</span> Advanced
        </button>
        {showAdvanced && (
          <div className="mt-2">
            <label className={LABEL_CLS}>Additional instructions</label>
            <textarea
              value={state.persona.instructions}
              onChange={(e) => update({ instructions: e.target.value })}
              placeholder="Behavioral notes, decision-making style, domain expertise, etc."
              rows={4}
              className={INPUT_CLS + ' resize-none'}
            />
          </div>
        )}
      </div>
    </div>
  )
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

const TONE_LABEL: Record<PersonaDraft['tone'], string> = {
  direct: 'Direct & concise',
  thorough: 'Thorough & deliberate',
  collaborative: 'Collaborative & inquisitive',
}

function StepLaunch({ state, onSubmit, submitting, error, onGoToStep }: {
  state: WizardState
  onSubmit: (launch: boolean) => void
  submitting: boolean
  error: string | null
  onGoToStep: (step: Step) => void
}) {
  const activeProviders = state.providers.filter((p) => p.active)

  return (
    <div className="space-y-4">
      {/* Providers summary */}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[var(--text)]">Providers</span>
          <button type="button" onClick={() => onGoToStep(1)} className="text-xs text-blue-400 hover:underline">Edit</button>
        </div>
        {activeProviders.length === 0
          ? <p className="text-xs text-[var(--s-att-tx)]">No providers configured</p>
          : activeProviders.map((p) => (
              <div key={p.name} className="text-xs text-[var(--muted)] font-mono">{p.name} ({p.type}) · {p.model || '—'}</div>
            ))
        }
      </div>

      {/* Routing summary */}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[var(--text)]">Routing</span>
          <button type="button" onClick={() => onGoToStep(2)} className="text-xs text-blue-400 hover:underline">Edit</button>
        </div>
        {(['planning', 'dispatching', 'discussion'] as const).map((key) => {
          const entries = state.routing[key]
          if (entries.length === 0) return null
          return (
            <div key={key} className="text-xs text-[var(--muted)]">
              <span className="capitalize">{key}</span>: {entries.map((e) => `${e.provider_name} / ${e.model}`).join(' → ')}
            </div>
          )
        })}
        {state.costControls.monthlyTokenBudget > 0 && (
          <div className="text-xs text-[var(--muted)]">Budget: {state.costControls.monthlyTokenBudget.toLocaleString()} tokens/month</div>
        )}
      </div>

      {/* Personality summary */}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[var(--text)]">Personality</span>
          <button type="button" onClick={() => onGoToStep(3)} className="text-xs text-blue-400 hover:underline">Edit</button>
        </div>
        <div className="text-xs text-[var(--muted)] space-y-0.5">
          <div>Name: <span className="text-[var(--text)]">{state.persona.name || '—'}</span></div>
          <div>Focus: <span className="text-[var(--text)]">{state.persona.focus || '—'}</span></div>
          <div>Tone: <span className="text-[var(--text)]">{TONE_LABEL[state.persona.tone]}</span></div>
        </div>
      </div>

      {/* Rules summary */}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[var(--text)]">Standing Rules</span>
          <button type="button" onClick={() => onGoToStep(4)} className="text-xs text-blue-400 hover:underline">Edit</button>
        </div>
        {state.rules.presets.length === 0 && !state.rules.custom
          ? <p className="text-xs text-[var(--muted)]">None configured</p>
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

      <div className="flex gap-3">
        <button onClick={() => onSubmit(true)} disabled={submitting} className={BTN_PRIMARY}>
          {submitting ? 'Launching…' : 'Launch Prime Agent'}
        </button>
        <button onClick={() => onSubmit(false)} disabled={submitting} className={BTN_SECONDARY}>
          Save & configure later
        </button>
      </div>
    </div>
  )
}

// ─── Main Setup component ─────────────────────────────────────────────────────

export function Setup({ onSkip }: { onSkip?: () => void }) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>(0)
  const [state, setState] = useState<WizardState>(INITIAL_STATE)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const progress = (STEPS.map((_, index) => stepProgress(state, index as Step)))
  const progressSteps = STEPS.slice(1)

  const canAdvance = step === 1 ? state.providers.some((p) => p.active) : true

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
        persona: {
          name: state.persona.name,
          focus: state.persona.focus,
          tone: state.persona.tone,
          instructions: state.persona.instructions,
        },
        rules: {
          presets: state.rules.presets,
          custom: state.rules.custom,
        },
        cost_controls: { monthly_token_budget: state.costControls.monthlyTokenBudget },
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
      const data = await readResponseBody<{ ok?: boolean; error?: string }>(res) as { ok?: boolean; error?: string } | null
      if (!res.ok || !data?.ok) {
        setSubmitError(data?.error ?? `HTTP ${res.status}`)
      } else {
        await queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
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
          {step === 3 && <StepPersonality state={state} onChange={setState} />}
          {step === 4 && <StepRules state={state} onChange={setState} />}
          {step === 5 && <StepWorkspace state={state} onChange={setState} />}
          {step === 6 && (
            <StepLaunch
              state={state}
              onSubmit={handleSubmit}
              submitting={submitting}
              error={submitError}
              onGoToStep={(s) => setStep(s)}
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
            {step < 6 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s + 1) as Step)}
                disabled={!canAdvance}
                className={BTN_PRIMARY}
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
