// agentCanvasUx.ts - Test fixture builders for agent canvas UX components

import {
  ChatDisplayEvent,
  ContextAttachment,
  UserAction,
  Approval,
  RuntimeDelegation,
  RuntimeEvent,
  RuntimeWorkItem,
  ThreadMessage,
} from '../../src/types'

// ─────────────────────────────────────────────────────────────────────────────
// Chat Display Event fixtures
// ─────────────────────────────────────────────────────────────────────────────

export function buildChatDisplayEvent(
  overrides: Partial<ChatDisplayEvent> = {}
): ChatDisplayEvent {
  return {
    id: 'evt:default',
    kind: 'message',
    actorLabel: 'Prime',
    status: 'success',
    occurredAt: new Date().toISOString(),
    summary: 'Default event summary',
    source: { type: 'thread_message', id: 'msg:1' },
    attachments: [],
    ...overrides,
  }
}

export function buildThinkingEvent(overrides?: Partial<ChatDisplayEvent>): ChatDisplayEvent {
  return buildChatDisplayEvent({
    kind: 'thinking',
    actorLabel: 'Prime',
    status: 'streaming',
    summary: 'Processing your request...',
    details: 'Analyzing requirements and planning next steps.',
    ...overrides,
  })
}

export function buildToolCallEvent(overrides?: Partial<ChatDisplayEvent>): ChatDisplayEvent {
  return buildChatDisplayEvent({
    kind: 'tool_call',
    actorLabel: 'agent-1',
    status: 'running',
    summary: 'Calling weather API...',
    source: { type: 'runtime_event', id: 'evt:tool-call-1' },
    ...overrides,
  })
}

export function buildToolResultEvent(overrides?: Partial<ChatDisplayEvent>): ChatDisplayEvent {
  return buildChatDisplayEvent({
    kind: 'tool_result',
    actorLabel: 'agent-1',
    status: 'success',
    summary: 'Weather data retrieved',
    details: JSON.stringify({ temperature: 72, condition: 'sunny' }),
    source: { type: 'runtime_event', id: 'evt:tool-result-1' },
    ...overrides,
  })
}

export function buildApprovalEvent(overrides?: Partial<ChatDisplayEvent>): ChatDisplayEvent {
  return buildChatDisplayEvent({
    kind: 'approval',
    actorLabel: 'operator',
    status: 'pending',
    summary: 'Request: Approve deployment',
    details: 'Deploy to production environment?',
    source: { type: 'approval', id: 'app:1' },
    actions: [
      { label: 'Approve', type: 'approve' },
      { label: 'Deny', type: 'deny' },
    ],
    ...overrides,
  })
}

export function buildDelegationEvent(overrides?: Partial<ChatDisplayEvent>): ChatDisplayEvent {
  return buildChatDisplayEvent({
    kind: 'delegation',
    actorLabel: 'agent-1',
    status: 'running',
    summary: 'Task: Research competitors',
    details: 'Analyze top 5 competitors in the SaaS space.',
    source: { type: 'delegation', id: 'del:1' },
    ...overrides,
  })
}

export function buildGoalEvent(overrides?: Partial<ChatDisplayEvent>): ChatDisplayEvent {
  return buildChatDisplayEvent({
    kind: 'goal',
    actorLabel: 'operator',
    status: 'running',
    summary: 'Goal: Launch new feature',
    details: 'Implement user authentication with OAuth2.',
    source: { type: 'work_item', id: 'wi:goal-1' },
    ...overrides,
  })
}

export function buildArtifactEvent(overrides?: Partial<ChatDisplayEvent>): ChatDisplayEvent {
  return buildChatDisplayEvent({
    kind: 'artifact',
    actorLabel: 'agent-1',
    status: 'success',
    summary: 'Artifact: Architecture diagram',
    details: 'Created system architecture diagram in PDF format.',
    source: { type: 'work_item', id: 'wi:artifact-1' },
    ...overrides,
  })
}

export function buildNoteEvent(overrides?: Partial<ChatDisplayEvent>): ChatDisplayEvent {
  return buildChatDisplayEvent({
    kind: 'note',
    actorLabel: 'agent-1',
    status: 'success',
    summary: 'Note: Meeting minutes',
    details: 'Discussed sprint planning and task assignments.',
    source: { type: 'work_item', id: 'wi:note-1' },
    ...overrides,
  })
}

