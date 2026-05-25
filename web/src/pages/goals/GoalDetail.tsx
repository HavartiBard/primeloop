// GoalDetail — Agentic Control Plane (spec 016, T018/T026/T036)
// Shows full goal detail with delegated work, approvals, recovery events, and learning records.

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { WorkItemCard, type WorkItemCardData, type WorkItemCardStatus } from '../../components/goal/WorkItemCard'
import { ApprovalCard, type ApprovalCardData } from '../../components/goal/ApprovalCard'
import { RecoveryEventCard, type RecoveryEventCardData } from '../../components/goal/RecoveryEventCard'
import { StatusTimeline, type TimelineEvent } from '../../components/goal/StatusTimeline'
import { useControlPlaneEvents } from '../../hooks/useControlPlaneEvents'

type GoalStatus =
  | 'draft'
  | 'queued'
  | 'in_progress'
  | 'awaiting_approval'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

type WorkItemStatus = WorkItemCardStatus
type Priority = 'low' | 'normal' | 'high'

interface GoalWorkItem {
  id: string
  goalId: string
  parentWorkItemId: string | null
  assignedAgentRole: string
  domain: string
  title: string
  scope: string
  status: WorkItemStatus
  priority: Priority
  dependsOn: string[] | null
  decisionSummary: string | null
  outcomeSummary: string | null
  failureReason: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

interface GoalApproval extends ApprovalCardData {}
interface RecoveryEvent extends RecoveryEventCardData {}
interface LearningRecord {
  id: string
  goalId: string
  workItemId: string | null
  category: string
  signalType: string
  observation: string
  recommendation: string | null
  confidence: 'low' | 'medium' | 'high' | null
  createdAt: string
}

interface GoalDetail {
  id: string
  title: string
  status: GoalStatus
  priority: Priority
  currentSummary: string
  updatedAt: string
  intent: string
  resultSummary?: string | null
  riskSummary?: string | null
  workItems: GoalWorkItem[]
  approvals: GoalApproval[]
  recoveryEvents: RecoveryEvent[]
}

interface WorkItemState {
  byId: Record<string, WorkItemCardData>
  order: string[]
}

const API_ORIGIN = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '')

function extractGoalId(): string | null {
  const match = window.location.pathname.match(/\/goals\/([^/?]+)/)
  return match?.[1] ?? null
}

function getStatusBadge(status: GoalStatus): { bg: string; border: string; text: string; label: string } {
  switch (status) {
    case 'completed': return { bg: 'var(--s-ok-bg)', border: 'var(--s-ok-bd)', text: 'var(--s-ok-tx)', label: 'completed' }
    case 'failed': return { bg: 'var(--s-blk-bg)', border: 'var(--s-blk-bd)', text: 'var(--s-blk-tx)', label: 'failed' }
    case 'cancelled': return { bg: 'var(--panel-subtle)', border: 'var(--border-soft)', text: 'var(--muted)', label: 'cancelled' }
    case 'blocked': return { bg: 'var(--s-blk-bg)', border: 'var(--s-blk-bd)', text: 'var(--s-blk-tx)', label: 'blocked' }
    case 'awaiting_approval': return { bg: 'var(--s-att-bg)', border: 'var(--s-att-bd)', text: 'var(--s-att-tx)', label: 'awaiting approval' }
    case 'in_progress': return { bg: 'var(--sel-bg)', border: 'var(--sel-bd)', text: '#60a5fa', label: 'in progress' }
    case 'queued':
    case 'draft':
      return { bg: 'var(--panel-subtle)', border: 'var(--border-soft)', text: 'var(--muted)', label: status }
  }
}

