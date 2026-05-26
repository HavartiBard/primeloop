// ─────────────────────────────────────────────────────────────────────────────
// Chat Display Events Mapper (spec 017)
// Derive typed ChatDisplayEvent from existing ACP records
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ThreadMessage,
  RuntimeWorkItem,
  RuntimeDelegation,
  Approval,
  RuntimeEvent,
  PrimeSession,
  ChatDisplayEvent,
  EventSource,
  ContextAttachment,
  UserAction,
  DisplayStatus,
} from '../types'

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Derive display status from runtime status strings
 */
function deriveDisplayStatus(status: string): DisplayStatus {
  const normalized = status.toLowerCase()
  if (normalized.includes('pending')) return 'pending'
  if (normalized.includes('streaming') || normalized.includes('running')) return 'streaming'
  if (normalized.includes('success') || normalized === 'completed') return 'success'
  if (normalized.includes('failed') || normalized.includes('error')) return 'failed'
  if (normalized.includes('cancelled') || normalized.includes('cancel')) return 'cancelled'
  if (normalized.includes('timeout')) return 'timeout'
  if (normalized.includes('blocked')) return 'blocked'
  if (normalized.includes('resolved')) return 'resolved'
  return 'running'
}

/**
 * Derive event source from record
 */
function deriveEventSource(
  type: EventSource['type'],
  id: string,
): EventSource {
  return { type, id }
}

/**
 * Context attachment metadata structure
 */
interface AttachmentMetadata {
  id?: string
  name?: string
  type?: string
  sourceLabel?: string
  availability?: ContextAttachment['availability']
  previewSummary?: string
  targetRef?: ContextAttachment['targetRef']
}

/**
 * File reference in payload
 */
interface FileReference {
  name?: string
  availability?: ContextAttachment['availability']
  summary?: string
}

/**
 * Derive context attachment from metadata or payload
 */
function deriveContextAttachments(
  metadata?: Record<string, unknown>,
  payload?: Record<string, unknown>,
): ContextAttachment[] {
  const attachments: ContextAttachment[] = []

  // Check for attachment references in metadata
  if (metadata?.attachments && Array.isArray(metadata.attachments)) {
    metadata.attachments.forEach((att: unknown) => {
      if (att && typeof att === 'object') {
        const attachment = att as AttachmentMetadata
        attachments.push({
          id: attachment.id || `${attachment.name || 'Attachment'}-${Date.now()}`,
          name: attachment.name || 'Attachment',
          type: (attachment.type as ContextAttachment['type']) || 'other',
          sourceLabel: attachment.sourceLabel || 'Unknown source',
          availability: attachment.availability || 'available',
          previewSummary: attachment.previewSummary,
          targetRef: attachment.targetRef,
        })
      }
    })
  }

  // Check for file references in payload
  if (payload?.files && Array.isArray(payload.files)) {
    payload.files.forEach((file: unknown, index: number) => {
      if (file && typeof file === 'object') {
        const fileRef = file as FileReference
        attachments.push({
          id: `file-${index}-${Date.now()}`,
          name: fileRef.name || `File ${index + 1}`,
          type: 'file',
          sourceLabel: 'File attachment',
          availability: fileRef.availability || 'available',
          previewSummary: fileRef.summary,
        })
      }
    })
  }

  return attachments
}

/**
 * Derive user actions from approval/delegation data
 */
function deriveUserActions(
  kind: ChatDisplayEvent['kind'],
  data: Approval | RuntimeDelegation,
): UserAction[] | undefined {
  if (kind === 'approval') {
    const approval = data as Approval
    return [
      { label: 'Approve', type: 'approve' },
      { label: 'Deny', type: 'deny' },
    ]
  }
  if (kind === 'delegation') {
    return [
      { label: 'Retry', type: 'retry' },
      { label: 'Cancel', type: 'cancel' },
    ]
  }
  return undefined
}

// ─── Message Events ──────────────────────────────────────────────────────────

/**
 * Derive chat display event from thread message
 */
