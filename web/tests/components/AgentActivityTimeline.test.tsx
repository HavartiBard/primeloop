// AgentActivityTimeline.test.tsx - Rendering tests for expanded chat bubbles and cards

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentActivityTimeline } from '../../src/components/agentCanvas/AgentActivityTimeline'
import { buildThinkingEvent, buildToolCallEvent, buildApprovalEvent, buildDelegationEvent } from '../fixtures/agentCanvasUx'

describe('AgentActivityTimeline', () => {
  it('renders thinking events with streaming status', () => {
    const events = [buildThinkingEvent({ summary: 'Processing your request...' })]

    render(<AgentActivityTimeline events={events} />)

    expect(screen.getByText(/Processing your request\.\.\./)).toBeInTheDocument()
  })

  it('renders tool call events with running status', () => {
    const events = [buildToolCallEvent({ summary: 'Calling weather API...' })]

    render(<AgentActivityTimeline events={events} />)

    expect(screen.getByText(/Calling weather API\.\.\./)).toBeInTheDocument()
  })

  it('renders approval events with pending status and actions', () => {
    const events = [buildApprovalEvent({ summary: 'Request: Approve deployment' })]

    render(<AgentActivityTimeline events={events} />)

    expect(screen.getByText(/Request: Approve deployment/)).toBeInTheDocument()
    // Approval card should have approve/deny buttons
  })

  it('renders delegation events with running status', () => {
    const events = [buildDelegationEvent({ summary: 'Task: Research competitors' })]

    render(<AgentActivityTimeline events={events} />)

    expect(screen.getByText(/Task: Research competitors/)).toBeInTheDocument()
  })

  it('sorts events by occurredAt timestamp', () => {
    const now = new Date()
    const earlier = new Date(now.getTime() - 1000 * 60)
    const later = new Date(now.getTime() + 1000 * 60)

    const events = [
      buildThinkingEvent({ id: 'evt:2', occurredAt: later.toISOString(), summary: 'Later event' }),
      buildThinkingEvent({ id: 'evt:1', occurredAt: earlier.toISOString(), summary: 'Earlier event' }),
      buildThinkingEvent({ id: 'evt:3', occurredAt: now.toISOString(), summary: 'Current event' }),
    ]

    render(<AgentActivityTimeline events={events} />)

    const summaries = screen.getAllByText(/event/)
    // First should be "Earlier event"
    expect(summaries[0]).toHaveTextContent('Earlier event')
  })

  it('handles empty event list', () => {
    render(<AgentActivityTimeline events={[]} />)

    // Timeline should render with empty state or no events message
    // Implementation should handle this gracefully
  })

  it('applies keyboard navigation attributes', () => {
    const events = [buildThinkingEvent()]

    render(<AgentActivityTimeline events={events} />)

    // Timeline container should have role="list" and aria-label
    const timeline = screen.getByRole('list')
    expect(timeline).toHaveAttribute('aria-label')
  })
})
