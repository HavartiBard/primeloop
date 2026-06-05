// displayStatus.ts - Reusable status and formatting helpers for agent canvas UX

import { DisplayStatus, ChatEventKind } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Status to visual label mapping
// ─────────────────────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  pending: 'Pending',
  streaming: 'Streaming',
  running: 'Running',
  success: 'Success',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timeout: 'Timeout',
  blocked: 'Blocked',
  resolved: 'Resolved',
  unavailable: 'Unavailable',
  resumed: 'Resumed',
  recovered: 'Recovered',
  risky: 'Risky',
}

// ─────────────────────────────────────────────────────────────────────────────
// Status to color class mapping (Tailwind)
// ─────────────────────────────────────────────────────────────────────────────

export const STATUS_COLOR_CLASSES: Record<DisplayStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  streaming: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  running: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  failed: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  timeout: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  blocked: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  unavailable: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
  resumed: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  recovered: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  risky: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
}

// ─────────────────────────────────────────────────────────────────────────────
// Status to icon mapping (lucide-react icons)
// ─────────────────────────────────────────────────────────────────────────────

export const STATUS_ICONS: Record<DisplayStatus, string> = {
  pending: 'circle-alert',
  streaming: 'loader',
  running: 'play',
  success: 'check-circle',
  failed: 'x-circle',
  cancelled: 'ban',
  timeout: 'clock',
  blocked: 'shield-alert',
  resolved: 'check-check',
  unavailable: 'eye-off',
  resumed: 'play',
  recovered: 'check-check',
  risky: 'shield-alert',
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Get status label by status value
// ─────────────────────────────────────────────────────────────────────────────

export function getStatusLabel(status: DisplayStatus): string {
  return STATUS_LABELS[status] ?? 'Unknown'
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Get status color class by status value
// ─────────────────────────────────────────────────────────────────────────────

export function getStatusColorClass(status: DisplayStatus): string {
  return STATUS_COLOR_CLASSES[status] ?? STATUS_COLOR_CLASSES.pending
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Get status icon by status value
// ─────────────────────────────────────────────────────────────────────────────

export function getStatusIcon(status: DisplayStatus): string {
  return STATUS_ICONS[status] ?? STATUS_ICONS.pending
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Determine if a status is active (streaming/running/pending)
// ─────────────────────────────────────────────────────────────────────────────

export function isStatusActive(status: DisplayStatus): boolean {
  return ['streaming', 'running', 'pending', 'resumed', 'recovered'].includes(status)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Determine if a status is terminal (success/failed/cancelled/timeout/blocked/resolved/unavailable)
// ─────────────────────────────────────────────────────────────────────────────

export function isStatusTerminal(status: DisplayStatus): boolean {
  return ['success', 'failed', 'cancelled', 'timeout', 'blocked', 'resolved', 'unavailable', 'risky'].includes(status)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Format duration from timestamp (e.g., "2m ago")
// ─────────────────────────────────────────────────────────────────────────────

export function formatDurationSince(createdAt: string): string {
  const created = new Date(createdAt).getTime()
  const now = Date.now()
  const diff = now - created

  if (diff < 0) return 'just now'

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return `${seconds}s ago`
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Derive status from ChatEventKind and raw status
// ─────────────────────────────────────────────────────────────────────────────

export function deriveDisplayStatusFromKind(kind: ChatEventKind, rawStatus?: string): DisplayStatus {
  switch (kind) {
    case 'thinking':
      if (rawStatus === 'running') return 'streaming'
      if (rawStatus === 'completed') return 'success'
      if (rawStatus === 'failed') return 'failed'
      return 'pending'
    case 'tool_call':
    case 'tool_result':
      if (rawStatus === 'running') return 'running'
      if (rawStatus === 'completed') return 'success'
      if (rawStatus === 'failed') return 'failed'
      return 'pending'
    case 'approval':
      if (rawStatus === 'pending') return 'pending'
      if (rawStatus === 'approved') return 'resolved'
      if (rawStatus === 'denied') return 'cancelled'
      return 'pending'
    case 'delegation':
      if (['pending', 'queued'].includes(rawStatus || '')) return 'pending'
      if (rawStatus === 'running') return 'running'
      if (rawStatus === 'completed') return 'success'
      if (['failed', 'blocked'].includes(rawStatus || '')) return 'failed'
      if (rawStatus === 'cancelled') return 'cancelled'
      return 'pending'
    default:
      return rawStatus ? (rawStatus as DisplayStatus) : 'success'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Get accessibility text for status badge
// ─────────────────────────────────────────────────────────────────────────────

export function getStatusA11yText(status: DisplayStatus): string {
  const label = getStatusLabel(status)
  if (isStatusActive(status)) return `${label}, active`
  if (isStatusTerminal(status)) return `${label}, complete`
  return label
}
