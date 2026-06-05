// DecisionActivityCard.tsx - Approval and delegation display card components

import React from 'react'
import type { ChatDisplayEvent, DisplayStatus, UserAction } from '../../types'
import { DisplayStatusBadge } from './DisplayStatusBadge'
import { getStatusA11yText } from '../../lib/displayStatus'

export interface DecisionActivityCardProps {
  event: ChatDisplayEvent
  onAction?: (actionType: string) => void
}

export function DecisionActivityCard({
  event,
  onAction,
}: DecisionActivityCardProps): React.ReactNode {
  const { kind, actorLabel, summary, details, status, actions } = event

  // Determine card styling based on kind and status
  const statusColorClass = getStatusColorClass(status)
  const isPending = status === 'pending'

  return (
    <div
      className={`flex flex-col gap-3 p-4 rounded-lg border transition-all ${
        isPending ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700'
      }`}
      role="listitem"
      aria-label={getStatusA11yText(status)}
    >
      {/* Header: actor label and status */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{actorLabel}</span>
        <DisplayStatusBadge status={status} />
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
        {summary}
      </div>

      {/* Details (if available) */}
      {details && (
        <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded p-2">
          {details}
        </div>
      )}

      {/* Action buttons for pending decisions */}
      {isPending && actions && actions.length > 0 && (
        <div className="flex gap-2 mt-2">
          {actions.map((action: UserAction, index: number) => (
            <button
              key={index}
              type="button"
              onClick={() => onAction?.(action.type)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                action.type === 'approve'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : action.type === 'deny'
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : action.type === 'retry'
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-600 hover:bg-gray-700 text-white'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function getStatusColorClass(status: DisplayStatus): string {
  // Status color mapping for cards
  const statusColors: Record<DisplayStatus, string> = {
    pending: 'border-amber-300',
    streaming: 'border-blue-300',
    running: 'border-indigo-300',
    success: 'border-emerald-300',
    failed: 'border-rose-300',
    cancelled: 'border-gray-300',
    timeout: 'border-orange-300',
    blocked: 'border-red-300',
    resolved: 'border-green-300',
    unavailable: 'border-gray-300',
    resumed: 'border-indigo-300',
    recovered: 'border-teal-300',
    risky: 'border-amber-300',
  }
  return statusColors[status] || statusColors.pending
}

export default DecisionActivityCard
