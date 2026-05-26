// ─────────────────────────────────────────────────────────────────────────────
// Chat Display Events Mapper Tests (spec 017)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import {
  deriveChatEventFromMessage,
  deriveChatEventFromThinking,
  deriveChatEventFromToolCall,
  deriveChatEventFromToolResult,
  deriveChatEventFromWorkItem,
  deriveChatEventFromDelegation,
  deriveChatEventFromApproval,
  deriveChatEventFromRuntimeEvent,
  deriveChatEventsFromThread,
  deriveChatEventsFromPrimeSession,
} from '../../src/lib/chatDisplayEvents'
import type {
  ThreadMessage,
  PrimeSession,
  RuntimeWorkItem,
  RuntimeDelegation,
  Approval,
  RuntimeEvent,
} from '../../src/types'

// ─── deriveChatEventFromMessage Tests ────────────────────────────────────────

describe('deriveChatEventFromMessage', () => {
  it('derives message event correctly', () => {
    const message: ThreadMessage = {
      id: 'msg-1',
      thread_id: 'thread-1',
      role: 'user',
      sender: 'Operator',
      content: 'Hello, how can you help me?',
      metadata: {},
      created_at: '2026-05-25T10:00:00Z',
    }

    const event = deriveChatEventFromMessage(message)

    expect(event).toMatchObject({
      id: 'msg-msg-1',
      kind: 'message',
      actorLabel: 'Operator',
      status: 'success',
      summary: 'Hello, how can you help me?',
      source: { type: 'thread_message', id: 'msg-1' },
    })
  })

  it('derives system message correctly', () => {
    const message: ThreadMessage = {
      id: 'msg-2',
      thread_id: 'thread-1',
      role: 'system',
      sender: 'System',
      content: 'System initialized',
      metadata: {},
      created_at: '2026-05-25T10:00:01Z',
    }

    const event = deriveChatEventFromMessage(message)

    expect(event.kind).toBe('system')
    expect(event.actions).toEqual([{ label: 'Copy', type: 'copy' }])
  })

  it('truncates long content in summary', () => {
    const message: ThreadMessage = {
      id: 'msg-3',
      thread_id: 'thread-1',
      role: 'assistant',
      sender: 'Prime',
      content: 'A'.repeat(200),
      metadata: {},
      created_at: '2026-05-25T10:00:02Z',
    }

    const event = deriveChatEventFromMessage(message)

    expect(event.summary).toHaveLength(120)
    expect(event.details).toBe('A'.repeat(200))
  })
})

// ─── deriveChatEventFromThinking Tests ───────────────────────────────────────

describe('deriveChatEventFromThinking', () => {
  it('derives thinking event from reasoning summary', () => {
    const session: PrimeSession = {
      id: 'session-1',
      trigger_type: 'message',
      trigger_payload: {},
      prompt_templates: {},
      reasoning_summary: 'I need to analyze the customer request first',
      actions_taken: [],
      token_count: 150,
      status: 'completed',
      started_at: '2026-05-25T10:00:00Z',
    }

    const event = deriveChatEventFromThinking(session)

    expect(event).toMatchObject({
      id: 'thinking-session-1',
      kind: 'thinking',
      actorLabel: 'Prime',
      status: 'success',
      summary: 'I need to analyze the customer request first',
    })
  })

  it('derives thinking event from last step', () => {
    const session: PrimeSession = {
      id: 'session-2',
      trigger_type: 'message',
      trigger_payload: {},
      prompt_templates: {},
      last_step: 'Analyzing requirements',
      actions_taken: [],
      token_count: 100,
      status: 'running',
      started_at: '2026-05-25T10:00:00Z',
    }

    const event = deriveChatEventFromThinking(session)

    expect(event).toMatchObject({
      kind: 'thinking',
      status: 'streaming',
      summary: 'Thinking step: Analyzing requirements',
    })
  })

  it('returns null when no thinking data', () => {
    const session: PrimeSession = {
      id: 'session-3',
      trigger_type: 'message',
      trigger_payload: {},
      prompt_templates: {},
      actions_taken: [],
      token_count: 50,
      status: 'completed',
      started_at: '2026-05-25T10:00:00Z',
    }

    expect(deriveChatEventFromThinking(session)).toBeNull()
  })
})