export function deriveChatEventFromMessage(
  message: ThreadMessage,
): ChatDisplayEvent {
  const isSystem = message.role === 'system' || message.sender.toLowerCase() === 'system'
  const kind: ChatDisplayEvent['kind'] = isSystem ? 'system' : 'message'

  return {
    id: `msg-${message.id}`,
    kind,
    actorLabel: message.sender,
    status: 'success',
    occurredAt: message.created_at,
    summary: message.content.slice(0, 120),
    details: message.content.length > 120 ? message.content : undefined,
    source: deriveEventSource('thread_message', message.id),
    attachments: deriveContextAttachments(message.metadata),
    actions: isSystem ? [{ label: 'Copy', type: 'copy' }] : undefined,
  }
}

// ─── Thinking Events (from Prime Session) ────────────────────────────────────

/**
 * Derive chat display event from prime session reasoning
 */
export function deriveChatEventFromThinking(
  session: PrimeSession,
): ChatDisplayEvent | null {
  if (!session.reasoning_summary && !session.last_step) return null

  const status: DisplayStatus = session.status === 'running' ? 'streaming' : 'success'

  return {
    id: `thinking-${session.id}`,
    kind: 'thinking',
    actorLabel: 'Prime',
    status,
    occurredAt: session.started_at,
    summary: session.last_step
      ? `Thinking step: ${session.last_step}`
      : session.reasoning_summary?.slice(0, 80) || 'Thinking in progress',
    details: session.reasoning_summary,
    source: deriveEventSource('prime_session', session.id),
    attachments: [],
  }
}

// ─── Tool Call Events (from Prime Session) ───────────────────────────────────

/**
 * Tool action from prime session
 */
interface ToolAction {
  tool_name?: string
  type?: string
}

/**
 * Derive chat display event from prime session actions
 */
export function deriveChatEventFromToolCall(
  session: PrimeSession,
): ChatDisplayEvent | null {
  if (!session.actions_taken || !Array.isArray(session.actions_taken)) return null

  const toolAction = session.actions_taken.find(
    (a) => a && typeof a === 'object' && ('tool_name' in a || 'type' in a),
  ) as ToolAction | undefined
  if (!toolAction) return null

  const status: DisplayStatus = session.status === 'running' ? 'running' : 'success'

  return {
    id: `tool-call-${session.id}`,
    kind: 'tool_call',
    actorLabel: 'Prime',
    status,
    occurredAt: session.started_at,
    summary: `Calling ${toolAction.tool_name || toolAction.type || 'tool'}`,
    details: JSON.stringify(toolAction, null, 2),
    source: deriveEventSource('prime_session', session.id),
    attachments: [],
    actions: [{ label: 'Retry', type: 'retry' }],
  }
}

// ─── Tool Result Events (from Prime Session) ─────────────────────────────────

/**
 * Tool result from prime session
 */
interface ToolResult {
  result?: {
    success?: boolean
    error?: string
  }
}

/**
 * Derive chat display event from tool result
 */
export function deriveChatEventFromToolResult(
  session: PrimeSession,
): ChatDisplayEvent | null {
  if (!session.actions_taken || !Array.isArray(session.actions_taken)) return null

  const resultAction = session.actions_taken.find(
    (a) => a && typeof a === 'object' && ('result' in a || 'success' in a || 'error' in a),
  ) as ToolResult | undefined
  if (!resultAction) return null

  let status: DisplayStatus = 'success'
  if (session.status === 'failed') status = 'failed'
  else if (session.status === 'running') status = 'running'

  const resultData = resultAction.result as ToolResult['result'] | undefined

  return {
    id: `tool-result-${session.id}`,
    kind: 'tool_result',
    actorLabel: 'Prime',
    status,
    occurredAt: session.completed_at || session.started_at,
    summary: resultData?.success
      ? 'Tool executed successfully'
      : resultData?.error
        ? `Tool failed: ${resultData.error}`
        : 'Tool execution complete',
    details: JSON.stringify(resultAction, null, 2),
    source: deriveEventSource('prime_session', session.id),
    attachments: [],
  }
}

// ─── Work Item Events ────────────────────────────────────────────────────────

/**
 * Derive chat display event from work item
 */
export function deriveChatEventFromWorkItem(
  workItem: RuntimeWorkItem,
): ChatDisplayEvent {
  const status = deriveDisplayStatus(workItem.status)

  return {
    id: `work-${workItem.id}`,
    kind: 'goal',
    actorLabel: workItem.owner_label || 'Unknown',
    status,
    occurredAt: workItem.updated_at,
    summary: `${workItem.title} - ${workItem.status}`,
    details: workItem.description,
    source: deriveEventSource('work_item', workItem.id),
    attachments: [],
  }
}

