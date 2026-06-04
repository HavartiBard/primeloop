// ─────────────────────────────────────────────────────────────────────────────
// Toolbar Action Composer (spec 017)
// Action composer dialogs for spawn-agent, tool-call, create-goal, etc.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import type { ToolbarActionType, ToolbarDraftAction } from '../../types'
import { AppModal } from '../AppModal'
import {
  getToolbarActionLabel,
  getToolbarActionShortcut,
} from '../../lib/accessibilityText'

/**
 * Props for ToolbarActionComposer
 */
export interface ToolbarActionComposerProps {
  /** Current draft */
  draft: ToolbarDraftAction | null
  /** Open state */
  isOpen: boolean
  /** Close handler */
  onClose: () => void
  /** Update draft handler */
  onUpdateDraft: (updates: Partial<ToolbarDraftAction>) => void
  /** Submit handler */
  onSubmit: () => void
}

/**
 * Toolbar Action Composer Component
 */
export function ToolbarActionComposer({
  draft,
  isOpen,
  onClose,
  onUpdateDraft,
  onSubmit,
}: ToolbarActionComposerProps) {
  if (!draft) return null

  const actionType = draft.actionType

  // Don't render if not open to avoid unnecessary DOM
  if (!isOpen) return null

  return (
    <AppModal
      open={isOpen}
      onClose={onClose}
      eyebrow="Composer"
      title={getToolbarActionLabel(actionType)}
      tone="queued"
      widthClassName="w-[min(560px,100%)]"
      heightClassName="h-[min(88vh,760px)]"
      bodyClassName="min-h-0 flex-1 overflow-y-auto bg-[var(--panel)] p-6"
    >
      {/* Form */}
      <form onSubmit={(e) => { e.preventDefault(); onSubmit() }} className="space-y-4">
        {actionType === 'spawn_agent' && <SpawnAgentForm draft={draft} onUpdateDraft={onUpdateDraft} />}
        {actionType === 'tool_call' && <ToolCallForm draft={draft} onUpdateDraft={onUpdateDraft} />}
        {actionType === 'create_goal' && <CreateGoalForm draft={draft} onUpdateDraft={onUpdateDraft} />}
        {actionType === 'capture_artifact' && <CaptureArtifactForm draft={draft} onUpdateDraft={onUpdateDraft} />}
        {actionType === 'add_note' && <AddNoteForm draft={draft} onUpdateDraft={onUpdateDraft} />}
      </form>

      {/* Footer */}
      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded-md text-sm font-medium text-[var(--muted)]
            hover:text-[var(--text)] hover:bg-[var(--panel-subtle)] transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--sel-bg)]
            text-[var(--sel-tx)] hover:bg-opacity-80 transition-colors"
        >
          {draft.status === 'submitting' ? 'Creating...' : 'Create'}
        </button>
      </div>
    </AppModal>
  )
}

// ─── Form Components ──────────────────────────────────────────────────────────

function SpawnAgentForm({
  draft,
  onUpdateDraft,
}: {
  draft: ToolbarDraftAction
  onUpdateDraft: (updates: Partial<ToolbarDraftAction>) => void
}) {
  return (
    <>
      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          Agent name
        </label>
        <input
          type="text"
          value={(draft.requiredInputs.name as string) || ''}
          onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, name: e.target.value } })}
          className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
            bg-[var(--panel-subtle)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
          placeholder="Enter agent name"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          Runtime family
        </label>
        <select
          value={(draft.requiredInputs.runtime_family as string) || ''}
          onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, runtime_family: e.target.value } })}
          className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
            bg-[var(--panel-subtle)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
        >
          <option value="">Select runtime family</option>
          <option value="docker">Docker</option>
          <option value="local">Local</option>
          <option value="serverless">Serverless</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          Execution mode
        </label>
        <select
          value={(draft.requiredInputs.execution_mode as string) || ''}
          onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, execution_mode: e.target.value } })}
          className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
            bg-[var(--panel-subtle)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
        >
          <option value="">Select execution mode</option>
          <option value="active">Active</option>
          <option value="shadow">Shadow</option>
        </select>
      </div>
    </>
  )
}

