// RecoveryEventCard — Agentic Control Plane (spec 016, T034)
// Shows recovery event details with severity badge and action outcome.

export interface RecoveryEventCardData {
  id: string
  goalId: string
  workItemId: string | null
  detectedCondition: string
  detectedAt: string
  severity: 'low' | 'medium' | 'high' | 'critical' | null
  selectedAction: string
  actionReason: string | null
  resultStatus: 'succeeded' | 'ongoing' | 'failed' | 'escalated' | string
  resultSummary: string | null
  createdAt: string
}

export interface RecoveryEventCardProps {
  event: RecoveryEventCardData | Record<string, unknown>
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeSeverity(value: string | null): RecoveryEventCardData['severity'] {
  if (!value) return null
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'critical') return value
  return null
}

function normalizeEvent(event: RecoveryEventCardProps['event']): RecoveryEventCardData {
  const input = event as Record<string, unknown>
  return {
    id: stringOrNull(input.id) ?? '',
    goalId: stringOrNull(input.goalId) ?? stringOrNull(input.goal_id) ?? '',
    workItemId: stringOrNull(input.workItemId) ?? stringOrNull(input.work_item_id),
    detectedCondition: stringOrNull(input.detectedCondition) ?? stringOrNull(input.detected_condition) ?? 'Condition not specified',
    detectedAt: stringOrNull(input.detectedAt) ?? stringOrNull(input.detected_at) ?? '',
    severity: normalizeSeverity(stringOrNull(input.severity)),
    selectedAction: stringOrNull(input.selectedAction) ?? stringOrNull(input.selected_action) ?? 'retry',
    actionReason: stringOrNull(input.actionReason) ?? stringOrNull(input.action_reason),
    resultStatus: stringOrNull(input.resultStatus) ?? stringOrNull(input.result_status) ?? 'ongoing',
    resultSummary: stringOrNull(input.resultSummary) ?? stringOrNull(input.result_summary),
    createdAt: stringOrNull(input.createdAt) ?? stringOrNull(input.created_at) ?? '',
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function severityBadge(severity: RecoveryEventCardData['severity']): { bg: string; border: string; text: string; label: string } | null {
  if (!severity) return null

  const map = {
    critical: { bg: 'var(--s-blk-bg)', border: 'var(--s-blk-bd)', text: 'var(--s-blk-tx)', label: 'critical' },
    high: { bg: 'var(--s-blk-bg)', border: 'var(--s-blk-bd)', text: 'var(--s-blk-tx)', label: 'high' },
    medium: { bg: 'var(--s-att-bg)', border: 'var(--s-att-bd)', text: 'var(--s-att-tx)', label: 'medium' },
    low: { bg: 'var(--panel-subtle)', border: 'var(--border-soft)', text: 'var(--muted)', label: 'low' },
  }

  return map[severity]
}

function resultBadge(status: string): { bg: string; border: string; text: string; label: string } {
  switch (status) {
    case 'succeeded':
      return { bg: 'var(--s-ok-bg)', border: 'var(--s-ok-bd)', text: 'var(--s-ok-tx)', label: 'succeeded' }
    case 'failed':
      return { bg: 'var(--s-blk-bg)', border: 'var(--s-blk-bd)', text: 'var(--s-blk-tx)', label: 'failed' }
    case 'escalated':
      return { bg: 'var(--s-att-bg)', border: 'var(--s-att-bd)', text: 'var(--s-att-tx)', label: 'escalated' }
    case 'ongoing':
    default:
      return { bg: 'var(--panel-subtle)', border: 'var(--border-soft)', text: 'var(--muted)', label: status || 'ongoing' }
  }
}

export function RecoveryEventCard({ event }: RecoveryEventCardProps) {
  const normalized = normalizeEvent(event)
  const severity = severityBadge(normalized.severity)
  const result = resultBadge(normalized.resultStatus)

  return (
    <div data-testid="recovery-event-card" className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-[var(--text)] truncate">{normalized.detectedCondition}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">
            Action: {normalized.selectedAction} · Detected: {formatDateTime(normalized.detectedAt)}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {severity && (
            <span className="px-1.5 py-0.5 rounded text-[11px] border" style={{ backgroundColor: severity.bg, borderColor: severity.border, color: severity.text }}>
              {severity.label}
            </span>
          )}
          <span className="px-1.5 py-0.5 rounded text-[11px] border" style={{ backgroundColor: result.bg, borderColor: result.border, color: result.text }}>
            {result.label}
          </span>
        </div>
      </div>

      {normalized.resultSummary && <div className="mt-2 text-xs text-[var(--text)]">Result: {normalized.resultSummary}</div>}
      {normalized.actionReason && <div className="mt-1 text-xs text-[var(--muted)]">Reason: {normalized.actionReason}</div>}
    </div>
  )
}