// ─── Delegation Events ───────────────────────────────────────────────────────

/**
 * Derive chat display event from delegation
 */
export function deriveChatEventFromDelegation(
  delegation: RuntimeDelegation,
): ChatDisplayEvent {
  const status = deriveDisplayStatus(delegation.status)

  return {
    id: `deleg-${delegation.id}`,
    kind: 'delegation',
    actorLabel: delegation.from_agent_id || 'System',
    status,
    occurredAt: delegation.created_at,
    summary: `Delegated to ${delegation.to_agent_id || 'unknown'}: ${delegation.capability}`,
    details: JSON.stringify(delegation, null, 2),
    source: deriveEventSource('delegation', delegation.id),
    attachments: [],
    actions: deriveUserActions('delegation', delegation),
  }
}

// ─── Approval Events ─────────────────────────────────────────────────────────

/**
 * Derive chat display event from approval
 */
export function deriveChatEventFromApproval(
  approval: Approval,
): ChatDisplayEvent {
  const status: DisplayStatus =
    approval.status === 'pending'
      ? 'pending'
      : approval.status === 'approved'
        ? 'resolved'
        : 'failed'

  return {
    id: `approv-${approval.approval_id}`,
    kind: 'approval',
    actorLabel: approval.run_id,
    status,
    occurredAt: approval.created_at,
    summary: `Approval requested: ${approval.action}`,
    details: approval.action,
    source: deriveEventSource('approval', approval.approval_id),
    attachments: [],
    actions: deriveUserActions('approval', approval),
  }
}

// ─── Runtime Event Events ────────────────────────────────────────────────────

/**
 * Derive chat display event from runtime event
 */
export function deriveChatEventFromRuntimeEvent(
  event: RuntimeEvent,
): ChatDisplayEvent {
  const kind: ChatDisplayEvent['kind'] = event.event_type.includes('approval')
    ? 'approval'
    : event.event_type.includes('delegation')
      ? 'delegation'
      : 'system'

  return {
    id: `event-${event.id}`,
    kind,
    actorLabel: event.actor || 'System',
    status: 'success',
    occurredAt: event.created_at,
    summary: `${event.event_type}: ${JSON.stringify(event.payload)}`,
    source: deriveEventSource('runtime_event', event.id),
    attachments: [],
  }
}

// ─── Main Derivation Function ────────────────────────────────────────────────

/**
 * Derive all chat display events from a thread's messages and related data
 */
export function deriveChatEventsFromThread(
  messages: ThreadMessage[],
  workItems: RuntimeWorkItem[] = [],
  delegations: RuntimeDelegation[] = [],
  approvals: Approval[] = [],
  runtimeEvents: RuntimeEvent[] = [],
): ChatDisplayEvent[] {
  const events: ChatDisplayEvent[] = []

  // Add message events
  messages.forEach((msg) => {
    const event = deriveChatEventFromMessage(msg)
    if (event) events.push(event)
  })

  // Add work item events
  workItems.forEach((wi) => {
    events.push(deriveChatEventFromWorkItem(wi))
  })

  // Add delegation events
  delegations.forEach((d) => {
    events.push(deriveChatEventFromDelegation(d))
  })

  // Add approval events
  approvals.forEach((a) => {
    events.push(deriveChatEventFromApproval(a))
  })

  // Add runtime event events
  runtimeEvents.forEach((e) => {
    events.push(deriveChatEventFromRuntimeEvent(e))
  })

  // Sort by timestamp
  events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())

  return events
}

/**
 * Derive chat display events from a prime session
 */
export function deriveChatEventsFromPrimeSession(
  session: PrimeSession,
): ChatDisplayEvent[] {
  const events: ChatDisplayEvent[] = []

  // Add thinking event
  const thinking = deriveChatEventFromThinking(session)
  if (thinking) events.push(thinking)

  // Add tool call events
  const toolCall = deriveChatEventFromToolCall(session)
  if (toolCall) events.push(toolCall)

  // Add tool result events
  const toolResult = deriveChatEventFromToolResult(session)
  if (toolResult) events.push(toolResult)

  return events
}
