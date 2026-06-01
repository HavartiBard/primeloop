// accessibilityText.ts - Shared accessibility helpers for keyboard labels and live-region text

import { DisplayStatus, ChatEventKind } from '../types'
import { getStatusLabel, isStatusActive, isStatusTerminal } from './displayStatus'

// ─────────────────────────────────────────────────────────────────────────────
// Status accessibility text
// ─────────────────────────────────────────────────────────────────────────────

export function getStatusA11yText(status: DisplayStatus): string {
  const label = getStatusLabel(status)
  if (isStatusActive(status)) return `${label}, active`
  if (isStatusTerminal(status)) return `${label}, complete`
  return label
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat event accessibility text
// ─────────────────────────────────────────────────────────────────────────────

export function getChatEventA11yText(event: {
  kind: ChatEventKind
  actorLabel: string
  summary: string
  status: DisplayStatus
}): string {
  const statusText = getStatusA11yText(event.status)
  return `${event.kind}, from ${event.actorLabel}. ${statusText}. ${event.summary}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Expandable section accessibility text
// ─────────────────────────────────────────────────────────────────────────────

export function getExpandButtonA11yText(isExpanded: boolean, label: string): string {
  return isExpanded ? `Collapse ${label}` : `Expand ${label}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Card accessibility text
// ─────────────────────────────────────────────────────────────────────────────

export function getCardA11yText(title: string, status: DisplayStatus): string {
  const statusText = getStatusA11yText(status)
  return `${title}, ${statusText}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Button accessibility text
// ─────────────────────────────────────────────────────────────────────────────

export function getActionA11yText(action: {
  label: string
  type: string
  disabled?: boolean
}): string {
  const base = action.label
  if (action.disabled) return `${base}, disabled`
  return base
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar accessibility text
// ─────────────────────────────────────────────────────────────────────────────

export function getToolbarA11yText(actions: Array<{ label: string; type: string }>): string {
  const actionNames = actions.map(a => a.label).join(', ')
  return `Toolbar actions: ${actionNames}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline accessibility text
// ─────────────────────────────────────────────────────────────────────────────

export function getTimelineA11yText(totalEvents: number, currentEventIndex: number): string {
  return `Timeline with ${totalEvents} events. Currently focused on event ${currentEventIndex + 1} of ${totalEvents}.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Live region announcement text
// ─────────────────────────────────────────────────────────────────────────────

export function getLiveRegionAnnouncement(event: {
  kind: ChatEventKind
  actorLabel: string
  summary: string
  status: DisplayStatus
}): string {
  return `${event.actorLabel} ${event.kind}: ${event.summary}. Status: ${getStatusLabel(event.status)}.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyboard navigation hints
// ─────────────────────────────────────────────────────────────────────────────

export const KEYBOARD_HINTS = {
  expand: 'Press Enter or Space to expand/collapse',
  navigate: 'Use Up/Down arrows to navigate events',
  focusToolbar: 'Press Tab to move to toolbar actions',
  close: 'Press Escape to close modals or collapse expanded items',
}

// ─────────────────────────────────────────────────────────────────────────────
// Focus management text
// ─────────────────────────────────────────────────────────────────────────────

export function getFocusManagementText(componentName: string): string {
  return `${componentName} focused. Use arrow keys to navigate, Enter to activate.`
}

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar action accessibility text
// ─────────────────────────────────────────────────────────────────────────────

export function getToolbarActionLabel(actionType: string): string {
  const labels: Record<string, string> = {
    spawn_agent: 'Spawn Agent',
    tool_call: 'Tool Call',
    create_goal: 'Create Goal',
    capture_artifact: 'Capture Artifact',
    add_note: 'Add Note',
  }
  return labels[actionType] || actionType
}

export function getToolbarActionShortcut(actionType: string): string | null {
  const shortcuts: Record<string, string> = {
    spawn_agent: 'A',
    tool_call: 'T',
    create_goal: 'G',
    capture_artifact: 'R',
    add_note: 'N',
  }
  return shortcuts[actionType] || null
}
