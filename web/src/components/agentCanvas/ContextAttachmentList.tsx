// ─────────────────────────────────────────────────────────────────────────────
// Context Attachment List (spec 017)
// Display list of context attachments with availability indicators
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import type { ContextAttachment } from '../../types'
import { getStatusColorClasses, getStatusDotClass } from '../../lib/displayStatus'
import { getContextAttachmentLabel } from '../../lib/accessibilityText'

/**
 * Props for ContextAttachmentList
 */
export interface ContextAttachmentListProps {
  /** List of attachments */
  attachments: ContextAttachment[]
  /** Show expand affordance */
  showExpand?: boolean
  /** On attachment click handler */
  onAttachmentClick?: (attachment: ContextAttachment) => void
  /** Max attachments to show before truncation */
  maxVisible?: number
}

/**
 * Context Attachment List Component
 */
export function ContextAttachmentList({
  attachments,
  showExpand = false,
  onAttachmentClick,
  maxVisible = 3,
}: ContextAttachmentListProps) {
  if (attachments.length === 0) return null

  const visibleAttachments = attachments.slice(0, maxVisible)
  const remainingCount = attachments.length - maxVisible

  return (
    <div
      className="flex flex-wrap gap-2 mt-2"
      aria-label={`Context attachments: ${attachments.length} items`}
    >
      {visibleAttachments.map((attachment, index) => (
        <AttachmentChip
          key={`${attachment.id || 'att'}-${index}`}
          attachment={attachment}
          onClick={() => onAttachmentClick?.(attachment)}
          showExpand={showExpand}
        />
      ))}

      {remainingCount > 0 && (
        <span className="text-xs text-[var(--muted)] px-2 py-1 rounded bg-[var(--panel-subtle)]">
          +{remainingCount} more
        </span>
      )}
    </div>
  )
}

/**
 * Individual attachment chip component
 */
function AttachmentChip({
  attachment,
  onClick,
  showExpand,
}: {
  attachment: ContextAttachment
  onClick?: () => void
  showExpand?: boolean
}) {
  const isUnavailable =
    attachment.availability === 'restricted' ||
    attachment.availability === 'deleted' ||
    attachment.availability === 'too_large' ||
    attachment.availability === 'error'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-colors
        ${isUnavailable
          ? 'border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)]/10 text-[var(--s-blk-tx)]'
          : getStatusColorClasses(attachment.availability === 'loading' ? 'pending' : 'success')}
        hover:bg-opacity-20 focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]
      `}
      aria-label={getContextAttachmentLabel(attachment.name, attachment.type, attachment.availability)}
    >
      <span className={getStatusDotClass(attachment.availability === 'loading' ? 'pending' : 'success')}>
        {getAvailabilityIcon(attachment.availability)}
      </span>
      <span className="font-medium truncate max-w-[120px]">{attachment.name}</span>
      <span className="text-[var(--muted)] uppercase text-[10px]">{attachment.type}</span>

      {showExpand && (
        <span className="ml-1 text-[10px] opacity-75">▼</span>
      )}
    </button>
  )
}

/**
 * Get availability icon
 */
function getAvailabilityIcon(availability: ContextAttachment['availability']): string {
  switch (availability) {
    case 'available':
      return '✓'
    case 'restricted':
      return '🔒'
    case 'deleted':
      return '✖'
    case 'too_large':
      return '⚡'
    case 'loading':
      return '⟳'
    case 'error':
      return '⚠'
    default:
      return '?'
  }
}
