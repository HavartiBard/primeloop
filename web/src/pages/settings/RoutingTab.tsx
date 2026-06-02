import { useEffect, useState } from 'react'
import { fetchSetupDraft, saveSetupDraft } from '../../api'
import { useProviders } from '../../hooks/useProviders'
import {
  StepPrimeFunctionAssignments,
  INITIAL_PROFILE_STATE,
  BTN_PRIMARY,
  BTN_SECONDARY,
  type WizardState,
} from '../Setup'
import type { FunctionAssignment } from '../../types'

export function RoutingTab() {
  const { providers } = useProviders()
  const [assignments, setAssignments] = useState<FunctionAssignment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    fetchSetupDraft()
      .then((draft) => {
        setAssignments(draft.function_assignments ?? [])
        setLoading(false)
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load routing config')
        setLoading(false)
      })
  }, [retryKey])

  const wizardState = {
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      base_url: p.base_url,
      api_key: p.api_key,
      model: p.model,
      active: true,
    })),
    routing: { planning: [], dispatching: [], discussion: [] },
    profile: INITIAL_PROFILE_STATE,
    rules: { presets: [], custom: '' },
    costControls: { monthlyTokenBudget: 0 },
    workspace: { mode: 'local' as const, root_path: '', remote_url: '', branch: 'main' },
    functionAssignments: assignments,
  } as WizardState & { functionAssignments: FunctionAssignment[] }

  const handleChange = (next: typeof wizardState) => {
    setAssignments(next.functionAssignments)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      await saveSetupDraft({ function_assignments: assignments })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save routing config')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-soft)] border-t-[var(--accent)]" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-[var(--s-blk-tx)]">{loadError}</p>
        <button
          type="button"
          onClick={() => setRetryKey((k) => k + 1)}
          className={BTN_SECONDARY}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <StepPrimeFunctionAssignments state={wizardState} onChange={handleChange} />
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={BTN_PRIMARY}
        >
          {saving ? 'Saving…' : 'Save Routing'}
        </button>
        {saveSuccess && (
          <span className="text-sm text-[var(--s-ok-tx)]">Saved successfully</span>
        )}
        {saveError && (
          <span className="text-sm text-[var(--s-blk-tx)]">{saveError}</span>
        )}
      </div>
    </div>
  )
}
