// ─────────────────────────────────────────────────────────────────────────────
// Display Status Badge (spec 017)
// Status badge for thinking, tool, approval, delegation states
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import type { DisplayStatus } from '../../types'
import { formatStatus, getStatusColorClasses, getStatusIcon } from '../../lib/displayStatus'

// getStatusLabel is used for ARIA, not for display badge itself

/**
 * Props for DisplayStatusBadge
 */
export interface DisplayStatusBadgeProps {
  /** Status to display */
  status: DisplayStatus
  /** Show icon */
  showIcon?: boolean
  /** Show text */
  showText?: boolean
  /** Compact size */
  compact?: boolean
  /** Custom class names */
  className?: string
}

/**
 * Display Status Badge Component
 */
export function DisplayStatusBadge({
  status,
  showIcon = true,
  showText = true,
  compact = false,
  className = '',
}: DisplayStatusBadgeProps) {
  const label = formatStatus(status)
  const colorClasses = getStatusColorClasses(status)

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide
        ${compact ? 'text-[9px] px-1.5 py-0.5' : ''}
        ${colorClasses}
        ${className}
      `}
      role="status"
      aria-label={label}
    >
      {showIcon && <span className="opacity-80">{getStatusIcon(status)}</span>}
      {showText && <span>{formatStatus(status)}</span>}
    </span>
  )
}

/**
 * Status dot only version
 */
export function StatusDot({ status }: { status: DisplayStatus }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${getStatusColorClasses(status).split(' ')[1]} bg-current`}
      role="img"
      aria-label={formatStatus(status)}
    />
  )
}

/**
 * Small compact badge
 */
export function CompactStatusBadge({ status }: { status: DisplayStatus }) {
  return <DisplayStatusBadge status={status} compact showText={false} />
}
