// CreateGoalForm — Agentic Control Plane (spec 016, T019)
// Form for creating new goals with title, intent, and priority fields.

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

const API_ORIGIN = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '')
const ROOT_BASE = API_ORIGIN || ''

// ─── Shared styles (mirrored from Setup.tsx) ──────────────────────

const INPUT_CLS =
  'w-full rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-2 text-sm font-medium text-[var(--text)] placeholder:text-[var(--muted)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] focus:outline-none focus:border-[var(--sel-bd)] focus:bg-[var(--panel-strong)]'

const LABEL_CLS = 'block text-xs text-[var(--muted)] mb-1'

const BTN_PRIMARY =
  'px-4 py-2 text-sm font-medium rounded border border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-400 hover:bg-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition'

const BTN_SECONDARY =
  'px-4 py-2 text-sm rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)] hover:bg-[var(--panel-strong)] transition'

// ─── Types ────────────────────────────────────────────────────────

type Priority = 'low' | 'normal' | 'high'

interface GoalFormData {
  title: string
  intent: string
  priority: Priority
}

interface GoalFieldErrors {
  title?: string
  intent?: string
}

interface CreatedGoal {
  id: string
  title: string
  status: string
  priority: Priority
  currentSummary: string
  updatedAt: string
}

// ─── API ──────────────────────────────────────────────────────────

async function createGoal(data: GoalFormData): Promise<CreatedGoal> {
  const res = await fetch(`${ROOT_BASE}/api/control-plane/goals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: data.title.trim(),
      intent: data.intent.trim(),
      priority: data.priority,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `HTTP ${res.status}`)
  }
  return res.json() as Promise<CreatedGoal>
}

// ─── Validation ───────────────────────────────────────────────────

function validate(data: GoalFormData): GoalFieldErrors {
  const errors: GoalFieldErrors = {}
  if (!data.title.trim()) {
    errors.title = 'Title is required'
  }
  if (!data.intent.trim()) {
    errors.intent = 'Intent is required'
  }
  return errors
}

// ─── Component ────────────────────────────────────────────────────

export function CreateGoalForm() {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [intent, setIntent] = useState('')
  const [priority, setPriority] = useState<Priority>('normal')
  const [errors, setErrors] = useState<GoalFieldErrors>({})

  const createMutation = useMutation({
    mutationFn: createGoal,
    onSuccess: (goal) => {
      // Invalidate goals list so it refreshes
      queryClient.invalidateQueries({ queryKey: ['goals'] })
      // Navigate to the new goal detail page
      window.location.hash = `/goals/${goal.id}`
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const formData: GoalFormData = { title, intent, priority }
    const validationErrors = validate(formData)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }
    setErrors({})
    createMutation.mutate(formData)
  }

  const isSubmitting = createMutation.isPending

  return (
    <div data-testid="create-goal-form" className="p-4">
      <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
        <h2 className="text-sm text-[var(--muted)]">Create Goal</h2>

        {/* Title */}
        <div>
          <label className={LABEL_CLS}>Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              if (errors.title) setErrors((prev) => ({ ...prev, title: undefined }))
            }}
            placeholder="Short goal name"
            className={`${INPUT_CLS} ${errors.title ? 'border-rose-400/60' : ''}`}
            disabled={isSubmitting}
          />
          {errors.title && (
            <p className="mt-1 text-xs" style={{ color: 'var(--s-blk-tx)' }}>
              {errors.title}
            </p>
          )}
        </div>

        {/* Intent */}
        <div>
          <label className={LABEL_CLS}>Intent</label>
          <textarea
            value={intent}
            onChange={(e) => {
              setIntent(e.target.value)
              if (errors.intent) setErrors((prev) => ({ ...prev, intent: undefined }))
            }}
            placeholder="Full description of what to accomplish"
            rows={5}
            className={`${INPUT_CLS} resize-y ${errors.intent ? 'border-rose-400/60' : ''}`}
            disabled={isSubmitting}
          />
          {errors.intent && (
            <p className="mt-1 text-xs" style={{ color: 'var(--s-blk-tx)' }}>
              {errors.intent}
            </p>
          )}
        </div>

        {/* Priority */}
        <div>
          <label className={LABEL_CLS}>Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            className={INPUT_CLS}
            disabled={isSubmitting}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </div>

        {/* API error */}
        {createMutation.error && (
          <div className="rounded-lg border border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)] px-4 py-3 text-sm" style={{ color: 'var(--s-blk-tx)' }}>
            Failed to create goal: {createMutation.error.message}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className={BTN_PRIMARY}
          >
            {isSubmitting ? 'Creating...' : 'Create Goal'}
          </button>
          {!isSubmitting && (
            <button
              type="button"
              onClick={() => {
                setTitle('')
                setIntent('')
                setPriority('normal')
                setErrors({})
              }}
              className={BTN_SECONDARY}
            >
              Clear
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
