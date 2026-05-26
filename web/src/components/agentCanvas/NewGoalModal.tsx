import { useState } from 'react'
import { createGoal } from '../../api'

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
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--border-soft)',
          borderRadius: 10,
          padding: '24px 28px',
          width: 440,
          maxWidth: '92vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
        }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
          New Goal
        </h2>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
              Title <span style={{ color: 'var(--s-blk-tx)' }}>*</span>
            </label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Describe what you want to achieve"
              disabled={submitting}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 10px', borderRadius: 6, fontSize: 13,
                border: '1px solid var(--border-soft)',
                background: 'var(--panel-subtle)', color: 'var(--text)',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>
              Description <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Additional context or success criteria"
              disabled={submitting}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '8px 10px', borderRadius: 6, fontSize: 13,
                border: '1px solid var(--border-soft)',
                background: 'var(--panel-subtle)', color: 'var(--text)',
                resize: 'vertical', outline: 'none',
              }}
            />
          </div>

          {error && (
            <div style={{
              marginBottom: 14, padding: '8px 12px',
              borderRadius: 6, fontSize: 12,
              background: 'var(--s-blk-bg)', border: '1px solid var(--s-blk-bd)',
              color: 'var(--s-blk-tx)',
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              style={{
                padding: '7px 16px', borderRadius: 6, fontSize: 13,
                border: '1px solid var(--border-soft)',
                background: 'var(--panel-subtle)', color: 'var(--muted)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim()}
              style={{
                padding: '7px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                border: 'none',
                background: title.trim() && !submitting ? 'var(--sel-bg)' : 'var(--panel-subtle)',
                color: title.trim() && !submitting ? 'var(--sel-tx)' : 'var(--muted)',
                cursor: title.trim() && !submitting ? 'pointer' : 'default',
                transition: 'background 0.15s',
              }}
            >
              {submitting ? 'Creating…' : 'Create Goal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
