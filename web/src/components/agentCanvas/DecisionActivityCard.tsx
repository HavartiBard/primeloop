// ─────────────────────────────────────────────────────────────────────────────
// Decision Activity Card (spec 017)
// Display cards for approvals and delegations
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import type { ApprovalDisplayCard, DelegationDisplayCard } from '../../types'
import { DisplayStatusBadge } from './DisplayStatusBadge'
import { formatStatus } from '../../lib/displayStatus'

/**
 * Props for DecisionActivityCard
 */
export interface DecisionActivityCardProps {
  /** Card data - either approval or delegation */
  card: ApprovalDisplayCard | DelegationDisplayCard
  /** Is expanded by default */
  initiallyExpanded?: boolean
  /** On expand/collapse toggle */
  onToggle?: (expanded: boolean) => void
}

/**
 * Decision Activity Card Component
 */
export function DecisionActivityCard({
  card,
  initiallyExpanded = false,
  onToggle,
}: DecisionActivityCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(initiallyExpanded)

  const handleToggle = () => {
    const newState = !isExpanded
    setIsExpanded(newState)
    onToggle?.(newState)
  }

  return (
    <article
      className="rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3 mb-3
        hover:border-[var(--sel-bd)] transition-colors"
      aria-label={card.status === 'pending' ? 'Action required' : 'Decision record'}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <DisplayStatusBadge status={card.status as any} />
          <span className="text-sm font-semibold text-[var(--text)] truncate">
            {isApprovalCard(card) ? card.requesterLabel : card.sourceLabel}
          </span>
        </div>

        {/* Kind badge */}
        <span className="text-[10px] uppercase tracking-wide text-[var(--muted)] bg-[var(--panel)] px-2 py-0.5 rounded">
          {isApprovalCard(card) ? 'approval' : 'delegation'}
        </span>
      </div>

      {/* Summary */}
      <div className="pl-2 border-l-2 border-[var(--border-soft)]">
        <p className="text-sm text-[var(--text)] leading-relaxed">
          {isApprovalCard(card) ? card.requestSummary : card.objective}
        </p>
      </div>

      {/* Details */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-[var(--border-soft)] animate-in fade-in slide-in-from-top-1">
          {isApprovalCard(card) ? (
            <ApprovalDetails card={card} />
          ) : (
            <DelegationDetails card={card} />
          )}
        </div>
      )}

      {/* Expand button */}
      {(isApprovalCard(card) ? card.rationale || card.decidedBy : card.resultSummary) && (
        <button
          type="button"
          onClick={handleToggle}
          className="mt-2 text-xs text-[var(--muted)] hover:text-[var(--text)] flex items-center gap-1
            transition-colors focus:outline-none focus:underline"
          aria-expanded={isExpanded}
          aria-label={`Show ${isExpanded ? 'less' : 'more'} details`}
        >
          <span>{isExpanded ? 'Show less' : 'Show more'}</span>
          <span className="transform transition-transform duration-200">
            {isExpanded ? '▲' : '▼'}
          </span>
        </button>
      )}

      {/* Actions */}
      {card.status === 'pending' && (
        <div className="mt-3 flex gap-2">
          {isApprovalCard(card) ? (
            <>
              {card.decisionOptions?.includes('approve') && (
                <ActionButton label="Approve" variant="success" />
              )}
              {card.decisionOptions?.includes('deny') && (
                <ActionButton label="Deny" variant="error" />
              )}
            </>
          ) : (
            <>
              <ActionButton label="Retry" variant="neutral" />
              <ActionButton label="Cancel" variant="error" />
            </>
          )}
        </div>
      )}

      {/* Result summary */}
      {card.status !== 'pending' && !isExpanded && (
        <div className="mt-2 text-xs text-[var(--muted)]">
          {isApprovalCard(card) ? (
            card.decidedBy ? (
              <span>
                {card.decidedBy} {card.status === 'approved' ? 'approved' : 'denied'} this request
              </span>
            ) : (
              <span>Decision recorded</span>
            )
          ) : (
            card.resultSummary || <span>Work completed</span>
          )}
        </div>
      )}
    </article>
  )
}

/**
 * Check if card is an approval card
 */
function isApprovalCard(
  card: ApprovalDisplayCard | DelegationDisplayCard,
): card is ApprovalDisplayCard {
  return 'requesterLabel' in card
}

/**
 * Approval details component
 */
function ApprovalDetails({ card }: { card: ApprovalDisplayCard }) {
  return (
    <div className="space-y-2">
      {card.rationale && (
        <div>
          <span className="text-xs font-semibold text-[var(--muted)]">Rationale:</span>
          <p className="text-xs text-[var(--text)] mt-0.5">{card.rationale}</p>
        </div>
      )}
      {card.urgency && (
        <div>
          <span className="text-xs font-semibold text-[var(--muted)]">Urgency:</span>
          <p className="text-xs text-[var(--text)] mt-0.5">{card.urgency}</p>
        </div>
      )}
      {card.decidedBy && card.decidedAt && (
        <div>
          <span className="text-xs font-semibold text-[var(--muted)]">Decision:</span>
          <p className="text-xs text-[var(--text)] mt-0.5">
            {card.decidedBy} decided {formatStatus(card.status as any)} at {new Date(card.decidedAt).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Delegation details component
 */
function DelegationDetails({ card }: { card: DelegationDisplayCard }) {
  return (
    <div className="space-y-2">
      <div>
        <span className="text-xs font-semibold text-[var(--muted)]">Target:</span>
        <p className="text-xs text-[var(--text)] mt-0.5">{card.targetLabel}</p>
      </div>
      {card.resultSummary && (
        <div>
          <span className="text-xs font-semibold text-[var(--muted)]">Result:</span>
          <p className="text-xs text-[var(--text)] mt-0.5">{card.resultSummary}</p>
        </div>
      )}
    </div>
  )
}

/**
 * Action button component
 */
function ActionButton({ label, variant }: { label: string; variant: 'success' | 'error' | 'neutral' }) {
  const variants = {
    success: 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20',
    error: 'bg-red-500/10 text-red-600 hover:bg-red-500/20',
    neutral: 'bg-[var(--panel)] text-[var(--text)] hover:bg-[var(--panel-subtle)]',
  }

  return (
    <button
      type="button"
      className={`text-xs px-3 py-1.5 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]
        ${variants[variant]}`}
    >
      {label}
    </button>
  )
}
