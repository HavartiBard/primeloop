// WorkItemCard — Agentic Control Plane (spec 016, T025)
// Shows work item details with role, domain, and status badges.

export type WorkItemCardStatus =
  | 'queued'
  | 'in_progress'
  | 'awaiting_approval'
  | 'blocked'
  | 'retrying'
  | 'escalated'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface WorkItemCardData {
  id: string
  title: string
  assignedAgentRole: string
  domain: string
  status: WorkItemCardStatus
  scope?: string | null
  outcomeSummary?: string | null
  failureReason?: string | null
  updatedAt?: string | null
}

export interface WorkItemCardProps {
  item: WorkItemCardData | Record<string, unknown>
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function normalizeItem(item: WorkItemCardProps['item']): WorkItemCardData {
  const input = item as Record<string, unknown>
  const status = (stringOrNull(input.status) ?? 'queued') as WorkItemCardStatus
  return {
    id: stringOrNull(input.id) ?? '',
    title: stringOrNull(input.title) ?? 'Untitled work item',
    assignedAgentRole: stringOrNull(input.assignedAgentRole) ?? stringOrNull(input.assigned_agent_role) ?? 'unassigned',
    domain: stringOrNull(input.domain) ?? 'cross_domain',
    status,
    scope: stringOrNull(input.scope),
    outcomeSummary: stringOrNull(input.outcomeSummary) ?? stringOrNull(input.outcome_summary),
    failureReason: stringOrNull(input.failureReason) ?? stringOrNull(input.failure_reason),
    updatedAt: stringOrNull(input.updatedAt) ?? stringOrNull(input.updated_at),
  }
}

function statusBadge(status: WorkItemCardStatus): { bg: string; border: string; text: string; label: string } {
  switch (status) {
    case 'completed':
      return { bg: 'var(--s-ok-bg)', border: 'var(--s-ok-bd)', text: 'var(--s-ok-tx)', label: 'completed' }
    case 'failed':
      return { bg: 'var(--s-blk-bg)', border: 'var(--s-blk-bd)', text: 'var(--s-blk-tx)', label: 'failed' }
    case 'cancelled':
      return { bg: 'var(--panel-subtle)', border: 'var(--border-soft)', text: 'var(--muted)', label: 'cancelled' }
    case 'blocked':
      return { bg: 'var(--s-blk-bg)', border: 'var(--s-blk-bd)', text: 'var(--s-blk-tx)', label: 'blocked' }
    case 'awaiting_approval':
      return { bg: 'var(--s-att-bg)', border: 'var(--s-att-bd)', text: 'var(--s-att-tx)', label: 'awaiting approval' }
    case 'in_progress':
      return { bg: 'var(--sel-bg)', border: 'var(--sel-bd)', text: '#60a5fa', label: 'in progress' }
    case 'retrying':
      return { bg: 'var(--s-att-bg)', border: 'var(--s-att-bd)', text: 'var(--s-att-tx)', label: 'retrying' }
    case 'escalated':
      return { bg: 'var(--s-blk-bg)', border: 'var(--s-blk-bd)', text: 'var(--s-blk-tx)', label: 'escalated' }
    case 'queued':
    default:
      return { bg: 'var(--panel-subtle)', border: 'var(--border-soft)', text: 'var(--muted)', label: 'queued' }
  }
}

function domainBadge(domain: string): { bg: string; border: string; text: string; label: string } {
  const labels: Record<string, string> = {
    homelab: 'homelab',
    development: 'development',
    personal_assistant: 'personal assistant',
    cross_domain: 'cross-domain',
  }

  return {
    bg: 'var(--panel-subtle)',
    border: 'var(--border-soft)',
    text: 'var(--muted)',
    label: labels[domain] ?? domain,
  }
}

export function WorkItemCard({ item }: WorkItemCardProps) {
  const normalized = normalizeItem(item)
  const status = statusBadge(normalized.status)
  const domain = domainBadge(normalized.domain)

  return (
    <div data-testid="work-item-card" className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--text)] truncate">{normalized.title}</div>
          {normalized.scope && (
            <div className="mt-1 text-xs text-[var(--muted)] line-clamp-2">{normalized.scope}</div>
          )}
        </div>
        <span
          className="shrink-0 px-1.5 py-0.5 rounded text-[11px] border"
          style={{ backgroundColor: status.bg, borderColor: status.border, color: status.text }}
        >
          {status.label}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
        <span className="px-1.5 py-0.5 rounded border" style={{ backgroundColor: domain.bg, borderColor: domain.border, color: domain.text }}>
          {domain.label}
        </span>
        <span className="font-mono">{normalized.assignedAgentRole}</span>
      </div>

      {normalized.outcomeSummary && (
        <div className="mt-2 text-xs text-[var(--text)]">Outcome: {normalized.outcomeSummary}</div>
      )}
      {normalized.failureReason && (
        <div className="mt-1 text-xs" style={{ color: 'var(--s-blk-tx)' }}>Failure: {normalized.failureReason}</div>
      )}
    </div>
  )
}
