// ─────────────────────────────────────────────────────────────────────────────
// Test Fixtures for Agent Canvas UX (spec 017)
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ChatDisplayEvent,
  ContextAttachment,
  ApprovalDisplayCard,
  DelegationDisplayCard,
  CircuitNode,
  CircuitEdge,
  ToolbarDraftAction,
} from '../../src/types'

// ─── Chat Display Event Builders ─────────────────────────────────────────────

export function buildChatDisplayEvent(overrides?: Partial<ChatDisplayEvent>): ChatDisplayEvent {
  return {
    id: overrides?.id || `event-${Date.now()}`,
    kind: overrides?.kind || 'thinking',
    actorLabel: overrides?.actorLabel || 'Prime',
    status: overrides?.status || 'streaming',
    occurredAt: overrides?.occurredAt || new Date().toISOString(),
    summary: overrides?.summary || 'Thinking in progress...',
    details: overrides?.details,
    source: overrides?.source || {
      type: 'prime_session',
      id: 'session-123',
    },
    attachments: overrides?.attachments || [],
    actions: overrides?.actions,
  }
}

// ─── Context Attachment Builders ─────────────────────────────────────────────

export function buildContextAttachment(overrides?: Partial<ContextAttachment>): ContextAttachment {
  return {
    id: overrides?.id || `att-${Date.now()}`,
    name: overrides?.name || 'attachment.txt',
    type: overrides?.type || 'file',
    sourceLabel: overrides?.sourceLabel || 'System',
    availability: overrides?.availability || 'available',
    previewSummary: overrides?.previewSummary,
    targetRef: overrides?.targetRef,
  }
}

// ─── Approval Display Card Builders ──────────────────────────────────────────

export function buildApprovalDisplayCard(overrides?: Partial<ApprovalDisplayCard>): ApprovalDisplayCard {
  return {
    id: overrides?.id || `approv-${Date.now()}`,
    requesterLabel: overrides?.requesterLabel || 'Agent Alpha',
    requestSummary: overrides?.requestSummary || 'Deploy to production',
    status: overrides?.status || 'pending',
    decisionOptions: overrides?.decisionOptions || ['approve', 'deny'],
    ...overrides,
  }
}

// ─── Delegation Display Card Builders ────────────────────────────────────────

export function buildDelegationDisplayCard(overrides?: Partial<DelegationDisplayCard>): DelegationDisplayCard {
  return {
    id: overrides?.id || `deleg-${Date.now()}`,
    sourceLabel: overrides?.sourceLabel || 'Prime',
    targetLabel: overrides?.targetLabel || 'Agent Beta',
    objective: overrides?.objective || 'Process customer request',
    status: overrides?.status || 'running',
    ...overrides,
  }
}

// ─── Circuit Node Builders ───────────────────────────────────────────────────

export function buildCircuitNode(overrides?: Partial<CircuitNode>): CircuitNode {
  return {
    id: overrides?.id || `node-${Date.now()}`,
    type: overrides?.type || 'agent',
    title: overrides?.title || 'Agent Alpha',
    summary: overrides?.summary || 'Processing requests',
    status: overrides?.status || 'active',
    position: overrides?.position || { x: 100, y: 100 },
    collapsedDetails: overrides?.collapsedDetails || ['active', 'online'],
    expandedDetails: overrides?.expandedDetails,
    ...overrides,
  }
}

// ─── Circuit Edge Builders ───────────────────────────────────────────────────

export function buildCircuitEdge(overrides?: Partial<CircuitEdge>): CircuitEdge {
  return {
    id: overrides?.id || `edge-${Date.now()}`,
    fromNodeId: overrides?.fromNodeId || 'prime',
    toNodeId: overrides?.toNodeId || 'agent-1',
    relationship: overrides?.relationship || 'coordinates',
    ...overrides,
  }
}

// ─── Toolbar Draft Action Builders ───────────────────────────────────────────

export function buildToolbarDraftAction(overrides?: Partial<ToolbarDraftAction>): ToolbarDraftAction {
  return {
    id: overrides?.id || `draft-${Date.now()}`,
    actionType: overrides?.actionType || 'spawn_agent',
    originContext: overrides?.originContext || { activeRoomId: 'room-1' },
    requiredInputs: overrides?.requiredInputs || {},
    status: overrides?.status || 'draft',
    ...overrides,
  }
}

// ─── Fixture Collections ─────────────────────────────────────────────────────

export const THINKING_EVENTS: ChatDisplayEvent[] = [
  buildChatDisplayEvent({
    id: 'thinking-1',
    kind: 'thinking',
    status: 'streaming',
    summary: 'Analyzing customer request...',
    actorLabel: 'Prime',
  }),
  buildChatDisplayEvent({
    id: 'thinking-2',
    kind: 'thinking',
    status: 'success',
    summary: 'Analysis complete. Proceeding with plan.',
    actorLabel: 'Prime',
  }),
]

export const TOOL_CALL_EVENTS: ChatDisplayEvent[] = [
  buildChatDisplayEvent({
    id: 'tool-call-1',
    kind: 'tool_call',
    status: 'running',
    summary: 'Calling weather_api to get forecast',
    actorLabel: 'Prime',
  }),
  buildChatDisplayEvent({
    id: 'tool-result-1',
    kind: 'tool_result',
    status: 'success',
    summary: 'Weather API returned forecast for 5 days',
    actorLabel: 'Prime',
  }),
]

export const APPROVAL_EVENTS: ChatDisplayEvent[] = [
  buildChatDisplayEvent({
    id: 'approv-1',
    kind: 'approval',
    status: 'pending',
    summary: 'Deploy to production requested',
    actorLabel: 'Agent Alpha',
  } as any),
]

export const DELEGATION_EVENTS: ChatDisplayEvent[] = [
  buildChatDisplayEvent({
    id: 'deleg-1',
    kind: 'delegation',
    status: 'running',
    summary: 'Delegated to Agent Beta for processing',
    actorLabel: 'Prime',
  } as any),
]

export const CONTEXT_ATTACHMENT_EVENTS: ChatDisplayEvent[] = [
  buildChatDisplayEvent({
    id: 'event-attach-1',
    kind: 'message',
    status: 'success',
    summary: 'Here is the file you requested',
    actorLabel: 'Agent Alpha',
    attachments: [
      buildContextAttachment({ name: 'report.pdf', type: 'file', availability: 'available' }),
      buildContextAttachment({ name: 'data.json', type: 'artifact', availability: 'available' }),
    ],
  }),
]

export const ALL_EVENT_TYPES: ChatDisplayEvent[] = [
  ...THINKING_EVENTS,
  ...TOOL_CALL_EVENTS,
  ...APPROVAL_EVENTS,
  ...DELEGATION_EVENTS,
  ...CONTEXT_ATTACHMENT_EVENTS,
]
