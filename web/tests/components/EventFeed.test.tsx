import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EventFeed } from '../../src/components/EventFeed'
import type { AgentEvent } from '../../src/types'

const events: AgentEvent[] = [
  { id: '1', agent: 'langgraph', type: 'run.started', payload: { run_id: 'abc' }, created_at: '2026-04-29T12:00:00Z' },
  { id: '2', agent: 'raclette', type: 'session.active', payload: { id: 's1' }, created_at: '2026-04-29T11:59:00Z' },
]

describe('EventFeed', () => {
  it('renders all events', () => {
    render(<EventFeed events={events} connected={true} />)
    expect(screen.getByText('run.started')).toBeInTheDocument()
    expect(screen.getByText('session.active')).toBeInTheDocument()
  })

  it('shows agent name for each event', () => {
    render(<EventFeed events={events} connected={true} />)
    expect(screen.getAllByText('langgraph')).toHaveLength(1)
    expect(screen.getAllByText('raclette')).toHaveLength(1)
  })

  it('shows disconnected indicator when not connected', () => {
    render(<EventFeed events={[]} connected={false} />)
    expect(screen.getByText(/disconnected/i)).toBeInTheDocument()
  })

  it('shows empty state when no events', () => {
    render(<EventFeed events={[]} connected={true} />)
    expect(screen.getByText(/No activity yet/i)).toBeInTheDocument()
  })
})
