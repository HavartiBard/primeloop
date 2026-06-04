import { useState } from 'react'
import { createGoal } from '../../api'
import { AppModal } from '../AppModal'

export interface NewGoalResult {
  id: string
  title: string
  status: string
  thread_id?: string
}

interface NewGoalModalProps {
  onClose: () => void
  onCreated: (result: NewGoalResult) => void
}

export function NewGoalModal({ onClose, onCreated }: NewGoalModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await createGoal({ title: title.trim(), intent: description.trim() || title.trim() })
      onCreated(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create goal')
      setSubmitting(false)
    }
  }

  return (
    <AppModal
      open
      onClose={onClose}
      eyebrow="Goals"
      title="New Goal"
      tone="queued"
      widthClassName="w-[min(520px,100%)]"
      heightClassName="h-[min(78vh,560px)]"
      bodyClassName="min-h-0 flex-1 overflow-y-auto bg-[var(--panel)] p-6"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--muted)]">
            Title <span className="text-[var(--s-blk-tx)]">*</span>
          </label>
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Describe what you want to achieve"
            disabled={submitting}
            className="w-full rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-2 text-sm text-[var(--text)] outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--muted)]">
            Description <span className="font-normal text-[var(--muted)]">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Additional context or success criteria"
            disabled={submitting}
            className="w-full resize-y rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-2 text-sm text-[var(--text)] outline-none"
          />
        </div>

        {error && (
          <div className="rounded border border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)] px-3 py-2 text-xs text-[var(--s-blk-tx)]">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-4 py-2 text-sm text-[var(--muted)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !title.trim()}
            className="rounded bg-[var(--sel-bg)] px-4 py-2 text-sm font-semibold text-[var(--sel-tx)] disabled:cursor-not-allowed disabled:bg-[var(--panel-subtle)] disabled:text-[var(--muted)]"
          >
            {submitting ? 'Creating…' : 'Create Goal'}
          </button>
        </div>
      </form>
    </AppModal>
  )
}
