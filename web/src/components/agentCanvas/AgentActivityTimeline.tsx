// AgentActivityTimeline.tsx - Ordered expandable chat timeline component with keyboard navigation and live update states

import React, { useState, useEffect, useCallback } from 'react'
import { ChatDisplayEvent } from '../../src/types'
import { AgentActivityBubble } from './AgentActivityBubble'
import { DecisionActivityCard } from './DecisionActivityCard'
import { getTimelineA11yText, KEYBOARD_HINTS } from '../../lib/accessibilityText'

export interface AgentActivityTimelineProps {
  events: ChatDisplayEvent[]
  onAction?: (actionType: string, eventId: string) => void
}

export function AgentActivityTimeline({
  events,
  onAction,
}: AgentActivityTimelineProps): React.ReactNode {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [focusedIndex, setFocusedIndex] = useState<number>(0)

  // Sort events by occurredAt
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  )

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (sortedEvents.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex(prev => Math.min(prev + 1, sortedEvents.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex(prev => Math.max(prev - 1, 0))
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          toggleExpand(sortedEvents[focusedIndex].id)
          break
        case 'Home':
          e.preventDefault()
          setFocusedIndex(0)
          break
        case 'End':
          e.preventDefault()
          setFocusedIndex(sortedEvents.length - 1)
          break
      }
    },
    [sortedEvents, focusedIndex]
  )

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // Focus management for keyboard navigation
  useEffect(() => {
    const element = document.getElementById(`event-${sortedEvents[focusedIndex]?.id}`)
    if (element) {
      element.focus()
    }
  }, [focusedIndex, sortedEvents])

  if (sortedEvents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
        <p>No activity yet</p>
        <p className="text-sm mt-1">Waiting for agent activity...</p>
      </div>
    )
  }

  return (
    <div
      role="list"
      aria-label={getTimelineA11yText(sortedEvents.length, focusedIndex)}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-3 outline-none"
    >
      {sortedEvents.map((event, index) => {
        const isExpanded = expandedIds.has(event.id)
        const isFocused = index === focusedIndex

        const CardComponent =
          event.kind === 'approval' || event.kind === 'delegation'
            ? DecisionActivityCard
            : AgentActivityBubble

        return (
          <div
            key={event.id}
            id={`event-${event.id}`}
            role="listitem"
            tabIndex={-1}
            aria-current={isFocused ? 'true' : undefined}
            className={`focus:ring-2 focus:ring-blue-500 rounded-lg transition-colors ${
              isFocused ? 'bg-blue-50 dark:bg-blue-900/20' : ''
            }`}
          >
            <CardComponent
              event={event}
              isExpanded={isExpanded}
              onToggleExpand={() => toggleExpand(event.id)}
              onAction={(actionType) => onAction?.(actionType, event.id)}
            />
          </div>
        )
      })}

      {/* Keyboard hints */}
      <div className="mt-4 text-xs text-gray-500 dark:text-gray-400 border-t pt-2">
        {KEYBOARD_HINTS.navigate}
      </div>
    </div>
  )
}

export default AgentActivityTimeline
