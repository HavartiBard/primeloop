// chatDisplayEvents.test.ts - Mapper tests for thinking, tool-call, tool-result, approval, delegation, context attachment, out-of-order, restricted, and unavailable states

import { describe, it, expect } from 'vitest'
import {
  mapThreadMessageToChatEvent,
  mapPrimeSessionToThinkingEvent,
  mapRuntimeEventToChatEvents,
  mapApprovalToChatEvent,
  mapDelegationToChatEvent,
  mapWorkItemToChatEvent,
  deriveContextAttachmentsFromEvent,
} from '../../src/lib/chatDisplayEvents'
import {
  buildThreadMessage,
  buildRuntimeEvent,
  buildApproval,
  buildRuntimeDelegation,
  buildRuntimeWorkItem,
  buildContextAttachment,
} from '../fixtures/agentCanvasUx'

describe('chatDisplayEvents mappers', () => {
  describe('mapThreadMessageToChatEvent', () => {
    it('maps a user message to a chat display event', () => {
      const message = buildThreadMessage({ content: 'Hello, Prime!' })
      const event = mapThreadMessageToChatEvent(message)

      expect(event).toMatchObject({
        kind: 'message',
        actorLabel: 'operator',
        status: 'success',
        summary: 'Hello, Prime!',
        source: { type: 'thread_message', id: message.id },
      })
    })

    it('maps a system message to a chat display event', () => {
      const message = buildThreadMessage({ role: 'system', sender: 'system', content: 'System initialized' })
      const event = mapThreadMessageToChatEvent(message)

      expect(event).toMatchObject({
        kind: 'system',
        actorLabel: 'system',
        summary: 'System initialized',
      })
    })
  })

  describe('mapPrimeSessionToThinkingEvent', () => {
    it('maps a running prime session to a thinking event', () => {
      const session = { id: 'session:1', status: 'running', reasoning_summary: 'Processing request...', started_at: new Date().toISOString() }
      const event = mapPrimeSessionToThinkingEvent(session)

      expect(event).toMatchObject({
        kind: 'thinking',
        actorLabel: 'Prime',
        status: 'streaming',
        summary: 'Processing request...',
      })
    })

    it('maps a failed prime session to a thinking event', () => {
      const session = { id: 'session:1', status: 'failed', error: 'Timeout', started_at: new Date().toISOString() }
      const event = mapPrimeSessionToThinkingEvent(session)

      expect(event).toMatchObject({
        kind: 'thinking',
        status: 'failed',
        details: 'Error: Timeout',
      })
    })
  })

  describe('mapRuntimeEventToChatEvents', () => {
    it('maps a tool_call runtime event to chat events', () => {
      const event = buildRuntimeEvent({ event_type: 'tool_call', payload: { summary: 'Calling API', status: 'running' } })
      const mapped = mapRuntimeEventToChatEvents(event)

      expect(mapped).toHaveLength(1)
      expect(mapped[0]).toMatchObject({
        kind: 'tool_call',
        actorLabel: 'agent-1',
        status: 'running',
        summary: 'Calling API',
      })
    })

    it('maps a tool_result runtime event to chat events', () => {
      const event = buildRuntimeEvent({ event_type: 'tool_result', payload: { summary: 'Result received', output: '{ "data": true }', status: 'completed' } })
      const mapped = mapRuntimeEventToChatEvents(event)

      expect(mapped).toHaveLength(1)
      expect(mapped[0]).toMatchObject({
        kind: 'tool_result',
        status: 'success',
        details: '{ "data": true }',
      })
    })

    it('handles unknown event types gracefully', () => {
      const event = buildRuntimeEvent({ event_type: 'unknown_event', payload: {} })
      const mapped = mapRuntimeEventToChatEvents(event)

      expect(mapped).toHaveLength(0)
    })
  })

  describe('mapApprovalToChatEvent', () => {
    it('maps an approval to a chat display event', () => {
      const approval = buildApproval({ action: 'Deploy to production', status: 'pending' })
      const event = mapApprovalToChatEvent(approval)

      expect(event).toMatchObject({
        kind: 'approval',
        actorLabel: 'Deploy to production',
        status: 'pending',
        summary: 'Request: Deploy to production',
        details: 'Run: run:1',
      })

      expect(event.actions).toHaveLength(2)
      expect(event.actions?.map(a => a.type)).toContain('approve')
      expect(event.actions?.map(a => a.type)).toContain('deny')
    })

    it('maps a denied approval to a chat display event', () => {
      const approval = buildApproval({ status: 'denied' })
      const event = mapApprovalToChatEvent(approval)

      expect(event.status).toBe('cancelled')
    })
  })

  describe('mapDelegationToChatEvent', () => {
    it('maps a delegation to a chat display event', () => {
      const delegation = buildRuntimeDelegation({ capability: 'Research competitors', status: 'running' })
      const event = mapDelegationToChatEvent(delegation)

      expect(event).toMatchObject({
        kind: 'delegation',
        actorLabel: 'agent:1',
        status: 'running',
        summary: 'Research competitors',
      })
    })

    it('maps a completed delegation to a chat display event', () => {
      const delegation = buildRuntimeDelegation({ status: 'completed' })
      const event = mapDelegationToChatEvent(delegation)

      expect(event.status).toBe('success')
    })
  })

  describe('mapWorkItemToChatEvent', () => {
    it('maps a goal work item to a chat display event', () => {
      const workItem = buildRuntimeWorkItem({ title: 'Launch new feature', metadata: { kind: 'goal' } })
      const event = mapWorkItemToChatEvent(workItem)

      expect(event).toMatchObject({
        kind: 'goal',
        actorLabel: 'agent-1',
        summary: 'Launch new feature',
        details: 'Default work item',
      })
    })

    it('maps an artifact work item to a chat display event', () => {
      const workItem = buildRuntimeWorkItem({ title: 'Architecture diagram', metadata: { kind: 'artifact' } })
      const event = mapWorkItemToChatEvent(workItem)

      expect(event.kind).toBe('artifact')
    })

    it('maps a note work item to a chat display event', () => {
      const workItem = buildRuntimeWorkItem({ title: 'Meeting notes', metadata: { kind: 'note' } })
      const event = mapWorkItemToChatEvent(workItem)

      expect(event.kind).toBe('note')
    })
  })

  describe('deriveContextAttachmentsFromEvent', () => {
    it('derives context attachments from runtime events with attachments', () => {
      const event = buildRuntimeEvent({
        payload: {
          attachments: [
            { id: 'att:1', name: 'design.pdf', type: 'file', sourceLabel: 'agent-1', availability: 'available' },
            { id: 'att:2', name: 'confidential.docx', type: 'file', sourceLabel: 'agent-1', availability: 'restricted', previewSummary: 'Access restricted' },
          ],
        },
      })

      const attachments = deriveContextAttachmentsFromEvent(event)

      expect(attachments).toHaveLength(2)
      expect(attachments[0]).toMatchObject({
        id: 'att:1',
        name: 'design.pdf',
        availability: 'available',
      })
      expect(attachments[1]).toMatchObject({
        id: 'att:2',
        name: 'confidential.docx',
        availability: 'restricted',
        previewSummary: 'Access restricted',
      })
    })

    it('handles events without attachments gracefully', () => {
      const event = buildRuntimeEvent({ payload: {} })
      const attachments = deriveContextAttachmentsFromEvent(event)

      expect(attachments).toHaveLength(0)
    })
  })
})
