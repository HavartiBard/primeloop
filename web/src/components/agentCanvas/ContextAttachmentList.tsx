// ContextAttachmentList.tsx - Reusable context attachment chip/list component

import React from 'react'
import type { ContextAttachment } from '../../types'

export interface ContextAttachmentListProps {
  attachments: ContextAttachment[]
  maxVisible?: number
  showPreview?: boolean
  onOpen?: (attachment: ContextAttachment) => void
}

export function ContextAttachmentList({
  attachments,
  maxVisible = 3,
  showPreview = true,
  onOpen,
}: ContextAttachmentListProps): React.ReactNode {
  if (!attachments || attachments.length === 0) {
    return null
  }

  const visibleAttachments = attachments.slice(0, maxVisible)
  const remainingCount = attachments.length - maxVisible

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {visibleAttachments.map((attachment, index) => (
        <ContextAttachmentChip
          key={`${attachment.id}-${index}`}
          attachment={attachment}
          showPreview={showPreview}
          onClick={() => onOpen?.(attachment)}
        />
      ))}
      {remainingCount > 0 && (
        <span className="text-sm text-gray-500 dark:text-gray-400">
          +{remainingCount} more
        </span>
      )}
    </div>
  )
}

interface ContextAttachmentChipProps {
  attachment: ContextAttachment
  showPreview: boolean
  onClick?: () => void
}

function ContextAttachmentChip({ attachment, showPreview, onClick }: ContextAttachmentChipProps): React.ReactNode {
  const { name, type, availability, previewSummary } = attachment

  // Availability styling
  const availabilityClasses: Record<string, string> = {
    available: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    restricted: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    deleted: 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
    too_large: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    loading: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 animate-pulse',
    error: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  }

  const availabilityClass = availabilityClasses[availability] || availabilityClasses.available

  // Type icon
  const typeIcons: Record<string, string> = {
    file: '📄',
    artifact: '📦',
    goal: '🎯',
    work_item: '📋',
    message: '💬',
    tool_result: '⚙️',
    note: '📝',
    link: '🔗',
    other: '📎',
  }

  const typeIcon = typeIcons[type] || typeIcons.other

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium transition-colors hover:bg-gray-200 dark:hover:bg-gray-600 ${availabilityClass}`}
      aria-label={`Attachment: ${name}, type: ${type}, status: ${availability}`}
    >
      <span>{typeIcon}</span>
      <span className="truncate max-w-[120px]">{name}</span>
      {showPreview && previewSummary && (
        <span className="text-xs opacity-75 truncate max-w-[80px]">({previewSummary})</span>
      )}
    </button>
  )
}

export default ContextAttachmentList
