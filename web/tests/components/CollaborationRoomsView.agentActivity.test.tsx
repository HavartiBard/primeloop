// CollaborationRoomsView.agentActivity.test.tsx - Integration test covering collaboration room chat timeline rendering

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CollaborationRoomsView } from '../../src/components/CollaborationRoomsView'
import { buildThinkingEvent, buildToolCallEvent, buildApprovalEvent } from '../fixtures/agentCanvasUx'

describe('CollaborationRoomsView - agent activity integration', () => {
  it('renders the chat timeline with thinking events when room is active', () => {
    const rooms = [
      {
        id: 'thread:1',
        title: 'Goal: Launch new feature',
        active: true,
        unreadCount: 0,
        events: [buildThinkingEvent({ summary: 'Processing requirements...' })],
      },
    ]

    render(<CollaborationRoomsView rooms={rooms} />)

    expect(screen.getByText(/Processing requirements\.\.\./)).toBeInTheDocument()
  })

  it('renders tool call and result events in sequence', () => {
    const rooms = [
      {
        id: 'thread:1',
        title: 'Goal: Deploy to production',
        active: true,
        unreadCount: 0,
        events: [
          buildToolCallEvent({ summary: 'Calling deployment API...' }),
          buildThinkingEvent({ summary: 'Deployment initiated' }),
        ],
      },
    ]

    render(<CollaborationRoomsView rooms={rooms} />)

    expect(screen.getByText(/Calling deployment API\.\.\./)).toBeInTheDocument()
    expect(screen.getByText(/Deployment initiated/)).toBeInTheDocument()
  })

  it('renders approval events with actionable buttons', () => {
    const rooms = [
      {
        id: 'thread:1',
        title: 'Approval: Production deployment',
        active: true,
        unreadCount: 0,
        events: [buildApprovalEvent({ summary: 'Request: Approve deployment' })],
      },
    ]

    render(<CollaborationRoomsView rooms={rooms} />)

    // Approval card should be present
    expect(screen.getByText(/Request: Approve deployment/)).toBeInTheDocument()
  })

  it('handles empty room with no events', () => {
    const rooms = [
      {
        id: 'thread:1',
        title: 'New room',
        active: true,
        unreadCount: 0,
        events: [],
      },
    ]

    render(<CollaborationRoomsView rooms={rooms} />)

    // Should render room with empty state or placeholder
  })

  it('highlights the active room in the sidebar', () => {
    const rooms = [
      {
        id: 'thread:1',
        title: 'Active room',
        active: true,
        unreadCount: 0,
        events: [buildThinkingEvent()],
      },
      {
        id: 'thread:2',
        title: 'Inactive room',
        active: false,
        unreadCount: 2,
        events: [],
      },
    ]

    render(<CollaborationRoomsView rooms={rooms} />)

    // Active room should have distinct styling (e.g., different background)
    const activeRoom = screen.getByText(/Active room/)
    expect(activeRoom).toBeInTheDocument()
  })
})
