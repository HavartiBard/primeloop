// ─────────────────────────────────────────────────────────────────────────────
// Agent Activity Timeline (spec 017)
// Ordered expandable chat timeline component with keyboard navigation
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import type { ChatDisplayEvent } from '../../types'
import { AgentActivityBubble } from './AgentActivityBubble'
import { DecisionActivityCard } from './DecisionActivityCard'
import { useExpandableItems } from '../../hooks/useExpandableItems'
import { getTimelineKeyboardHelp, getStatusLabel } from '../../lib/accessibilityText'

/**
 * Props for AgentActivityTimeline
 */
export interface AgentActivityTimelineProps {
  /** Events to display */
  events: ChatDisplayEvent[]
  /** Show empty state */
  showEmptyState?: boolean
  /** On event click handler */
  onEventClick?: (event: ChatDisplayEvent) => void
  /** Loading state */
  isLoading?: boolean
}

/**
 * Agent Activity Timeline Component
 */
export function AgentActivityTimeline({
  events,
  showEmptyState = true,
  onEventClick,
  isLoading = false,
}: AgentActivityTimelineProps) {
  const { expandedIds, toggleExpand } = useExpandableItems(events, {
    initialExpandedIds: [],
  })

  // Keyboard navigation handlers
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (events.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        const nextIndex = Math.min(index + 1, events.length - 1)
        document.getElementById(`event-${nextIndex}`)?.focus()
        break
      case 'ArrowUp':
        e.preventDefault()
        const prevIndex = Math.max(index - 1, 0)
        document.getElementById(`event-${prevIndex}`)?.focus()
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        toggleExpand(events[index].id)
        break
    }
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="p-4 text-center">
        <span className="animate-pulse text-[var(--muted)]">Loading activity...</span>
      </div>
    )
  }

  // Empty state
  if (events.length === 0 && showEmptyState) {
    return (
      <div className="p-6 text-center rounded border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)]/50">
        <p className="text-sm text-[var(--muted)]">No activity yet</p>
        <p className="text-xs text-[var(--muted)] mt-1">
          Waiting for agent activity or tool calls
        </p>
      </div>
    )
  }

  return (
    <div
      role="list"
      aria-label="Agent activity timeline"
      className="space-y-3"
    >
      {/* Keyboard help */}
      <div className="text-xs text-[var(--muted)] mb-2" aria-live="polite">
        {getTimelineKeyboardHelp()}
      </div>

      {/* Events */}
      {events.map((event, index) => (
        <div
          id={`event-${index}`}
          key={event.id}
          role="listitem"
          tabIndex={0}
          onKeyDown={(e) => handleKeyDown(e, index)}
          className="focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)] rounded"
          aria-expanded={expandedIds.has(event.id)}
        >
          {isApprovalOrDelegation(event) ? (
            <DecisionActivityCard
              card={event as any}
              initiallyExpanded={expandedIds.has(event.id)}
              onToggle={(expanded) => toggleExpand(event.id)}
            />
          ) : (
            <AgentActivityBubble
              event={event}
              initiallyExpanded={expandedIds.has(event.id)}
              onToggle={(expanded) => toggleExpand(event.id)}
            />
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Check if event is approval or delegation
 */
function isApprovalOrDelegation(
  event: ChatDisplayEvent,
): event is ChatDisplayEvent & { kind: 'approval' | 'delegation' } {
  return event.kind === 'approval' || event.kind === 'delegation'
}

/**
 * Timeline with status filter
 */
export function FilteredTimeline({
  events,
  filterStatuses,
  ...props
}: AgentActivityTimelineProps & { filterStatuses: string[] }) {
  const filteredEvents = events.filter((e) =>
    filterStatuses.includes(e.status),
  )

  return <AgentActivityTimeline events={filteredEvents} {...props} />
}

/**
 * Timeline with kind filter
 */
export function KindFilteredTimeline({
  events,
  filterKinds,
  ...props
}: AgentActivityTimelineProps & { filterKinds: string[] }) {
  const filteredEvents = events.filter((e) =>
    filterKinds.includes(e.kind),
  )

  return <AgentActivityTimeline events={filteredEvents} {...props} />
}

/**
 * Timeline with loading and error states
 */
export function AsyncTimeline({
  events,
  isLoading,
  isError,
  error,
  ...props
}: AgentActivityTimelineProps & {
  isLoading: boolean
  isError?: boolean
  error?: Error | null
}) {
  if (isError) {
    return (
      <div className="p-4 text-center rounded border border-red-200 bg-red-50">
        <p className="text-sm text-red-600">Failed to load activity</p>
        {error && <p className="text-xs text-red-500 mt-1">{error.message}</p>}
      </div>
    )
  }

  return <AgentActivityTimeline events={events} isLoading={isLoading} {...props} />
}