// ─── deriveChatEventFromToolCall Tests ───────────────────────────────────────

describe('deriveChatEventFromToolCall', () => {
  it('derives tool call event correctly', () => {
    const session: PrimeSession = {
      id: 'session-1',
      trigger_type: 'message',
      trigger_payload: {},
      prompt_templates: {},
      reasoning_summary: '',
      actions_taken: [
        { tool_name: 'weather_api', type: 'function', arguments: { location: 'London' } },
      ],
      token_count: 200,
      status: 'running',
      started_at: '2026-05-25T10:00:00Z',
    }

    const event = deriveChatEventFromToolCall(session)

    expect(event).toMatchObject({
      id: 'tool-call-session-1',
      kind: 'tool_call',
      actorLabel: 'Prime',
      status: 'running',
      summary: 'Calling weather_api',
    })
  })

  it('handles tool call with type field', () => {
    const session: PrimeSession = {
      id: 'session-2',
      trigger_type: 'message',
      trigger_payload: {},
      prompt_templates: {},
      reasoning_summary: '',
      actions_taken: [
        { type: 'tool_use', tool_name: 'search' },
      ],
      token_count: 100,
      status: 'completed',
      started_at: '2026-05-25T10:00:00Z',
    }

    const event = deriveChatEventFromToolCall(session)

    expect(event).toMatchObject({
      kind: 'tool_call',
      summary: 'Calling search',
    })
  })

  it('returns null when no actions taken', () => {
    const session: PrimeSession = {
      id: 'session-3',
      trigger_type: 'message',
      trigger_payload: {},
      prompt_templates: {},
      reasoning_summary: '',
      actions_taken: [],
      token_count: 50,
      status: 'completed',
      started_at: '2026-05-25T10:00:00Z',
    }

    expect(deriveChatEventFromToolCall(session)).toBeNull()
  })
})

// ─── deriveChatEventFromToolResult Tests ─────────────────────────────────────

describe('deriveChatEventFromToolResult', () => {
  it('derives tool result event for success', () => {
    const session: PrimeSession = {
      id: 'session-1',
      trigger_type: 'message',
      trigger_payload: {},
      prompt_templates: {},
      reasoning_summary: '',
      actions_taken: [
        {
          result: { success: true, output: 'Forecast for London' },
        },
      ],
      token_count: 250,
      status: 'completed',
      started_at: '2026-05-25T10:00:00Z',
      completed_at: '2026-05-25T10:00:05Z',
    }

    const event = deriveChatEventFromToolResult(session)

    expect(event).toMatchObject({
      id: 'tool-result-session-1',
      kind: 'tool_result',
      actorLabel: 'Prime',
      status: 'success',
      summary: 'Tool executed successfully',
    })
  })

  it('derives tool result event for failure', () => {
    const session: PrimeSession = {
      id: 'session-2',
      trigger_type: 'message',
      trigger_payload: {},
      prompt_templates: {},
      reasoning_summary: '',
      actions_taken: [
        {
          result: { success: false, error: 'API rate limit exceeded' },
        },
      ],
      token_count: 200,
      status: 'failed',
      started_at: '2026-05-25T10:00:00Z',
    }

    const event = deriveChatEventFromToolResult(session)

    expect(event).toMatchObject({
      kind: 'tool_result',
      status: 'failed',
      summary: 'Tool failed: API rate limit exceeded',
    })
  })

  it('returns null when no result data', () => {
    const session: PrimeSession = {
      id: 'session-3',
      trigger_type: 'message',
      trigger_payload: {},
      prompt_templates: {},
      reasoning_summary: '',
      actions_taken: [{ tool_name: 'weather_api' }],
      token_count: 150,
      status: 'completed',
      started_at: '2026-05-25T10:00:00Z',
    }

    expect(deriveChatEventFromToolResult(session)).toBeNull()
  })
})

