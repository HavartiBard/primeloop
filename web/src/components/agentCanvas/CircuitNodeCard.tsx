// ─────────────────────────────────────────────────────────────────────────────
// Circuit Node Card (spec 017)
// Expandable circuit node card for agents, rooms, work items
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import type { CircuitNode } from '../../types'
import { DisplayStatusBadge } from './DisplayStatusBadge'
import { getNodeStatusColorClasses } from '../../lib/displayStatus'
import { getCircuitNodeLabel, getNodeExpansionControlLabel } from '../../lib/accessibilityText'

/**
 * Props for CircuitNodeCard
 */
export interface CircuitNodeCardProps {
  /** Node to display */
  node: CircuitNode
  /** Is selected */
  isSelected?: boolean
  /** Is expanded by default */
  initiallyExpanded?: boolean
  /** On selection change */
  onSelect?: (nodeId: string) => void
  /** On expand/collapse toggle */
  onToggle?: (expanded: boolean) => void
}

/**
 * Circuit Node Card Component
 */
export function CircuitNodeCard({
  node,
  isSelected = false,
  initiallyExpanded = false,
  onSelect,
  onToggle,
}: CircuitNodeCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(initiallyExpanded)

  const handleSelect = () => {
    onSelect?.(node.id)
  }

  const handleToggle = () => {
    const newState = !isExpanded
    setIsExpanded(newState)
    onToggle?.(newState)
  }

  return (
    <div
      className={`relative rounded border transition-all duration-200
        ${getNodeStatusColorClasses(node.status)}
        ${isSelected ? 'ring-2 ring-[var(--sel-bd)] z-10' : ''}
        hover:shadow-lg`}
      style={{
        width: node.type === 'room' ? 192 : 176,
        height: 96,
      }}
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter') handleToggle()
        if (e.key === 'Escape') setIsExpanded(false)
      }}
      aria-label={getCircuitNodeLabel(node)}
      aria-expanded={isExpanded}
    >
      {/* Status dot */}
      <div className="absolute top-2 right-2">
        <div
          className={`w-2.5 h-2.5 rounded-full shadow-sm
            ${getStatusDotClass(node.status)}`}
        />
      </div>

      {/* Content */}
      <div className="p-2.5 h-full flex flex-col justify-between">
        {/* Title */}
        <div>
          <h3 className="font-semibold text-[11px] leading-tight mb-0.5 truncate" title={node.title}>
            {node.title}
          </h3>
          <p className="text-[9px] text-[var(--muted)] truncate">{node.summary}</p>
        </div>

        {/* Chips */}
        <div className="flex flex-wrap gap-1 mt-2">
          {node.collapsedDetails.map((chip, index) => (
            <span
              key={index}
              className="text-[8px] px-1.5 py-0.5 rounded bg-[var(--panel-subtle)] text-[var(--muted)]"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>

      {/* Expand button */}
      {(node.expandedDetails && Object.keys(node.expandedDetails).length > 0) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleToggle()
          }}
          className="absolute bottom-1 right-1 text-[8px] text-[var(--muted)] hover:text-[var(--text)]
            px-1 py-0.5 rounded bg-[var(--panel-subtle)] transition-colors"
          aria-label={getNodeExpansionControlLabel(isExpanded, node.title)}
        >
          {isExpanded ? '▲' : '▼'}
        </button>
      )}

      {/* Expanded details */}
      {isExpanded && node.expandedDetails && (
        <div className="absolute top-full left-0 mt-1 w-[240px] max-h-[300px] overflow-y-auto
          rounded border bg-[var(--panel)] shadow-xl z-20 p-3 animate-in fade-in slide-in-from-top-1">
          <h4 className="text-xs font-semibold mb-2 text-[var(--text)]">Details</h4>
          <div className="space-y-2 text-xs">
            {node.expandedDetails.participants && (
              <div>
                <span className="text-[var(--muted)] block mb-1">Participants</span>
                <div className="flex flex-wrap gap-1">
                  {node.expandedDetails.participants.map((p, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-[var(--panel-subtle)]">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {node.expandedDetails.currentActivity && (
              <div>
                <span className="text-[var(--muted)] block mb-1">Current Activity</span>
                <p className="text-[var(--text)]">{node.expandedDetails.currentActivity}</p>
              </div>
            )}
            {node.expandedDetails.recentOutputs && (
              <div>
                <span className="text-[var(--muted)] block mb-1">Recent Outputs</span>
                <ul className="list-disc list-inside text-[var(--muted)] space-y-0.5">
                  {node.expandedDetails.recentOutputs.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              </div>
            )}
            {node.expandedDetails.pendingApprovals !== undefined && (
              <div>
                <span className="text-[var(--muted)] block mb-1">Pending Approvals</span>
                <p className="text-[var(--text)]">{node.expandedDetails.pendingApprovals}</p>
              </div>
            )}
            {node.expandedDetails.context && (
              <div>
                <span className="text-[var(--muted)] block mb-1">Context</span>
                <ul className="list-disc list-inside text-[var(--muted)] space-y-0.5">
                  {node.expandedDetails.context.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Get status dot class
 */
function getStatusDotClass(status: string): string {
  switch (status) {
    case 'active':
    case 'running':
      return 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
    case 'blocked':
    case 'approval':
      return 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]'
    default:
      return 'bg-gray-400'
  }
}
