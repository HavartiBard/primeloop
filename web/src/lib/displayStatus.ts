// ─────────────────────────────────────────────────────────────────────────────
// Display Status Helpers (spec 017)
// Expanded Canvas UX - Status formatting and color mapping
// ─────────────────────────────────────────────────────────────────────────────

import type { DisplayStatus, CircuitNodeStatus } from '../types'

/** Status categories for UI rendering */
export type StatusCategory = 'pending' | 'running' | 'success' | 'error' | 'neutral'

/**
 * Get the status category for a display status
 */
export function getStatusCategory(status: DisplayStatus): StatusCategory {
  switch (status) {
    case 'pending':
    case 'streaming':
    case 'running':
      return 'running'
    case 'success':
    case 'resolved':
      return 'success'
    case 'failed':
    case 'cancelled':
    case 'timeout':
    case 'blocked':
    case 'unavailable':
      return 'error'
    default:
      return 'neutral'
  }
}

/**
 * Get the status category for a circuit node status
 */
export function getNodeStatusCategory(status: CircuitNodeStatus): StatusCategory {
  switch (status) {
    case 'active':
    case 'running':
      return 'success'
    case 'blocked':
    case 'approval':
      return 'error'
    default:
      return 'neutral'
  }
}

/**
 * Format status for display
 */
export function formatStatus(status: DisplayStatus | CircuitNodeStatus): string {
  const formatted = status.toString().replace('_', ' ')
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

/**
 * Get CSS class for status color (Tailwind)
 */
export function getStatusColorClasses(status: DisplayStatus): string {
  const category = getStatusCategory(status)
  switch (category) {
    case 'running':
      return 'text-[var(--s-run-tx)] bg-[var(--s-run-bg)] border-[var(--s-run-bd)]'
    case 'success':
      return 'text-[var(--s-ok-tx)] bg-[var(--s-ok-bg)] border-[var(--s-ok-bd)]'
    case 'error':
      return 'text-[var(--s-blk-tx)] bg-[var(--s-blk-bg)] border-[var(--s-blk-bd)]'
    default:
      return 'text-[var(--s-neu-tx)] bg-[var(--s-neu-bg)] border-[var(--s-neu-bd)]'
  }
}

/**
 * Get CSS class for circuit node status
 */
export function getNodeStatusColorClasses(status: CircuitNodeStatus): string {
  const category = getNodeStatusCategory(status)
  switch (category) {
    case 'running':
      return 'border-cyan-500 bg-cyan-500/10'
    case 'success':
      return 'border-emerald-500 bg-emerald-500/10'
    case 'error':
      return 'border-red-500 bg-red-500/10'
    default:
      return 'border-gray-500 bg-gray-500/10'
  }
}

/**
 * Check if status is terminal (no further updates expected)
 */
export function isTerminalStatus(status: DisplayStatus): boolean {
  return ['success', 'failed', 'cancelled', 'timeout', 'blocked', 'resolved', 'unavailable'].includes(status)
}

/**
 * Check if status indicates activity in progress
 */
export function isActiveStatus(status: DisplayStatus): boolean {
  return ['streaming', 'running'].includes(status)
}

/**
 * Get status icon (simple string for now)
 */
export function getStatusIcon(status: DisplayStatus): string {
  switch (status) {
    case 'pending':
      return '•'
    case 'streaming':
      return '⟳'
    case 'running':
      return '▶'
    case 'success':
      return '✓'
    case 'failed':
      return '✗'
    case 'cancelled':
      return '⊘'
    case 'timeout':
      return '⏱'
    case 'blocked':
      return '⊘'
    case 'resolved':
      return '✓'
    case 'unavailable':
      return '○'
    default:
      return '?'
  }
}

/**
 * Get status description for ARIA labels
 */
export function getStatusDescription(status: DisplayStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending action'
    case 'streaming':
      return 'Streaming content'
    case 'running':
      return 'In progress'
    case 'success':
      return 'Completed successfully'
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
 * Get visual indicator for status (dot color class)
 */
export function getStatusDotClass(status: DisplayStatus): string {
  const category = getStatusCategory(status)
  switch (category) {
    case 'running':
      return 'bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.5)] animate-pulse'
    case 'success':
      return 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
    case 'error':
      return 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]'
    default:
      return 'bg-gray-400'
  }
}