// ─── deriveChatEventFromWorkItem Tests ───────────────────────────────────────

describe('deriveChatEventFromWorkItem', () => {
  it('derives work item event correctly', () => {
    const workItem: RuntimeWorkItem = {
      id: 'work-1',
      title: 'Process customer request',
      status: 'active',
      priority: 'high',
      lane: 'support',
      owner_label: 'Agent Alpha',
      created_at: '2026-05-25T10:00:00Z',
      updated_at: '2026-05-25T10:00:00Z',
      metadata: {},
    }

    const event = deriveChatEventFromWorkItem(workItem)

    expect(event).toMatchObject({
      id: 'work-work-1',
      kind: 'goal',
      actorLabel: 'Agent Alpha',
      status: 'running',
      summary: 'Process customer request - active',
    })
  })

  it('derives blocked status correctly', () => {
    const workItem: RuntimeWorkItem = {
      id: 'work-2',
      title: 'Blocked task',
      status: 'blocked',
      priority: 'medium',
      lane: 'development',
      owner_label: 'Agent Beta',
      created_at: '2026-05-25T10:00:00Z',
      updated_at: '2026-05-25T10:00:00Z',
      metadata: {},
    }

    const event = deriveChatEventFromWorkItem(workItem)

    expect(event.status).toBe('blocked')
  })
})

// ─── deriveChatEventFromDelegation Tests ─────────────────────────────────────

describe('deriveChatEventFromDelegation', () => {
  it('derives delegation event correctly', () => {
    const delegation: RuntimeDelegation = {
      id: 'deleg-1',
      from_agent_id: 'agent-alpha',
      to_agent_id: 'agent-beta',
      status: 'running',
      capability: 'Process customer request',
      request: {},
      result: {},
      trace: [],
      created_at: '2026-05-25T10:00:00Z',
      updated_at: '2026-05-25T10:00:00Z',
    }

    const event = deriveChatEventFromDelegation(delegation)

    expect(event).toMatchObject({
      id: 'deleg-deleg-1',
      kind: 'delegation',
      actorLabel: 'agent-alpha',
      summary: 'Delegated to agent-beta: Process customer request',
    })

    expect(event.actions).toEqual([
      { label: 'Retry', type: 'retry' },
      { label: 'Cancel', type: 'cancel' },
    ])
  })
})

// ─── deriveChatEventFromApproval Tests ───────────────────────────────────────

describe('deriveChatEventFromApproval', () => {
  it('derives pending approval correctly', () => {
    const approval: Approval = {
      approval_id: 'approv-1',
      run_id: 'run-123',
      action: 'Deploy to production',
      status: 'pending',
      created_at: '2026-05-25T10:00:00Z',
    }

    const event = deriveChatEventFromApproval(approval)

    expect(event).toMatchObject({
      id: 'approv-approv-1',
      kind: 'approval',
      status: 'pending',
      summary: 'Approval requested: Deploy to production',
    })

    expect(event.actions).toEqual([
      { label: 'Approve', type: 'approve' },
      { label: 'Deny', type: 'deny' },
    ])
  })

  it('derives approved approval correctly', () => {
    const approval: Approval = {
      approval_id: 'approv-2',
      run_id: 'run-123',
      action: 'Deploy to production',
      status: 'approved',
      created_at: '2026-05-25T10:00:00Z',
      decided_at: '2026-05-25T10:05:00Z',
    }

    const event = deriveChatEventFromApproval(approval)

    expect(event.status).toBe('resolved')
  })

  it('deries denied approval correctly', () => {
    const approval: Approval = {
      approval_id: 'approv-3',
      run_id: 'run-123',
      action: 'Deploy to production',
      status: 'denied',
      created_at: '2026-05-25T10:00:00Z',
      decided_at: '2026-05-25T10:05:00Z',
    }

    const event = deriveChatEventFromApproval(approval)

    expect(event.status).toBe('failed')
  })
})

// ─── deriveChatEventFromRuntimeEvent Tests ───────────────────────────────────