function getPriorityBadge(priority: Priority): { bg: string; border: string; text: string; label: string } {
  switch (priority) {
    case 'high': return { bg: 'var(--s-blk-bg)', border: 'var(--s-blk-bd)', text: 'var(--s-blk-tx)', label: 'high' }
    case 'normal': return { bg: 'var(--panel-subtle)', border: 'var(--border-soft)', text: 'var(--muted)', label: 'normal' }
    case 'low': return { bg: 'var(--panel-subtle)', border: 'var(--border-soft)', text: 'var(--muted)', label: 'low' }
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function mapWorkItem(item: GoalWorkItem): WorkItemCardData {
  return {
    id: item.id,
    title: item.title,
    assignedAgentRole: item.assignedAgentRole,
    domain: item.domain,
    status: item.status,
    scope: item.scope,
    outcomeSummary: item.outcomeSummary,
    failureReason: item.failureReason,
    updatedAt: item.updatedAt,
  }
}

function toWorkItemState(items: GoalWorkItem[]): WorkItemState {
  const byId: Record<string, WorkItemCardData> = {}
  const order: string[] = []
  for (const item of items) {
    const mapped = mapWorkItem(item)
    byId[mapped.id] = mapped
    order.push(mapped.id)
  }
  return { byId, order }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

async function fetchGoalDetail(goalId: string): Promise<GoalDetail> {
  const res = await fetch(`${API_ORIGIN}/api/control-plane/goals/${goalId}`)
  if (!res.ok) {
    if (res.status === 404) {
      const err = new Error('Goal not found')
      ;(err as Error & { status?: number }).status = 404
      throw err
    }
    throw new Error(`HTTP ${res.status}`)
  }
  return res.json()
}

async function fetchGoalLearningRecords(goalId: string): Promise<LearningRecord[]> {
  const res = await fetch(`${API_ORIGIN}/api/control-plane/goals/${goalId}/learning-records`)
  if (res.status === 404) return []
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const payload = await res.json() as { learningRecords?: LearningRecord[] } | LearningRecord[]
  if (Array.isArray(payload)) return payload
  return payload.learningRecords ?? []
}

function SkeletonBlock({ lines = 3 }: { lines?: number }) {
  return <div className="space-y-2">{Array.from({ length: lines }).map((_, i) => <div key={i} className="h-4 rounded bg-[var(--panel-subtle)] animate-pulse" style={{ width: `${75 + Math.random() * 25}%` }} />)}</div>
}

function LoadingSkeleton() {
  return <div className="p-4 space-y-6"><div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5"><div className="flex items-center gap-3 mb-4"><div className="h-6 w-48 rounded bg-[var(--panel-subtle)] animate-pulse" /><div className="h-5 w-24 rounded-full bg-[var(--panel-subtle)] animate-pulse" /></div><SkeletonBlock lines={2} /></div><div className="grid gap-5 xl:grid-cols-2"><div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5"><div className="h-4 w-24 rounded bg-[var(--panel-subtle)] animate-pulse mb-3" /><SkeletonBlock lines={3} /></div><div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5"><div className="h-4 w-32 rounded bg-[var(--panel-subtle)] animate-pulse mb-3" /><SkeletonBlock lines={4} /></div></div></div>
}

export function GoalDetail() {
  const goalId = extractGoalId()
  const { lastEvent } = useControlPlaneEvents()
  const [workItemState, setWorkItemState] = useState<WorkItemState>({ byId: {}, order: [] })
  const [approvals, setApprovals] = useState<GoalApproval[]>([])
  const [recoveryEvents, setRecoveryEvents] = useState<RecoveryEvent[]>([])
  const [learningRecords, setLearningRecords] = useState<LearningRecord[]>([])

  const { data, isLoading, isError, error } = useQuery<GoalDetail>({
    queryKey: ['goal-detail', goalId],
    queryFn: () => fetchGoalDetail(goalId!),
    enabled: goalId != null,
    retry: (attempt, err) => (err as Error & { status?: number })?.status === 404 ? false : attempt < 2,
  })

  const { data: fetchedLearningRecords } = useQuery<LearningRecord[]>({
    queryKey: ['goal-learning-records', goalId],
    queryFn: () => fetchGoalLearningRecords(goalId!),
    enabled: goalId != null,
    retry: 1,
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (!data) return
    setWorkItemState(toWorkItemState(data.workItems))
    setApprovals(data.approvals)
    setRecoveryEvents(data.recoveryEvents)
  }, [data])

  useEffect(() => {
    if (!fetchedLearningRecords) return
    setLearningRecords(fetchedLearningRecords)
  }, [fetchedLearningRecords])

  useEffect(() => {
    if (!goalId || !lastEvent || lastEvent.goalId !== goalId) return

    const payload = lastEvent.payload as Record<string, unknown>

    if (lastEvent.type === 'work-item.created' || lastEvent.type === 'work-item.updated') {
      const workItemId = stringOrNull(payload.workItemId) ?? stringOrNull(payload.work_item_id)
      if (!workItemId) return

      setWorkItemState((prev) => {
        const existing = prev.byId[workItemId]
        const next: WorkItemCardData = {
          id: workItemId,
          title: stringOrNull(payload.title) ?? existing?.title ?? 'Untitled work item',
          assignedAgentRole:
            stringOrNull(payload.assignedAgentRole)
            ?? stringOrNull(payload.assigned_agent_role)
            ?? existing?.assignedAgentRole
            ?? 'unassigned',
          domain: stringOrNull(payload.domain) ?? existing?.domain ?? 'cross_domain',
          status: ((stringOrNull(payload.status) ?? existing?.status ?? 'queued') as WorkItemStatus),
          scope: stringOrNull(payload.scope) ?? existing?.scope ?? null,
          outcomeSummary: stringOrNull(payload.outcomeSummary) ?? stringOrNull(payload.outcome_summary) ?? existing?.outcomeSummary ?? null,
          failureReason: stringOrNull(payload.failureReason) ?? stringOrNull(payload.failure_reason) ?? existing?.failureReason ?? null,
          updatedAt: lastEvent.occurredAt,
        }
        return {
          byId: { ...prev.byId, [workItemId]: next },
          order: prev.order.includes(workItemId) ? prev.order : [workItemId, ...prev.order],
        }
      })
      return
    }

    if (lastEvent.type === 'approval.requested') {
      const approvalId = stringOrNull(payload.approvalId) ?? stringOrNull(payload.approval_id)
      if (!approvalId) return
      setApprovals((prev) => {
        const existing = prev.find((item) => item.id === approvalId)
        const next: GoalApproval = {
          id: approvalId,
          goalId,
          workItemId: existing?.workItemId ?? null,
          requestedByAgentRole: existing?.requestedByAgentRole ?? 'prime',
          actionSummary: stringOrNull(payload.actionSummary) ?? stringOrNull(payload.action_summary) ?? existing?.actionSummary ?? 'Approval requested',
          riskSummary: stringOrNull(payload.riskSummary) ?? stringOrNull(payload.risk_summary) ?? existing?.riskSummary ?? null,
          status: 'pending',
          decisionNotes: null,
          expiresAt: stringOrNull(payload.expiresAt) ?? stringOrNull(payload.expires_at) ?? existing?.expiresAt ?? '',
          resolvedAt: null,
          createdAt: existing?.createdAt ?? lastEvent.occurredAt,
        }
        return existing ? prev.map((item) => item.id === approvalId ? { ...item, ...next } : item) : [next, ...prev]
      })
      return
    }

    if (lastEvent.type === 'approval.resolved') {
      const approvalId = stringOrNull(payload.approvalId) ?? stringOrNull(payload.approval_id)
      if (!approvalId) return
      setApprovals((prev) => prev.map((item) => item.id === approvalId
        ? {
          ...item,
          status: stringOrNull(payload.status) ?? item.status,
          decisionNotes: stringOrNull(payload.decisionNotes) ?? stringOrNull(payload.decision_notes) ?? item.decisionNotes,
          resolvedAt: lastEvent.occurredAt,
        }
        : item))
      return
    }

    if (lastEvent.type === 'recovery.recorded') {
      const recoveryEventId = stringOrNull(payload.recoveryEventId) ?? stringOrNull(payload.recovery_event_id)
      if (!recoveryEventId) return
      setRecoveryEvents((prev) => {
        const existing = prev.find((item) => item.id === recoveryEventId)
        const next: RecoveryEvent = {
          id: recoveryEventId,
          goalId,
          workItemId: existing?.workItemId ?? null,
          detectedCondition: stringOrNull(payload.detectedCondition) ?? stringOrNull(payload.detected_condition) ?? existing?.detectedCondition ?? 'Unknown condition',
          detectedAt: existing?.detectedAt ?? lastEvent.occurredAt,
          severity: (stringOrNull(payload.severity) as RecoveryEvent['severity']) ?? existing?.severity ?? null,
          selectedAction: stringOrNull(payload.selectedAction) ?? stringOrNull(payload.selected_action) ?? existing?.selectedAction ?? 'retry',
          actionReason: stringOrNull(payload.actionReason) ?? stringOrNull(payload.action_reason) ?? existing?.actionReason ?? null,
          resultStatus: stringOrNull(payload.resultStatus) ?? stringOrNull(payload.result_status) ?? existing?.resultStatus ?? 'ongoing',
          resultSummary: stringOrNull(payload.resultSummary) ?? stringOrNull(payload.result_summary) ?? existing?.resultSummary ?? null,
          createdAt: existing?.createdAt ?? lastEvent.occurredAt,
        }
        return existing ? prev.map((item) => item.id === recoveryEventId ? { ...item, ...next } : item) : [next, ...prev]
      })
      return
    }

    if (lastEvent.type === 'learning-record.created') {
      const learningRecordId = stringOrNull(payload.learningRecordId) ?? stringOrNull(payload.learning_record_id)
      if (!learningRecordId) return
      setLearningRecords((prev) => {
        const existing = prev.find((item) => item.id === learningRecordId)
        const next: LearningRecord = {
          id: learningRecordId,
          goalId,
          workItemId: existing?.workItemId ?? null,
          category: stringOrNull(payload.category) ?? existing?.category ?? 'recovery',
          signalType: stringOrNull(payload.signalType) ?? stringOrNull(payload.signal_type) ?? existing?.signalType ?? 'failure',
          observation: existing?.observation ?? 'Learning record captured from execution outcome.',
          recommendation: existing?.recommendation ?? null,
          confidence: (stringOrNull(payload.confidence) as LearningRecord['confidence']) ?? existing?.confidence ?? null,
          createdAt: existing?.createdAt ?? lastEvent.occurredAt,
        }
        return existing ? prev.map((item) => item.id === learningRecordId ? { ...item, ...next } : item) : [next, ...prev]
      })
    }
  }, [goalId, lastEvent])

  const groupedWorkItems = useMemo(() => {
    const groups: Record<WorkItemStatus, WorkItemCardData[]> = {
      in_progress: [], queued: [], awaiting_approval: [], blocked: [], retrying: [], escalated: [], completed: [], failed: [], cancelled: [],
    }
    for (const id of workItemState.order) {
      const item = workItemState.byId[id]
      if (!item) continue
      groups[item.status]?.push(item)
    }
    return groups
  }, [workItemState])

  const groupOrder: WorkItemStatus[] = ['in_progress', 'queued', 'awaiting_approval', 'blocked', 'retrying', 'escalated', 'completed', 'failed', 'cancelled']

  const timeline = useMemo<TimelineEvent[]>(() => {
    if (!data) return []
    const events: TimelineEvent[] = [
      {
        id: `goal:${data.id}:${data.status}`,
        label: `Goal is ${data.status.replace('_', ' ')}`,
        timestamp: data.updatedAt,
        detail: data.currentSummary || undefined,
        tone: data.status === 'completed' ? 'ok' : data.status === 'failed' || data.status === 'blocked' ? 'risk' : data.status === 'awaiting_approval' ? 'warn' : 'neutral',
      },
    ]

    if (workItemState.order.length > 0) {
      const firstWorkItem = workItemState.order
        .map((id) => workItemState.byId[id])
        .find((item) => Boolean(item))
      if (firstWorkItem) {
        events.push({
          id: `delegation:${firstWorkItem.id}`,
          label: `Delegation started: ${firstWorkItem.title}`,
          timestamp: firstWorkItem.updatedAt ?? null,
          tone: 'neutral',
        })
      }
    }

    if (approvals.some((item) => item.status === 'pending')) {
      const pending = approvals.find((item) => item.status === 'pending')
      events.push({
        id: `approval:${pending?.id ?? 'pending'}`,
        label: 'Awaiting operator approval',
        timestamp: pending?.createdAt ?? null,
        detail: pending?.actionSummary,
        tone: 'warn',
      })
    }

    if (recoveryEvents.length > 0) {
      const latest = recoveryEvents[0]
      events.push({
        id: `recovery:${latest.id}`,
        label: `Recovery action: ${latest.selectedAction.replace('_', ' ')}`,
        timestamp: latest.createdAt,
        detail: latest.resultSummary ?? undefined,
        tone: latest.resultStatus === 'succeeded' ? 'ok' : 'risk',
      })
    }

    return events.sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime())
  }, [data, workItemState, approvals, recoveryEvents])

  if (!goalId) return <div className="p-4"><div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5"><h2 className="text-sm text-[var(--muted)] mb-3">Goal detail</h2><p className="text-sm text-[var(--muted)]">No goal ID provided in the URL.</p><button onClick={() => window.history.back()} className="mt-4 px-3 py-1.5 text-xs bg-[var(--sel-bg)] border border-[var(--sel-bd)] text-blue-400 rounded hover:bg-blue-500/20">← Back</button></div></div>
  if (isLoading) return <LoadingSkeleton />
  if (isError) {
    const isNotFound = (error as Error & { status?: number })?.status === 404
    return <div className="p-4"><div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5"><h2 className="text-sm text-[var(--muted)] mb-3">Goal detail</h2>{isNotFound ? <p className="text-sm" style={{ color: 'var(--s-blk-tx)' }}>Goal not found.</p> : <p className="text-sm" style={{ color: 'var(--s-blk-tx)' }}>Failed to load goal details.</p>}<button onClick={() => window.history.back()} className="mt-4 px-3 py-1.5 text-xs bg-[var(--sel-bg)] border border-[var(--sel-bd)] text-blue-400 rounded hover:bg-blue-500/20">← Back</button></div></div>
  }
  if (!data) return null

  const statusBadge = getStatusBadge(data.status)
  const priorityBadge = getPriorityBadge(data.priority)
  const isTerminal = data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled'

  return (
    <div className="p-4 space-y-6">
      <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <h1 className="text-lg font-semibold text-[var(--text)]">{data.title}</h1>
          <span className="px-2 py-0.5 rounded-full text-xs border" style={{ backgroundColor: statusBadge.bg, borderColor: statusBadge.border, color: statusBadge.text }}>{statusBadge.label}</span>
          <span className="px-2 py-0.5 rounded-full text-xs border" style={{ backgroundColor: priorityBadge.bg, borderColor: priorityBadge.border, color: priorityBadge.text }}>{priorityBadge.label}</span>
        </div>
        <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4"><div className="text-[10px] font-medium uppercase tracking-[0.28em] text-[var(--muted)] mb-2">Intent</div><p className="text-sm text-[var(--text)] whitespace-pre-wrap">{data.intent}</p></div>
        {data.currentSummary && <div className="mt-4 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4"><div className="text-[10px] font-medium uppercase tracking-[0.28em] text-[var(--muted)] mb-2">Current Progress</div><p className="text-sm text-[var(--text)] whitespace-pre-wrap">{data.currentSummary}</p></div>}
        {data.riskSummary && <div className="mt-4 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4"><div className="text-[10px] font-medium uppercase tracking-[0.28em] text-[var(--muted)] mb-2">Risk Summary</div><p className="text-sm" style={{ color: 'var(--s-att-tx)' }}>{data.riskSummary}</p></div>}
        {isTerminal && data.resultSummary && <div className="mt-4 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4"><div className="text-[10px] font-medium uppercase tracking-[0.28em] text-[var(--muted)] mb-2">{data.status === 'completed' ? 'Result' : data.status === 'failed' ? 'Failure Summary' : 'Cancellation Note'}</div><p className="text-sm text-[var(--text)] whitespace-pre-wrap">{data.resultSummary}</p></div>}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]"><span>ID: <span className="font-mono">{data.id}</span></span><span>Updated: {formatDateTime(data.updatedAt)}</span></div>
      </div>

      <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
        <h3 className="text-sm text-[var(--muted)] mb-3">Status Timeline</h3>
        <StatusTimeline events={timeline} />
      </div>

      <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
        <h3 className="text-sm text-[var(--muted)] mb-3">Delegated Work {workItemState.order.length > 0 ? `(${workItemState.order.length})` : ''}</h3>
        {workItemState.order.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No delegated work items yet.</p>
        ) : (
          <div className="space-y-4">
            {groupOrder.map((status) => {
              const items = groupedWorkItems[status]
              if (!items || items.length === 0) return null
              return (
                <div key={status}>
                  <div className="mb-2 text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{status.replace('_', ' ')}</div>
                  <div className="space-y-3">
                    {items.map((item) => <WorkItemCard key={item.id} item={item} />)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
        <h3 className="text-sm text-[var(--muted)] mb-3">Approvals {approvals.length > 0 ? `(${approvals.length})` : ''}</h3>
        {approvals.length === 0 ? <p className="text-sm text-[var(--muted)]">No approvals recorded.</p> : <div className="space-y-3">{approvals.map((approval) => <ApprovalCard key={approval.id} approval={approval} onResolved={(updated) => setApprovals((prev) => prev.map((item) => item.id === updated.id ? { ...item, ...updated } : item))} />)}</div>}
      </div>

      <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
        <h3 className="text-sm text-[var(--muted)] mb-3">Recovery Events {recoveryEvents.length > 0 ? `(${recoveryEvents.length})` : ''}</h3>
        {recoveryEvents.length === 0 ? <p className="text-sm text-[var(--muted)]">No recovery events recorded.</p> : <div className="space-y-3">{recoveryEvents.map((event) => <RecoveryEventCard key={event.id} event={event} />)}</div>}
      </div>

      <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
        <h3 className="text-sm text-[var(--muted)] mb-3">Learning Records {learningRecords.length > 0 ? `(${learningRecords.length})` : ''}</h3>
        {learningRecords.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No learning records recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {learningRecords.map((record) => (
              <div key={record.id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">{record.category.replace('_', ' ')}</div>
                    <div className="mt-1 text-sm text-[var(--text)] whitespace-pre-wrap">{record.observation}</div>
                  </div>
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[11px] border" style={{ backgroundColor: 'var(--panel-subtle)', borderColor: 'var(--border-soft)', color: 'var(--muted)' }}>
                    {record.signalType.replace('_', ' ')}
                  </span>
                </div>
                {record.recommendation && <div className="mt-2 text-xs text-[var(--text)]">Recommendation: {record.recommendation}</div>}
                <div className="mt-1 text-xs text-[var(--muted)]">Confidence: {record.confidence ?? 'unknown'} · Logged: {formatDateTime(record.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
