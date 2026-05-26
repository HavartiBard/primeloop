// ─────────────────────────────────────────────────────────────────────────────
// Agent Activity Bubble (spec 017)
// Expandable bubbles for thinking, tool calls, results, messages
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import type { ChatDisplayEvent } from '../../types'
import { DisplayStatusBadge } from './DisplayStatusBadge'
import { ContextAttachmentList } from './ContextAttachmentList'
import { getChatEventKindLabel, getStatusLabel, getExpandButtonLabel } from '../../lib/accessibilityText'

/**
 * Props for AgentActivityBubble
 */
export interface AgentActivityBubbleProps {
  /** Event to display */
  event: ChatDisplayEvent
  /** Is expanded by default */
  initiallyExpanded?: boolean
  /** On expand/collapse toggle */
  onToggle?: (expanded: boolean) => void
}

/**
 * Agent Activity Bubble Component
 */
export function AgentActivityBubble({
  event,
  initiallyExpanded = false,
  onToggle,
}: AgentActivityBubbleProps) {
  const [isExpanded, setIsExpanded] = React.useState(initiallyExpanded)

  const handleToggle = () => {
    const newState = !isExpanded
    setIsExpanded(newState)
    onToggle?.(newState)
  }

  return (
    <article
      className="group relative rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3 mb-3
        hover:border-[var(--sel-bd)] transition-colors"
      aria-label={`${getChatEventKindLabel(event.kind)}: ${event.summary}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <DisplayStatusBadge status={event.status} />
          <span className="text-sm font-semibold text-[var(--text)] truncate">
            {event.actorLabel}
          </span>
          <span className="text-xs text-[var(--muted)] whitespace-nowrap">
            {formatTime(event.occurredAt)}
          </span>
        </div>

        {/* Kind badge */}
        <span className="text-[10px] uppercase tracking-wide text-[var(--muted)] bg-[var(--panel)] px-2 py-0.5 rounded">
          {event.kind}
        </span>
      </div>

      {/* Summary */}
      <div className="pl-2 border-l-2 border-[var(--border-soft)]">
        <p className="text-sm text-[var(--text)] leading-relaxed">
          {event.summary}
        </p>
      </div>

      {/* Context attachments */}
      {event.attachments.length > 0 && (
        <ContextAttachmentList attachments={event.attachments} />
      )}

      {/* Expand button */}
      {event.details && (
        <button
          type="button"
          onClick={handleToggle}
          className="mt-2 text-xs text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1
            transition-colors focus:outline-none focus:underline"
          aria-expanded={isExpanded}
          aria-label={getExpandButtonLabel(isExpanded, event.summary)}
        >
          <span>{isExpanded ? 'Show less' : 'Show more'}</span>
          <span className="transform transition-transform duration-200">
            {isExpanded ? '▲' : '▼'}
          </span>
        </button>
      )}

      {/* Expanded details */}
      {isExpanded && event.details && (
        <div className="mt-3 pt-3 border-t border-[var(--border-soft)] animate-in fade-in slide-in-from-top-1">
          <pre className="text-xs text-[var(--muted)] font-mono overflow-auto max-h-64">
            {event.details}
          </pre>
        </div>
      )}

      {/* Actions */}
      {event.actions && event.actions.length > 0 && (
        <div className="mt-3 flex gap-2">
          {event.actions.map((action, index) => (
            <button
              key={index}
              type="button"
              onClick={() => action.handler?.()}
              className="text-xs px-2 py-1 rounded bg-[var(--panel)] hover:bg-[var(--panel-subtle)]
                text-[var(--text)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </article>
  )
}

/**
 * Helper to format time
 */
function formatTime(iso: string): string {
  try {
    const date = new Date(iso)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