describe('deriveChatEventFromRuntimeEvent', () => {
  it('derives approval runtime event', () => {
    const event: RuntimeEvent = {
      id: 'runtime-event-1',
      event_type: 'approval.requested',
      actor: 'Prime',
      payload: { approval_id: 'approv-1' },
      created_at: '2026-05-25T10:00:00Z',
    }

    const result = deriveChatEventFromRuntimeEvent(event)

    expect(result.kind).toBe('approval')
  })

  it('derives delegation runtime event', () => {
    const event: RuntimeEvent = {
      id: 'runtime-event-2',
      event_type: 'delegation.created',
      actor: 'Prime',
      payload: { delegation_id: 'deleg-1' },
      created_at: '2026-05-25T10:00:00Z',
    }

    const result = deriveChatEventFromRuntimeEvent(event)

    expect(result.kind).toBe('delegation')
  })

  it('derives system runtime event', () => {
    const event: RuntimeEvent = {
      id: 'runtime-event-3',
      event_type: 'session.started',
      actor: 'System',
      payload: { session_id: 'session-1' },
      created_at: '2026-05-25T10:00:00Z',
    }

    const result = deriveChatEventFromRuntimeEvent(event)

    expect(result.kind).toBe('system')
  })
})

// ─── deriveChatEventsFromThread Tests ────────────────────────────────────────

describe('deriveChatEventsFromThread', () => {
  it('derives events from all sources', () => {
    const messages: ThreadMessage[] = [
      {
        id: 'msg-1',
        thread_id: 'thread-1',
        role: 'user',
        sender: 'Operator',
        content: 'Hello',
        metadata: {},
        created_at: '2026-05-25T10:00:00Z',
      },
    ]

    const workItems: RuntimeWorkItem[] = [
      {
        id: 'work-1',
        title: 'Task 1',
        status: 'active',
        priority: 'high',
        lane: 'dev',
        owner_label: 'Agent Alpha',
        created_at: '2026-05-25T10:00:01Z',
        updated_at: '2026-05-25T10:00:01Z',
        metadata: {},
      },
    ]

    const events = deriveChatEventsFromThread(messages, workItems)

    expect(events).toHaveLength(2)
    expect(events[0].kind).toBe('message')
    expect(events[1].kind).toBe('goal')
  })

  it('sorts events by timestamp', () => {
    const messages: ThreadMessage[] = [
      {
        id: 'msg-2',
        thread_id: 'thread-1',
        role: 'user',
        sender: 'Operator',
        content: 'Later message',
        metadata: {},
        created_at: '2026-05-25T10:00:02Z',
      },
      {
        id: 'msg-1',
        thread_id: 'thread-1',
        role: 'user',
        sender: 'Operator',
        content: 'Earlier message',
        metadata: {},
        created_at: '2026-05-25T10:00:00Z',
      },
    ]

    const events = deriveChatEventsFromThread(messages)

    expect(events[0].summary).toBe('Earlier message')
    expect(events[1].summary).toBe('Later message')
  })

  it('includes delegations and approvals', () => {
    const messages: ThreadMessage[] = []
    const workItems: RuntimeWorkItem[] = []
    const delegations: RuntimeDelegation[] = [
      {
        id: 'deleg-1',
        from_agent_id: 'agent-alpha',
        to_agent_id: 'agent-beta',
        status: 'running',
        capability: 'Task',
        request: {},
        result: {},
        trace: [],
        created_at: '2026-05-25T10:00:00Z',
        updated_at: '2026-05-25T10:00:00Z',
      },
    ]
    const approvals: Approval[] = [
      {
        approval_id: 'approv-1',
        run_id: 'run-1',
        action: 'Deploy',
        status: 'pending',
        created_at: '2026-05-25T10:00:01Z',
      },
    ]

    const events = deriveChatEventsFromThread(messages, workItems, delegations, approvals)

    expect(events).toHaveLength(2)
    expect(events.find((e) => e.kind === 'delegation')).toBeDefined()
    expect(events.find((e) => e.kind === 'approval')).toBeDefined()
  })
})

// ─── deriveChatEventsFromPrimeSession Tests ──────────────────────────────────

