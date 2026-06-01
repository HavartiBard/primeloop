// chatDisplayEvents.ts - Map ACP runtime records to ChatDisplayEvent for timeline rendering

import {
  ThreadMessage,
  RuntimeWorkItem,
  RuntimeDelegation,
  Approval,
  RuntimeEvent,
  ChatDisplayEvent,
  ChatEventKind,
  DisplayStatus,
  EventSource,
  ContextAttachment,
  UserAction,
} from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Helper: derive status from ACP record state
// ─────────────────────────────────────────────────────────────────────────────

function deriveDisplayStatusForMessage(message: ThreadMessage): DisplayStatus {
  // Thread messages are static once created; treat as success
  return 'success'
}

function deriveDisplayStatusForThinking(session: { status?: string; error?: string }): DisplayStatus {
  switch (session.status) {
    case 'running':
      return 'streaming'
    case 'completed':
      return 'success'
    case 'failed':
      return 'failed'
    case 'escalated':
      return 'blocked'
    default:
      return 'pending'
  }
}

function deriveDisplayStatusForToolCall(session: { status?: string }): DisplayStatus {
  switch (session.status) {
    case 'running':
      return 'running'
    case 'completed':
      return 'success'
    case 'failed':
      return 'failed'
    default:
      return 'pending'
  }
}

function deriveDisplayStatusForApproval(approval: Approval): DisplayStatus {
  switch (approval.status) {
    case 'pending':
      return 'pending'
    case 'approved':
      return 'resolved'
    case 'denied':
      return 'cancelled'
    default:
      return 'pending'
  }
}

