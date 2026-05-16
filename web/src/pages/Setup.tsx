import { useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProviderDraft {
  id?: string
  name: string
  type: string
  base_url: string
  api_key?: string
  model?: string
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

interface WizardState {
  providers: ProviderDraft[]
  routing: RoutingDraft
  persona: PersonaDraft
  rules: RulesDraft
  costControls: { monthlyTokenBudget: number }
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
}

const STEPS = ['Providers', 'Routing', 'Personality', 'Rules', 'Launch'] as const
type Step = 0 | 1 | 2 | 3 | 4

// ─── CSS helpers ─────────────────────────────────────────────────────────────

export const INPUT_CLS =
  'w-full bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]'
export const LABEL_CLS = 'block text-xs text-[var(--muted)] mb-1'
export const BTN_PRIMARY =
  'px-4 py-2 text-sm font-medium rounded border border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-400 hover:bg-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition'
export const BTN_SECONDARY =
  'px-4 py-2 text-sm rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)] hover:bg-[var(--panel)] transition'

// ─── Preset rules (shared between StepRules and StepLaunch) ──────────────────

export const PRESET_RULES = [
  { key: 'test_before_delegate', label: 'Always run tests before delegating work to agents' },
  { key: 'no_force_push', label: 'Never force-push to main or protected branches' },
  { key: 'small_prs', label: 'Prefer small, reviewable pull requests over large ones' },
  { key: 'confirm_destructive', label: 'Ask before taking destructive or irreversible actions' },
  { key: 'humans_in_loop', label: 'Keep humans in the loop on external communications' },
]

// ─── Step components ────────────────────────────────────────────────────────

function ProviderCard({ draft, onChange, onToggle }: {
  draft: ProviderDraft
  onChange: (p: Partial<ProviderDraft>) => void
  onToggle: () => void
}) {
  return (
    <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={onToggle}
            className="accent-blue-400 h-4 w-4"
          />
          <span className="text-sm font-medium text-[var(--text)]">{draft.name}</span>
        </label>
        <span className="text-xs text-[var(--muted)] uppercase tracking-wider font-mono">{draft.type}</span>
      </div>
      <div className="space-y-2">
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
            <div>
              <label className={LABEL_CLS}>Model</label>
              <input
                value={draft.model || ''}
                onChange={(e) => onChange({ model: e.target.value })}
                placeholder="claude-sonnet-4-6"
                className={INPUT_CLS}
              />
            </div>
          </>
        )}
        {draft.type === 'openai' && (
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
            <div>
              <label className={LABEL_CLS}>Model</label>
              <input
                value={draft.model || ''}
                onChange={(e) => onChange({ model: e.target.value })}
                placeholder="gpt-4o"
                className={INPUT_CLS}
              />
            </div>
          </>
        )}
        {(draft.type === 'ollama' || draft.type === 'litellm') && (
          <>
            <div>
              <label className={LABEL_CLS}>Base URL</label>
              <input
                value={draft.base_url}
                onChange={(e) => onChange({ base_url: e.target.value })}
                placeholder="http://localhost:11434"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Model</label>
              <input
                value={draft.model || ''}
                onChange={(e) => onChange({ model: e.target.value })}
                placeholder="llama3.2:latest"
                className={INPUT_CLS}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function StepProviders({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  const updateProvider = (name: string, patch: Partial<ProviderDraft>) => {
    onChange({
      ...state,
      providers: state.providers.map((p) => (p.name === name ? { ...p, ...patch } : p)),
    })
  }
  const toggleProvider = (name: string) => {
    onChange({
      ...state,
      providers: state.providers.map((p) => (p.name === name ? { ...p, active: !p.active } : p)),
    })
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
  const addFallback = () => onChange([...entries, { provider_name: activeProviders[0]?.name ?? '', model: '' }])
  const update = (i: number, patch: Partial<RoutingEntry>) => {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  }
  const remove = (i: number) => onChange(entries.filter((_, idx) => idx !== i))

  const defaultEntries: RoutingEntry[] = entries.length > 0
    ? entries
    : [{ provider_name: activeProviders[0]?.name ?? '', model: activeProviders[0]?.model ?? '' }]

  return (
    <div className="grid grid-cols-[100px_1fr] gap-3 items-start">
      <span className="pt-2 text-xs text-[var(--muted)]">{label}</span>
      <div className="space-y-2">
        {defaultEntries.map((entry, i) => (
          <div key={i} className="flex gap-2 items-center">
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
            <input
              value={entry.model}
              onChange={(e) => update(i, { model: e.target.value })}
              placeholder="model"
              className="flex-1 bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-2 py-1.5 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]"
            />
            {i > 0 && (
              <button type="button" onClick={() => remove(i)} className="text-xs text-[var(--muted)] hover:text-[var(--s-blk-tx)]">✕</button>
            )}
          </div>
        ))}
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
          <button type="button" onClick={() => onGoToStep(0)} className="text-xs text-blue-400 hover:underline">Edit</button>
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
          <button type="button" onClick={() => onGoToStep(1)} className="text-xs text-blue-400 hover:underline">Edit</button>
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
          <button type="button" onClick={() => onGoToStep(2)} className="text-xs text-blue-400 hover:underline">Edit</button>
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
          <button type="button" onClick={() => onGoToStep(3)} className="text-xs text-blue-400 hover:underline">Edit</button>
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

  const canAdvance = step === 0 ? state.providers.some((p) => p.active) : true

  async function handleSubmit(launch: boolean) {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const body = {
        providers: state.providers
          .filter((p) => p.active)
          .map(({ active: _a, ...rest }) => rest),
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
        launch,
      }
      const res = await fetch('/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setSubmitError(data.error ?? 'Setup failed')
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
        <div className="mb-6 flex items-center justify-between">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => i < step && setStep(i as Step)}
              className={`flex flex-col items-center gap-1 ${i < step ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium ${
                i === step
                  ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-400'
                  : i < step
                  ? 'border-[var(--s-ok-bd)] bg-[var(--s-ok-bg)] text-[var(--s-ok-tx)]'
                  : 'border-[var(--border-soft)] text-[var(--muted)]'
              }`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`hidden text-[10px] sm:block ${i === step ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>
                {label}
              </span>
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] p-6">
          <h2 className="mb-4 text-sm font-medium text-[var(--text)]">{STEPS[step]}</h2>

          {step === 0 && <StepProviders state={state} onChange={setState} />}
          {step === 1 && <StepRouting state={state} onChange={setState} />}
          {step === 2 && <StepPersonality state={state} onChange={setState} />}
          {step === 3 && <StepRules state={state} onChange={setState} />}
          {step === 4 && (
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
            {step < 4 && (
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
