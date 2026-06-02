import { useEffect, useState } from 'react'
import { fetchPrimeProfile, updatePrimeProfile } from '../../api'
import {
  StepPersonality,
  INITIAL_PROFILE_STATE,
  BTN_PRIMARY,
  BTN_SECONDARY,
  type ProfileDraft,
} from '../Setup'

export function PersonalityTab() {
  const [profile, setProfile] = useState<ProfileDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    setLoading(true)
    setLoadError(null)
    fetchPrimeProfile()
      .then((res) => {
        setProfile({
          ...INITIAL_PROFILE_STATE,
          name: res.name ?? 'Prime',
          soul: {
            identity:       res.soul.identity       ?? INITIAL_PROFILE_STATE.soul.identity,
            voice_tone:     res.soul.voice_tone     ?? INITIAL_PROFILE_STATE.soul.voice_tone,
            decision_style: res.soul.decision_style ?? INITIAL_PROFILE_STATE.soul.decision_style,
          },
          operating: {
            default_behaviors:   res.operating.default_behaviors   ?? INITIAL_PROFILE_STATE.operating.default_behaviors,
            approval_thresholds: res.operating.approval_thresholds ?? INITIAL_PROFILE_STATE.operating.approval_thresholds,
          },
          shipped_defaults: {
            identity:            res.shipped_defaults.identity            ?? INITIAL_PROFILE_STATE.shipped_defaults.identity,
            voice_tone:          res.shipped_defaults.voice_tone          ?? INITIAL_PROFILE_STATE.shipped_defaults.voice_tone,
            decision_style:      res.shipped_defaults.decision_style      ?? INITIAL_PROFILE_STATE.shipped_defaults.decision_style,
            default_behaviors:   res.shipped_defaults.default_behaviors   ?? INITIAL_PROFILE_STATE.shipped_defaults.default_behaviors,
            approval_thresholds: res.shipped_defaults.approval_thresholds ?? INITIAL_PROFILE_STATE.shipped_defaults.approval_thresholds,
          },
        })
        setLoading(false)
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load Prime profile')
        setLoading(false)
      })
  }, [retryKey])

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      await updatePrimeProfile({ soul: profile.soul, operating: profile.operating })
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save profile')
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

  if (!profile) return null

  return (
    <div className="p-6 space-y-6">
      <StepPersonality profile={profile} onChange={setProfile} />
      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={BTN_PRIMARY}
        >
          {saving ? 'Saving…' : 'Save Personality'}
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