describe('deriveChatEventsFromPrimeSession', () => {
  it('derives thinking, tool call, and tool result from session', () => {
    const session: PrimeSession = {
      id: 'session-1',
      trigger_type: 'message',
      trigger_payload: {},
      prompt_templates: {},
      reasoning_summary: 'Thinking...',
      actions_taken: [
        { tool_name: 'weather_api', type: 'function' },
        { result: { success: true } },
      ],
      token_count: 300,
      status: 'completed',
      started_at: '2026-05-25T10:00:00Z',
    }

    const events = deriveChatEventsFromPrimeSession(session)

    expect(events).toHaveLength(3)
    expect(events[0].kind).toBe('thinking')
    expect(events[1].kind).toBe('tool_call')
    expect(events[2].kind).toBe('tool_result')
  })

  it('handles session with only thinking', () => {
    const session: PrimeSession = {
      id: 'session-2',
      trigger_type: 'message',
      trigger_payload: {},
      prompt_templates: {},
      reasoning_summary: 'Thinking...',
      actions_taken: [],
      token_count: 100,
      status: 'completed',
      started_at: '2026-05-25T10:00:00Z',
    }

    const events = deriveChatEventsFromPrimeSession(session)

    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('thinking')
  })
})

// ─── Context Attachment Availability Tests ───────────────────────────────────

describe('Context Attachment Availability', () => {
  it('handles restricted attachments correctly', () => {
    const message: ThreadMessage = {
      id: 'msg-1',
      thread_id: 'thread-1',
      role: 'user',
      sender: 'Operator',
      content: 'Here is the file',
      metadata: {
        attachments: [
          {
            name: 'secret.pdf',
            type: 'file',
            availability: 'restricted',
            sourceLabel: 'System',
          },
        ],
      },
      created_at: '2026-05-25T10:00:00Z',
    }

    // Use the public API to derive events which internally calls deriveContextAttachments
    const event = deriveChatEventFromMessage(message)

    expect(event.attachments).toHaveLength(1)
    expect(event.attachments[0].availability).toBe('restricted')
  })

  it('handles unavailable attachments', () => {
    // Create a message with file references in payload
    const message: ThreadMessage = {
      id: 'msg-1',
      thread_id: 'thread-1',
      role: 'user',
      sender: 'Operator',
      content: 'Here are the files',
      metadata: {},
      created_at: '2026-05-25T10:00:00Z',
    }

    // Use the public API to derive events
    const event = deriveChatEventFromMessage(message)

    // Test that empty payload returns empty attachments
    expect(event.attachments).toHaveLength(0)
  })
})

// ─── Ordering and Restricted Summaries Tests ─────────────────────────────────

describe('Ordering and Restricted Summaries', () => {
  it('handles out-of-order events correctly', () => {
    const messages: ThreadMessage[] = [
      {
        id: 'msg-2',
        thread_id: 'thread-1',
        role: 'user',
        sender: 'Operator',
        content: 'Second message',
        metadata: {},
        created_at: '2026-05-25T10:00:02Z', // Later timestamp
      },
      {
        id: 'msg-1',
        thread_id: 'thread-1',
        role: 'user',
        sender: 'Operator',
        content: 'First message',
        metadata: {},
        created_at: '2026-05-25T10:00:01Z', // Earlier timestamp
      },
    ]

    const events = deriveChatEventsFromThread(messages)

    // Events should be sorted by timestamp, not arrival order
    expect(events[0].summary).toBe('First message')
    expect(events[1].summary).toBe('Second message')
  })

  it('handles restricted summaries in details', () => {
    const session: PrimeSession = {
      id: 'session-1',
      trigger_type: 'message',
      trigger_payload: {},
      prompt_templates: {},
      reasoning_summary: 'Restricted thinking process that should not be fully exposed',
      actions_taken: [],
      token_count: 100,
      status: 'completed',
      started_at: '2026-05-25T10:00:00Z',
    }

    const event = deriveChatEventFromThinking(session)

    // The event might be null if no reasoning data, so check first
    expect(event?.details).toBe('Restricted thinking process that should not be fully exposed')
  })
})