function deriveDisplayStatusForDelegation(delegation: RuntimeDelegation): DisplayStatus {
  switch (delegation.status) {
    case 'pending':
    case 'queued':
      return 'pending'
    case 'running':
      return 'running'
    case 'completed':
      return 'success'
    case 'failed':
    case 'blocked':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'pending'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapper: ThreadMessage → ChatDisplayEvent
// ─────────────────────────────────────────────────────────────────────────────

export function mapThreadMessageToChatEvent(message: ThreadMessage): ChatDisplayEvent {
  const isSystem = message.role === 'system'
  const actorLabel = message.sender || (isSystem ? 'system' : 'unknown')
  const kind: ChatEventKind = isSystem ? 'system' : 'message'

  return {
    id: `msg:${message.id}`,
    kind,
    actorLabel,
    status: deriveDisplayStatusForMessage(message),
    occurredAt: message.created_at,
    summary: message.content,
    source: { type: 'thread_message', id: message.id },
    attachments: [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapper: PrimeSession → ChatDisplayEvent (thinking)
// ─────────────────────────────────────────────────────────────────────────────

export function mapPrimeSessionToThinkingEvent(session: {
  id: string
  status?: string
  error?: string
  reasoning_summary?: string
  started_at: string
}): ChatDisplayEvent {
  return {
    id: `thinking:${session.id}`,
    kind: 'thinking',
    actorLabel: 'Prime',
    status: deriveDisplayStatusForThinking(session),
    occurredAt: session.started_at,
    summary: session.reasoning_summary || 'Thinking...',
    details: session.error ? `Error: ${session.error}` : undefined,
    source: { type: 'prime_session', id: session.id },
    attachments: [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapper: RuntimeEvent (tool calls/results)
// ─────────────────────────────────────────────────────────────────────────────

export function mapRuntimeEventToChatEvents(event: RuntimeEvent): ChatDisplayEvent[] {
  const events: ChatDisplayEvent[] = []

  if (event.event_type === 'tool_call') {
    // Tool call event
    events.push({
      id: `tool_call:${event.id}`,
      kind: 'tool_call',
      actorLabel: event.actor || 'unknown',
      status: deriveDisplayStatusForToolCall(event.payload),
      occurredAt: event.created_at,
      summary: (event.payload as Record<string, unknown>)?.summary?.toString() || 'Tool call',
      source: { type: 'runtime_event', id: event.id },
      attachments: [],
    })
  }

  if (event.event_type === 'tool_result') {
    // Tool result event
    events.push({
      id: `tool_result:${event.id}`,
      kind: 'tool_result',
      actorLabel: event.actor || 'unknown',
      status: deriveDisplayStatusForToolCall(event.payload),
      occurredAt: event.created_at,
      summary: (event.payload as Record<string, unknown>)?.summary?.toString() || 'Tool result',
      details: (event.payload as Record<string, unknown>)?.output?.toString(),
      source: { type: 'runtime_event', id: event.id },
      attachments: [],
    })
  }

  return events
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapper: Approval → ChatDisplayEvent + Card metadata
// ─────────────────────────────────────────────────────────────────────────────

export function mapApprovalToChatEvent(approval: Approval): ChatDisplayEvent {
  return {
    id: `approval:${approval.approval_id}`,
    kind: 'approval',
    actorLabel: approval.action,
    status: deriveDisplayStatusForApproval(approval),
    occurredAt: approval.created_at,
    summary: `Request: ${approval.action}`,
    details: `Run: ${approval.run_id}`,
    source: { type: 'approval', id: approval.approval_id },
    attachments: [],
    actions: [
      { label: 'Approve', type: 'approve' },
      { label: 'Deny', type: 'deny' },
    ],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapper: RuntimeDelegation → ChatDisplayEvent + Card metadata
// ─────────────────────────────────────────────────────────────────────────────

export function mapDelegationToChatEvent(delegation: RuntimeDelegation): ChatDisplayEvent {
  return {
    id: `delegation:${delegation.id}`,
    kind: 'delegation',
    actorLabel: delegation.from_agent_id || 'unknown',
    status: deriveDisplayStatusForDelegation(delegation),
    occurredAt: delegation.created_at,
    summary: delegation.capability || 'Delegated work',
    details: delegation.result ? JSON.stringify(delegation.result) : undefined,
    source: { type: 'delegation', id: delegation.id },
    attachments: [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapper: RuntimeWorkItem (goals/artifacts/notes) → ChatDisplayEvent
// ─────────────────────────────────────────────────────────────────────────────

export function mapWorkItemToChatEvent(workItem: RuntimeWorkItem): ChatDisplayEvent {
  const kind: ChatEventKind =
    workItem.metadata.kind === 'goal' ? 'goal' : workItem.metadata.kind === 'artifact' ? 'artifact' : 'note'

  return {
    id: `work_item:${workItem.id}`,
    kind,
    actorLabel: workItem.owner_label || 'unknown',
    status: 'running',
    occurredAt: workItem.created_at,
    summary: workItem.title,
    details: workItem.description,
    source: { type: 'work_item', id: workItem.id },
    attachments: [],
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapper: ContextAttachment from RuntimeEvent or WorkItem
// ─────────────────────────────────────────────────────────────────────────────

export function deriveContextAttachmentsFromEvent(event: RuntimeEvent): ContextAttachment[] {
  const attachments: ContextAttachment[] = []

  // Example: if event.payload.attachments exists
  const payload = event.payload as Record<string, unknown>
  if (payload.attachments && Array.isArray(payload.attachments)) {
    for (const att of payload.attachments as Record<string, unknown>[]) {
      attachments.push({
        id: String(att.id || ''),
        name: String(att.name || 'Attachment'),
        type: (att.type as any) || 'other',
        sourceLabel: String(att.sourceLabel || event.actor || 'unknown'),
        availability: att.availability ? (att.availability as any) : 'available',
        previewSummary: att.previewSummary ? String(att.previewSummary) : undefined,
        targetRef: att.targetRef
          ? { type: String((att.targetRef as Record<string, unknown>)?.type || ''), id: String((att.targetRef as Record<string, unknown>)?.id || '') }
          : undefined,
      })
    }
  }

  return attachments
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: Full derivation from runtime records
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatEventBundle {
  events: ChatDisplayEvent[]
  approvals: ChatDisplayEvent[]
  delegations: ChatDisplayEvent[]
}

export function deriveChatEventsFromRuntime(
  messages: ThreadMessage[],
  sessions: Array<{ id: string; status?: string; error?: string; reasoning_summary?: string; started_at: string }>,
  events: RuntimeEvent[],
  approvals: Approval[],
  delegations: RuntimeDelegation[],
  workItems: RuntimeWorkItem[]
): ChatEventBundle {
  const chatEvents: ChatDisplayEvent[] = []
  const approvalEvents: ChatDisplayEvent[] = []
  const delegationEvents: ChatDisplayEvent[] = []

  // Messages
  for (const msg of messages) {
    chatEvents.push(mapThreadMessageToChatEvent(msg))
  }

  // Thinking (Prime sessions)
  for (const session of sessions) {
    chatEvents.push(mapPrimeSessionToThinkingEvent(session))
  }

  // Tool calls/results
  for (const evt of events) {
    const mapped = mapRuntimeEventToChatEvents(evt)
    chatEvents.push(...mapped)
  }

  // Approvals
  for (const approval of approvals) {
    approvalEvents.push(mapApprovalToChatEvent(approval))
  }

  // Delegations
  for (const delegation of delegations) {
    delegationEvents.push(mapDelegationToChatEvent(delegation))
  }

  // Work items (goals/artifacts/notes)
  for (const workItem of workItems) {
    chatEvents.push(mapWorkItemToChatEvent(workItem))
  }

  // Sort by occurredAt
  chatEvents.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())

  return { events: chatEvents, approvals: approvalEvents, delegations: delegationEvents }
}
