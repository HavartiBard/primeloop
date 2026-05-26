// ─────────────────────────────────────────────────────────────────────────────
// Bottom Action Toolbar (spec 017)
// Context-preserving toolbar with spawn, tool, goal, artifact, note actions
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import type { ToolbarActionType, ToolbarDraftAction } from '../../types'
import {
  getToolbarActionLabel,
  getToolbarActionShortcut,
} from '../../lib/accessibilityText'

/**
 * Props for BottomActionToolbar
 */
export interface BottomActionToolbarProps {
  /** Current drafts */
  drafts: Record<string, ToolbarDraftAction>
  /** Open draft handler */
  onOpenDraft: (actionType: ToolbarActionType) => void
  /** Cancel draft handler */
  onCancelDraft?: (draftId: string) => void
  /** Submit draft handler */
  onSubmitDraft?: (draftId: string) => void
  /** Compact layout */
  compact?: boolean
  /** When true, renders with absolute positioning scoped inside the parent canvas container */
  contained?: boolean
}

/**
 * Bottom Action Toolbar Component
 */
export function BottomActionToolbar({
  drafts,
  onOpenDraft,
  onCancelDraft,
  onSubmitDraft,
  compact = false,
  contained = false,
}: BottomActionToolbarProps) {
  const actionTypes: ToolbarActionType[] = [
    'spawn_agent',
    'tool_call',
    'create_goal',
    'capture_artifact',
    'add_note',
  ]

  const containerStyle = contained
    ? {
        position: 'absolute' as const,
        bottom: '1rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        borderRadius: 8,
        border: '1px solid var(--border-soft)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        background: 'var(--panel)',
      }
    : undefined

  return (
    <div
      className={contained
        ? ''
        : 'fixed bottom-0 left-0 right-0 bg-[var(--panel)] border-t border-[var(--border-soft)] shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-50'}
      style={containerStyle}
      role="toolbar"
      aria-label="Action toolbar"
    >
      <div className={`max-w-7xl mx-auto px-4 ${compact ? 'py-2' : 'py-3'}`}>
        {/* Action buttons */}
        <div className="flex items-center gap-2 mb-2">
          {actionTypes.map((actionType) => (
            <ActionButton
              key={actionType}
              actionType={actionType}
              onClick={() => onOpenDraft(actionType)}
              compact={compact}
            />
          ))}
        </div>

        {/* Draft status area */}
        {Object.keys(drafts).length > 0 && (
          <div className="space-y-2">
            {Object.values(drafts).map((draft) => (
              <DraftStatus
                key={draft.id}
                draft={draft}
                onCancel={onCancelDraft}
                onSubmit={onSubmitDraft}
                compact={compact}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Individual action button
 */
function ActionButton({
  actionType,
  onClick,
  compact = false,
}: {
  actionType: ToolbarActionType
  onClick: () => void
  compact?: boolean
}) {
  const label = getToolbarActionLabel(actionType)
  const shortcut = getToolbarActionShortcut(actionType)

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--panel-subtle)]
        hover:bg-[var(--panel)] border border-[var(--border-soft)] transition-all
        active:scale-95 focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]
        ${compact ? 'text-xs' : 'text-sm'}`}
      aria-label={`${label} (${shortcut})`}
    >
      <span className="font-semibold">{label}</span>
      {shortcut && (
        <span className="text-[10px] text-[var(--muted)] bg-[var(--panel)] px-1 rounded">
          {shortcut}
        </span>
      )}
    </button>
  )
}

/**
 * Draft status indicator
 */
function DraftStatus({
  draft,
  onCancel,
  onSubmit,
  compact = false,
}: {
  draft: ToolbarDraftAction
  onCancel?: (draftId: string) => void
  onSubmit?: (draftId: string) => void
  compact?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-3 py-2 rounded border
        ${draft.status === 'submitting'
          ? 'border-cyan-200 bg-cyan-50'
          : draft.status === 'succeeded'
            ? 'border-emerald-200 bg-emerald-50'
            : draft.status === 'failed'
              ? 'border-red-200 bg-red-50'
              : 'border-[var(--border-soft)] bg-[var(--panel-subtle)]'}
        animate-in fade-in slide-in-from-bottom-1`}
      role="status"
      aria-label={`${getToolbarActionLabel(draft.actionType)} - ${draft.status}`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {/* Status icon */}
        <span
          className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded
            ${draft.status === 'submitting'
              ? 'text-cyan-600 bg-cyan-100'
              : draft.status === 'succeeded'
                ? 'text-emerald-600 bg-emerald-100'
                : draft.status === 'failed'
                  ? 'text-red-600 bg-red-100'
                  : 'text-[var(--muted)] bg-[var(--panel)]'}`}
        >
          {draft.status}
        </span>

        {/* Action label */}
        <span className="text-xs font-medium text-[var(--text)] truncate">
          {getToolbarActionLabel(draft.actionType)}
        </span>

        {/* Error summary */}
        {draft.status === 'failed' && draft.errorSummary && (
          <span className="text-xs text-red-600 truncate" title={draft.errorSummary}>
            {draft.errorSummary}
          </span>
        )}
      </div>

      {/* Actions */}
      {draft.status === 'draft' || draft.status === 'submitting' ? (
        <>
          <button
            type="button"
            onClick={() => onCancel?.(draft.id)}
            className="text-xs text-[var(--muted)] hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
            aria-label="Cancel draft"
          >
            Cancel
          </button>
          {draft.status === 'draft' && (
            <button
              type="button"
              onClick={() => onSubmit?.(draft.id)}
              className="text-xs bg-[var(--sel-bg)] text-[var(--sel-tx)] px-2 py-1 rounded hover:bg-opacity-80 transition-colors"
              aria-label="Submit draft"
            >
              Submit
            </button>
          )}
        </>
      ) : (
        draft.status === 'succeeded' && draft.createdRef && (
          <span className="text-xs text-emerald-600">
            Created {draft.createdRef.type}
          </span>
        )
      )}
    </div>
  )
}
