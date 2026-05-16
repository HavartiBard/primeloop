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

// ─── Step components (stubs — filled in by later tasks) ──────────────────────

function StepProviders({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">Configure your LLM providers. At least one must be active to continue.</p>
      <p className="text-xs text-[var(--s-att-tx)] font-mono">Step 1 content — to be replaced</p>
    </div>
  )
}

function StepRouting({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">Assign providers to planning, dispatching, and discussion routes.</p>
      <p className="text-xs text-[var(--s-att-tx)] font-mono">Step 2 content — to be replaced</p>
    </div>
  )
}

function StepPersonality({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">Define the Prime Agent's name, focus, and tone.</p>
      <p className="text-xs text-[var(--s-att-tx)] font-mono">Step 3 content — to be replaced</p>
    </div>
  )
}

function StepRules({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">Choose standing rules for the Prime Agent.</p>
      <p className="text-xs text-[var(--s-att-tx)] font-mono">Step 4 content — to be replaced</p>
    </div>
  )
}

function StepLaunch({ state, onSubmit, submitting, error, onGoToStep }: {
  state: WizardState
  onSubmit: (launch: boolean) => void
  submitting: boolean
  error: string | null
  onGoToStep: (step: Step) => void
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">Review your configuration and launch.</p>
      <p className="text-xs text-[var(--s-att-tx)] font-mono">Step 5 content — to be replaced</p>
      {error && <p className="text-xs text-[var(--s-blk-tx)] font-mono">{error}</p>}
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