export function buildSystemEvent(overrides?: Partial<ChatDisplayEvent>): ChatDisplayEvent {
  return buildChatDisplayEvent({
    kind: 'system',
    actorLabel: 'system',
    status: 'success',
    summary: 'System initialized',
    source: { type: 'runtime_event', id: 'evt:system-1' },
    ...overrides,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Attachment fixtures
// ─────────────────────────────────────────────────────────────────────────────

export function buildContextAttachment(overrides?: Partial<ContextAttachment>): ContextAttachment {
  return {
    id: 'att:default',
    name: 'default.txt',
    type: 'file',
    sourceLabel: 'agent-1',
    availability: 'available',
    ...overrides,
  }
}

export function buildRestrictedAttachment(overrides?: Partial<ContextAttachment>): ContextAttachment {
  return buildContextAttachment({
    name: 'confidential.pdf',
    availability: 'restricted',
    previewSummary: 'Access restricted - requires approval',
    ...overrides,
  })
}

export function buildUnavailableAttachment(overrides?: Partial<ContextAttachment>): ContextAttachment {
  return buildContextAttachment({
    name: 'deleted-file.txt',
    availability: 'deleted',
    previewSummary: 'File no longer available',
    ...overrides,
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// User Action fixtures
// ─────────────────────────────────────────────────────────────────────────────

export function buildApproveAction(overrides?: Partial<UserAction>): UserAction {
  return { label: 'Approve', type: 'approve', ...overrides }
}

export function buildDenyAction(overrides?: Partial<UserAction>): UserAction {
  return { label: 'Deny', type: 'deny', ...overrides }
}

export function buildRetryAction(overrides?: Partial<UserAction>): UserAction {
  return { label: 'Retry', type: 'retry', ...overrides }
}

export function buildCancelAction(overrides?: Partial<UserAction>): UserAction {
  return { label: 'Cancel', type: 'cancel', ...overrides }
}

export function buildExpandAction(overrides?: Partial<UserAction>): UserAction {
  return { label: 'Expand', type: 'expand', ...overrides }
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime record fixtures (for mapping tests)
// ─────────────────────────────────────────────────────────────────────────────────

export function buildThreadMessage(overrides?: Partial<ThreadMessage>): ThreadMessage {
  return {
    id: 'msg:default',
    thread_id: 'thread:1',
    role: 'user',
    sender: 'operator',
    content: 'Default message content',
    metadata: {},
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

export function buildApproval(overrides?: Partial<Approval>): Approval {
  return {
    approval_id: 'app:default',
    run_id: 'run:1',
    action: 'Deploy to production',
    status: 'pending',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

export function buildRuntimeDelegation(overrides?: Partial<RuntimeDelegation>): RuntimeDelegation {
  return {
    id: 'del:default',
    work_item_id: 'wi:1',
    from_agent_id: 'agent:1',
    to_agent_id: 'agent:2',
    status: 'running',
    capability: 'Research competitors',
    request: { query: 'top SaaS competitors' },
    result: {},
    trace: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

export function buildRuntimeEvent(overrides?: Partial<RuntimeEvent>): RuntimeEvent {
  return {
    id: 'evt:default',
    event_type: 'tool_call',
    actor: 'agent-1',
    thread_id: 'thread:1',
    payload: { summary: 'Calling API', status: 'running' },
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

export function buildRuntimeWorkItem(overrides?: Partial<RuntimeWorkItem>): RuntimeWorkItem {
  return {
    id: 'wi:default',
    title: 'Default work item',
    status: 'active',
    priority: 'medium',
    lane: 'backlog',
    owner_agent_id: 'agent:1',
    owner_label: 'agent-1',
    metadata: { kind: 'goal' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Collections
// ─────────────────────────────────────────────────────────────────────────────

export const CHAT_EVENT_FIXTURES = {
  message: buildChatDisplayEvent,
  thinking: buildThinkingEvent,
  tool_call: buildToolCallEvent,
  tool_result: buildToolResultEvent,
  approval: buildApprovalEvent,
  delegation: buildDelegationEvent,
  goal: buildGoalEvent,
  artifact: buildArtifactEvent,
  note: buildNoteEvent,
  system: buildSystemEvent,
}

export const ATTACHMENT_FIXTURES = {
  available: buildContextAttachment,
  restricted: buildRestrictedAttachment,
  unavailable: buildUnavailableAttachment,
}

export const ACTION_FIXTURES = {
  approve: buildApproveAction,
  deny: buildDenyAction,
  retry: buildRetryAction,
  cancel: buildCancelAction,
  expand: buildExpandAction,
}

export const RUNTIME_FIXTURES = {
  message: buildThreadMessage,
  approval: buildApproval,
  delegation: buildRuntimeDelegation,
  event: buildRuntimeEvent,
  workItem: buildRuntimeWorkItem,
}
