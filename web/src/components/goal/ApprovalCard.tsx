// ApprovalCard — Agentic Control Plane (spec 016, T035)
// Shows approval request with approve/reject action buttons.

import { useState } from 'react'

const API_ORIGIN = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '')

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled' | string

export interface ApprovalCardData {
  id: string
  goalId: string
  workItemId: string | null
  requestedByAgentRole: string
  actionSummary: string
  riskSummary: string | null
  status: ApprovalStatus
  decisionNotes: string | null
  expiresAt: string
  resolvedAt: string | null
  createdAt: string
}

export interface ApprovalCardProps {
  approval: ApprovalCardData | Record<string, unknown>
  onResolved?: (updated: ApprovalCardData) => void
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeApproval(approval: ApprovalCardProps['approval']): ApprovalCardData {
  const input = approval as Record<string, unknown>
  return {
    id: stringOrNull(input.id) ?? '',
    goalId: stringOrNull(input.goalId) ?? stringOrNull(input.goal_id) ?? '',
    workItemId: stringOrNull(input.workItemId) ?? stringOrNull(input.work_item_id),
    requestedByAgentRole: stringOrNull(input.requestedByAgentRole) ?? stringOrNull(input.requested_by_agent_role) ?? 'unknown',
    actionSummary: stringOrNull(input.actionSummary) ?? stringOrNull(input.action_summary) ?? 'Approval action',
    riskSummary: stringOrNull(input.riskSummary) ?? stringOrNull(input.risk_summary),
    status: stringOrNull(input.status) ?? 'pending',
    decisionNotes: stringOrNull(input.decisionNotes) ?? stringOrNull(input.decision_notes),
    expiresAt: stringOrNull(input.expiresAt) ?? stringOrNull(input.expires_at) ?? '',
    resolvedAt: stringOrNull(input.resolvedAt) ?? stringOrNull(input.resolved_at),
    createdAt: stringOrNull(input.createdAt) ?? stringOrNull(input.created_at) ?? '',
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function statusBadge(status: ApprovalStatus): { bg: string; border: string; text: string; label: string } {
  switch (status) {
    case 'pending':
      return { bg: 'var(--s-att-bg)', border: 'var(--s-att-bd)', text: 'var(--s-att-tx)', label: 'pending' }
    case 'approved':
      return { bg: 'var(--s-ok-bg)', border: 'var(--s-ok-bd)', text: 'var(--s-ok-tx)', label: 'approved' }
    case 'rejected':
      return { bg: 'var(--s-blk-bg)', border: 'var(--s-blk-bd)', text: 'var(--s-blk-tx)', label: 'rejected' }
    case 'expired':
    case 'cancelled':
      return { bg: 'var(--panel-subtle)', border: 'var(--border-soft)', text: 'var(--muted)', label: status }
    default:
      return { bg: 'var(--panel-subtle)', border: 'var(--border-soft)', text: 'var(--muted)', label: status }
  }
}

async function submitDecision(approvalId: string, decision: 'approved' | 'rejected'): Promise<ApprovalCardData> {
  const res = await fetch(`${API_ORIGIN}/api/control-plane/approvals/${approvalId}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return normalizeApproval(await res.json())
}

export function ApprovalCard({ approval, onResolved }: ApprovalCardProps) {
  const normalized = normalizeApproval(approval)
  const [status, setStatus] = useState<ApprovalStatus>(normalized.status)
  const [decisionNotes, setDecisionNotes] = useState<string | null>(normalized.decisionNotes)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const badge = statusBadge(status)
  const isPending = status === 'pending'

  async function handleDecision(decision: 'approved' | 'rejected') {
    if (!isPending || isSubmitting) return
    setIsSubmitting(true)
    setError(null)
    try {
      const updated = await submitDecision(normalized.id, decision)
      setStatus(updated.status)
      setDecisionNotes(updated.decisionNotes)
      onResolved?.(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit decision')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div data-testid="approval-card" className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-[var(--text)] truncate">{normalized.actionSummary}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">Requested by: {normalized.requestedByAgentRole}</div>
        </div>
        <span className="shrink-0 px-1.5 py-0.5 rounded text-[11px] border" style={{ backgroundColor: badge.bg, borderColor: badge.border, color: badge.text }}>
          {badge.label}
        </span>
      </div>

      {normalized.riskSummary && <div className="mt-2 text-xs" style={{ color: 'var(--s-att-tx)' }}>Risk: {normalized.riskSummary}</div>}
      {decisionNotes && <div className="mt-1 text-xs text-[var(--muted)]">Decision: {decisionNotes}</div>}
      <div className="mt-1 text-xs text-[var(--muted)]">Expires: {formatDateTime(normalized.expiresAt)}</div>

      {isPending && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleDecision('approved')}
            className="px-2 py-1 text-xs rounded border"
            style={{ backgroundColor: 'var(--s-ok-bg)', borderColor: 'var(--s-ok-bd)', color: 'var(--s-ok-tx)' }}
          >
            Approve
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void handleDecision('rejected')}
            className="px-2 py-1 text-xs rounded border"
            style={{ backgroundColor: 'var(--s-blk-bg)', borderColor: 'var(--s-blk-bd)', color: 'var(--s-blk-tx)' }}
          >
            Reject
          </button>
        </div>
      )}

      {error && <div className="mt-2 text-xs" style={{ color: 'var(--s-blk-tx)' }}>Failed to submit decision: {error}</div>}
    </div>
  )
}
