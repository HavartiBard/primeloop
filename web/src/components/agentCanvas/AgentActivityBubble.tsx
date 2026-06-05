// AgentActivityBubble.tsx - Expandable thinking/tool/message bubble components

import React from 'react'
import type { ChatDisplayEvent } from '../../types'
import { DisplayStatusBadge } from './DisplayStatusBadge'
import { ContextAttachmentList } from './ContextAttachmentList'
import { getStatusA11yText } from '../../lib/displayStatus'

export interface AgentActivityBubbleProps {
  event: ChatDisplayEvent
  isExpanded?: boolean
  onToggleExpand?: () => void
}

export function AgentActivityBubble({
  event,
  isExpanded = false,
  onToggleExpand,
}: AgentActivityBubbleProps): React.ReactNode {
  const { kind, actorLabel, summary, details, attachments, status } = event

  return (
    <div
      className={`flex flex-col gap-2 p-3 rounded-lg border transition-all ${
        isExpanded ? 'bg-gray-50 dark:bg-gray-800/50' : 'bg-white dark:bg-gray-900'
      } ${kind === 'thinking' ? 'border-blue-200 dark:border-blue-800' : kind === 'tool_call' || kind === 'tool_result' ? 'border-indigo-200 dark:border-indigo-800' : 'border-gray-200 dark:border-gray-700'}`}
      role="listitem"
      aria-label={getStatusA11yText(status)}
    >
      {/* Header: actor label and status */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{actorLabel}</span>
        <DisplayStatusBadge status={status} />
      </div>

      {/* Summary (always visible) */}
      <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
        {summary}
      </div>

      {/* Expandable details */}
      {details && (
        <div
          className={`overflow-hidden transition-all duration-200 ease-in-out ${
            isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs text-gray-600 dark:text-gray-400 font-mono whitespace-pre-wrap">
            {details}
          </div>
        </div>
      )}

      {/* Context attachments */}
      {attachments.length > 0 && (
        <ContextAttachmentList attachments={attachments} maxVisible={3} showPreview />
      )}

      {/* Footer: expand toggle */}
      {details && (
        <button
          type="button"
          onClick={onToggleExpand}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1"
          aria-expanded={isExpanded}
          aria-controls={`details-${event.id}`}
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

export default AgentActivityBubble