function ToolCallForm({
  draft,
  onUpdateDraft,
}: {
  draft: ToolbarDraftAction
  onUpdateDraft: (updates: Partial<ToolbarDraftAction>) => void
}) {
  return (
    <>
      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          Tool name
        </label>
        <input
          type="text"
          value={(draft.requiredInputs.tool_name as string) || ''}
          onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, tool_name: e.target.value } })}
          className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
            bg-[var(--panel-subtle)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
          placeholder="Enter tool name"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          Arguments (JSON)
        </label>
        <textarea
          value={(draft.requiredInputs.arguments as string) || ''}
          onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, arguments: e.target.value } })}
          className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
            bg-[var(--panel-subtle)] text-[var(--text)] font-mono text-xs h-32 focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
          placeholder='{"key": "value"}'
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          Reason
        </label>
        <textarea
          value={(draft.requiredInputs.reason as string) || ''}
          onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, reason: e.target.value } })}
          className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
            bg-[var(--panel-subtle)] text-[var(--text)] h-20 focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
          placeholder="Why do you need this tool?"
        />
      </div>
    </>
  )
}

function CreateGoalForm({
  draft,
  onUpdateDraft,
}: {
  draft: ToolbarDraftAction
  onUpdateDraft: (updates: Partial<ToolbarDraftAction>) => void
}) {
  return (
    <>
      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          Title
        </label>
        <input
          type="text"
          value={(draft.requiredInputs.title as string) || ''}
          onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, title: e.target.value } })}
          className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
            bg-[var(--panel-subtle)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
          placeholder="Enter goal title"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          Intent
        </label>
        <textarea
          value={(draft.requiredInputs.intent as string) || ''}
          onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, intent: e.target.value } })}
          className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
            bg-[var(--panel-subtle)] text-[var(--text)] h-24 focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
          placeholder="What do you want to achieve?"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          Priority
        </label>
        <select
          value={(draft.requiredInputs.priority as string) || 'medium'}
          onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, priority: e.target.value } })}
          className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
            bg-[var(--panel-subtle)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>
    </>
  )
}

function CaptureArtifactForm({
  draft,
  onUpdateDraft,
}: {
  draft: ToolbarDraftAction
  onUpdateDraft: (updates: Partial<ToolbarDraftAction>) => void
}) {
  return (
    <>
      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          Name
        </label>
        <input
          type="text"
          value={(draft.requiredInputs.name as string) || ''}
          onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, name: e.target.value } })}
          className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
            bg-[var(--panel-subtle)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
          placeholder="Enter artifact name"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          Type
        </label>
        <select
          value={(draft.requiredInputs.type as string) || 'text'}
          onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, type: e.target.value } })}
          className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
            bg-[var(--panel-subtle)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
        >
          <option value="text">Text</option>
          <option value="code">Code</option>
          <option value="log">Log</option>
          <option value="image">Image</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          Content
        </label>
        <textarea
          value={(draft.requiredInputs.content as string) || ''}
          onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, content: e.target.value } })}
          className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
            bg-[var(--panel-subtle)] text-[var(--text)] font-mono text-xs h-48 focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
          placeholder="Enter artifact content..."
        />
      </div>
    </>
  )
}

function AddNoteForm({
  draft,
  onUpdateDraft,
}: {
  draft: ToolbarDraftAction
  onUpdateDraft: (updates: Partial<ToolbarDraftAction>) => void
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--muted)] mb-1">
        Note
      </label>
      <textarea
        value={(draft.requiredInputs.content as string) || ''}
        onChange={(e) => onUpdateDraft({ requiredInputs: { ...draft.requiredInputs, content: e.target.value } })}
        className="w-full px-3 py-2 rounded-md border border-[var(--border-soft)]
          bg-[var(--panel-subtle)] text-[var(--text)] h-48 focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
        placeholder="Enter your note..."
      />
    </div>
  )
}
