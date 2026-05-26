// ─────────────────────────────────────────────────────────────────────────────
// Accessibility Text Helpers (spec 017)
// Expanded Canvas UX - Keyboard navigation and ARIA labels
// ─────────────────────────────────────────────────────────────────────────────

import type { ChatEventKind, DisplayStatus, ToolbarActionType } from '../types'

/**
 * Get accessible label for chat event kind
 */
export function getChatEventKindLabel(kind: ChatEventKind): string {
  switch (kind) {
    case 'message':
      return 'Message'
    case 'thinking':
      return 'Thinking update'
    case 'tool_call':
      return 'Tool call'
    case 'tool_result':
      return 'Tool result'
    case 'context_attachment':
      return 'Context attachment'
    case 'approval':
      return 'Approval request'
    case 'delegation':
      return 'Delegation'
    case 'goal':
      return 'Goal update'
    case 'artifact':
      return 'Artifact reference'
    case 'note':
      return 'Note'
    case 'system':
      return 'System message'
    default:
      return kind
  }
}

/**
 * Get accessible label for display status
 */
export function getStatusLabel(status: DisplayStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'streaming':
      return 'Streaming'
    case 'running':
      return 'Running'
    case 'success':
      return 'Success'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    case 'timeout':
      return 'Timed out'
    case 'blocked':
      return 'Blocked'
    case 'resolved':
      return 'Resolved'
    case 'unavailable':
      return 'Unavailable'
    default:
      return status
  }
}

/**
 * Get keyboard shortcut description for toolbar action
 */
export function getToolbarActionShortcut(actionType: ToolbarActionType): string {
  switch (actionType) {
    case 'spawn_agent':
      return 'S'
    case 'tool_call':
      return 'T'
    case 'create_goal':
      return 'G'
    case 'capture_artifact':
      return 'A'
    case 'add_note':
      return 'N'
    default:
      return ''
  }
}

/**
 * Get accessible label for toolbar action
 */
export function getToolbarActionLabel(actionType: ToolbarActionType): string {
  switch (actionType) {
    case 'spawn_agent':
      return 'Spawn agent'
    case 'tool_call':
      return 'Request tool call'
    case 'create_goal':
      return 'Create goal'
    case 'capture_artifact':
      return 'Capture artifact'
    case 'add_note':
      return 'Add note'
    default:
      return actionType
  }
}

/**
 * Get expanded state label for screen readers
 */
export function getExpandedStateLabel(isExpanded: boolean): string {
  return isExpanded ? 'Expanded' : 'Collapsed'
}

/**
 * Get keyboard navigation instructions for timeline
 */
export function getTimelineKeyboardHelp(): string {
  return 'Use arrow keys to navigate between events. Enter or Space to expand/collapse. Escape to collapse all.'
}

/**
 * Get keyboard navigation instructions for canvas
 */
export function getCanvasKeyboardHelp(): string {
  return 'Use arrow keys to pan, +/- to zoom, 0 to reset, F to fit. Click nodes to select. Enter to expand details.'
}

/**
 * Generate live region announcement text for chat event update
 */
export function generateLiveRegionUpdate(
  kind: ChatEventKind,
  status: DisplayStatus,
  actorLabel: string,
): string {
  const kindLabel = getChatEventKindLabel(kind)
  const statusLabel = getStatusLabel(status)
  return `${actorLabel} - ${kindLabel} ${statusLabel}`
}

/**
 * Generate label for expand/collapse button
 */
export function getExpandButtonLabel(isExpanded: boolean, title: string): string {
  return isExpanded ? `Collapse ${title}` : `Expand ${title}`
}

/**
 * Generate label for toolbar action button
 */
export function getToolbarActionButtonLabel(actionType: ToolbarActionType): string {
  const label = getToolbarActionLabel(actionType)
  const shortcut = getToolbarActionShortcut(actionType)
  if (shortcut) {
    return `${label} (${shortcut})`
  }
  return label
}

/**
 * Generate ARIA label for circuit node
 */
export function getCircuitNodeLabel(node: {
  id: string
  type: string
  title: string
  status: string
}): string {
  const { type, title, status } = node
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)
  return `${typeLabel}: ${title}, Status: ${status}`
}

/**
 * Generate ARIA label for context attachment
 */
export function getContextAttachmentLabel(
  name: string,
  type: string,
  availability: string,
): string {
  return `${name} (${type}) - ${availability}`
}

/**
 * Generate label for canvas controls
 */
export function getCanvasControlLabel(action: 'zoomIn' | 'zoomOut' | 'reset' | 'fit'): string {
  switch (action) {
    case 'zoomIn':
      return 'Zoom in'
    case 'zoomOut':
      return 'Zoom out'
    case 'reset':
      return 'Reset view'
    case 'fit':
      return 'Fit to view'
  }
}

/**
 * Generate label for node expansion control
 */
export function getNodeExpansionControlLabel(
  isExpanded: boolean,
  title: string,
): string {
  return isExpanded ? `Hide details for ${title}` : `Show details for ${title}`
}
