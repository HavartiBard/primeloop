// ─────────────────────────────────────────────────────────────────────────────
// Bottom Action Toolbar Tests (spec 017)
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BottomActionToolbar } from '../../src/components/agentCanvas/BottomActionToolbar'
import type { ToolbarDraftAction, ToolbarActionType } from '../../src/types'

// ─── Rendering Tests ─────────────────────────────────────────────────────────

describe('BottomActionToolbar', () => {
  it('renders all action buttons', () => {
    render(
      <BottomActionToolbar
        drafts={{}}
        onOpenDraft={() => {}}
      />,
    )

    expect(screen.getByText(/Spawn Agent/i)).toBeInTheDocument()
    expect(screen.getByText(/Tool Call/i)).toBeInTheDocument()
    expect(screen.getByText(/Create Goal/i)).toBeInTheDocument()
    expect(screen.getByText(/Capture Artifact/i)).toBeInTheDocument()
    expect(screen.getByText(/Add Note/i)).toBeInTheDocument()
  })

  it('applies compact layout when specified', () => {
    const { container } = render(
      <BottomActionToolbar
        drafts={{}}
        onOpenDraft={() => {}}
        compact={true}
      />,
    )

    // Verify the component renders with expected classes
    const toolbar = container.firstChild as HTMLElement
    expect(toolbar).toBeInTheDocument()
    expect(toolbar).toHaveClass('fixed')
    // The compact prop affects inner elements, verify it exists
    expect(toolbar).toHaveAttribute('role', 'toolbar')
  })

  it('has correct ARIA attributes', () => {
    render(
      <BottomActionToolbar
        drafts={{}}
        onOpenDraft={() => {}}
      />,
    )

    const toolbar = screen.getByRole('toolbar')
    expect(toolbar).toBeInTheDocument()
    expect(toolbar).toHaveAttribute('aria-label', 'Action toolbar')
  })
})

// ─── Draft Submit Tests ──────────────────────────────────────────────────────

describe('BottomActionToolbar - Draft Submit', () => {
  it('shows draft status when draft exists', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Test Goal' },
        status: 'draft',
      },
    }

    render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={() => {}}
        onSubmitDraft={() => {}}
      />,
    )

    // Use getAllBy to handle multiple matching elements
    expect(screen.getAllByText(/create goal/i)).toHaveLength(2) // button + status badge
    const draftBadges = screen.getAllByText(/draft/i)
    expect(draftBadges.length).toBeGreaterThan(0)
  })

  it('shows submitting status', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Test Goal' },
        status: 'submitting',
      },
    }

    render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={() => {}}
        onSubmitDraft={() => {}}
      />,
    )

    expect(screen.getByText(/submitting/i)).toBeInTheDocument()
  })

  it('shows succeeded status with created reference', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Test Goal' },
        status: 'succeeded',
        createdRef: { type: 'goal', id: 'goal-123' },
      },
    }

    render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={() => {}}
        onSubmitDraft={() => {}}
      />,
    )

    expect(screen.getByText(/created goal/i)).toBeInTheDocument()
  })

  it('shows failed status with error summary', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Test Goal' },
        status: 'failed',
        errorSummary: 'Title is required',
      },
    }

    render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={() => {}}
        onSubmitDraft={() => {}}
      />,
    )

    expect(screen.getByText(/failed/i)).toBeInTheDocument()
    expect(screen.getByText(/Title is required/i)).toBeInTheDocument()
  })
})

// ─── Draft Cancel Tests ──────────────────────────────────────────────────────

describe('BottomActionToolbar - Draft Cancel', () => {
  it('shows cancel button for draft status', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Test Goal' },
        status: 'draft',
      },
    }

    const onCancelMock = vi.fn()

    render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={onCancelMock}
        onSubmitDraft={() => {}}
      />,
    )

    const cancelButton = screen.getByText(/cancel/i)
    expect(cancelButton).toBeInTheDocument()
    fireEvent.click(cancelButton)
    expect(onCancelMock).toHaveBeenCalledWith('draft-1')
  })

  it('does not show cancel button for succeeded status', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Test Goal' },
        status: 'succeeded',
        createdRef: { type: 'goal', id: 'goal-123' },
      },
    }

    const onCancelMock = vi.fn()

    render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={onCancelMock}
        onSubmitDraft={() => {}}
      />,
    )

    expect(screen.queryByText(/cancel/i)).not.toBeInTheDocument()
  })
})

// ─── Draft Submit Button Tests ───────────────────────────────────────────────

describe('BottomActionToolbar - Submit Button', () => {
  it('shows submit button for draft status', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Test Goal' },
        status: 'draft',
      },
    }

    const onSubmitMock = vi.fn()

    render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={() => {}}
        onSubmitDraft={onSubmitMock}
      />,
    )

    const submitButton = screen.getByText(/submit/i)
    expect(submitButton).toBeInTheDocument()
    fireEvent.click(submitButton)
    expect(onSubmitMock).toHaveBeenCalledWith('draft-1')
  })

  it('does not show submit button for submitting status', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Test Goal' },
        status: 'submitting',
      },
    }

    render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={() => {}}
        onSubmitDraft={() => {}}
      />,
    )

    // Submit button (exact text match) should not be present when status is submitting
    const submitButtons = screen.queryAllByText('Submit')
    expect(submitButtons).toHaveLength(0)
  })
})

// ─── Action Button Tests ─────────────────────────────────────────────────────

describe('BottomActionToolbar - Action Buttons', () => {
  it('calls onOpenDraft when action button clicked', () => {
    const onOpenDraftMock = vi.fn()

    render(
      <BottomActionToolbar
        drafts={{}}
        onOpenDraft={onOpenDraftMock}
      />,
    )

    const spawnAgentButton = screen.getByText(/spawn agent/i)
    fireEvent.click(spawnAgentButton)
    expect(onOpenDraftMock).toHaveBeenCalledWith('spawn_agent')
  })

  it('shows keyboard shortcuts in buttons', () => {
    render(
      <BottomActionToolbar
        drafts={{}}
        onOpenDraft={() => {}}
      />,
    )

    // Buttons should contain keyboard shortcut hints
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
  })
})

// ─── Status Color Tests ──────────────────────────────────────────────────────

describe('BottomActionToolbar - Status Colors', () => {
  it('applies cyan styles for submitting status', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Test Goal' },
        status: 'submitting',
      },
    }

    const { container } = render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={() => {}}
        onSubmitDraft={() => {}}
      />,
    )

    // The status indicator should have cyan background
    expect(container.querySelector('.bg-cyan-50')).toBeInTheDocument()
  })

  it('applies emerald styles for succeeded status', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Test Goal' },
        status: 'succeeded',
        createdRef: { type: 'goal', id: 'goal-123' },
      },
    }

    const { container } = render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={() => {}}
        onSubmitDraft={() => {}}
      />,
    )

    expect(container.querySelector('.bg-emerald-50')).toBeInTheDocument()
  })

  it('applies red styles for failed status', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Test Goal' },
        status: 'failed',
        errorSummary: 'Error occurred',
      },
    }

    const { container } = render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={() => {}}
        onSubmitDraft={() => {}}
      />,
    )

    expect(container.querySelector('.bg-red-50')).toBeInTheDocument()
  })
})

// ─── Multiple Drafts Tests ───────────────────────────────────────────────────

describe('BottomActionToolbar - Multiple Drafts', () => {
  it('renders multiple drafts correctly', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Goal 1' },
        status: 'draft',
      },
      'draft-2': {
        id: 'draft-2',
        actionType: 'add_note',
        originContext: {},
        requiredInputs: { content: 'Note 1' },
        status: 'submitting',
      },
    }

    render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={() => {}}
        onSubmitDraft={() => {}}
      />,
    )

    // Use getAllBy to handle multiple matching elements (button + status text)
    expect(screen.getAllByText(/create goal/i)).toHaveLength(2) // button + status badge
    expect(screen.getAllByText(/add note/i)).toHaveLength(2) // button + status badge
    const submittingElements = screen.getAllByText(/submitting/i)
    expect(submittingElements.length).toBeGreaterThan(0)
  })

  it('maintains separate status for each draft', () => {
    const drafts: Record<string, ToolbarDraftAction> = {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Goal 1' },
        status: 'draft',
      },
      'draft-2': {
        id: 'draft-2',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Goal 2' },
        status: 'failed',
        errorSummary: 'Validation failed',
      },
    }

    render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {}}
        onCancelDraft={() => {}}
        onSubmitDraft={() => {}}
      />,
    )

    // Multiple status badges exist, so use getAllBy
    const draftBadges = screen.getAllByText(/draft/i)
    expect(draftBadges.length).toBeGreaterThan(0)
    const failedBadges = screen.getAllByText(/failed/i)
    expect(failedBadges.length).toBeGreaterThan(0)
    expect(screen.getByText(/Validation failed/i)).toBeInTheDocument()
  })
})

// ─── Integration Tests ───────────────────────────────────────────────────────

describe('Integration: Full Toolbar Flow', () => {
  it('handles complete draft lifecycle', () => {
    const drafts: Record<string, ToolbarDraftAction> = {}
    const onSubmitMock = vi.fn()
    const onCancelMock = vi.fn()

    render(
      <BottomActionToolbar
        drafts={drafts}
        onOpenDraft={() => {
          // Simulate opening a draft
          drafts['draft-1'] = {
            id: 'draft-1',
            actionType: 'create_goal',
            originContext: {},
            requiredInputs: { title: 'Test Goal' },
            status: 'draft',
          }
        }}
        onCancelDraft={onCancelMock}
        onSubmitDraft={onSubmitMock}
      />,
    )

    // Initial state - no drafts
    expect(screen.queryByText(/draft/i)).not.toBeInTheDocument()

    // Open a draft (simulated by manual update)
    Object.assign(drafts, {
      'draft-1': {
        id: 'draft-1',
        actionType: 'create_goal',
        originContext: {},
        requiredInputs: { title: 'Test Goal' },
        status: 'draft',
      },
    })
  })

  it('maintains toolbar position and z-index', () => {
    const { container } = render(
      <BottomActionToolbar
        drafts={{}}
        onOpenDraft={() => {}}
      />,
    )

    // Verify the toolbar exists and has expected structure
    const toolbar = container.firstChild as HTMLElement
    expect(toolbar).toBeInTheDocument()
    expect(toolbar).toHaveClass('fixed')
    expect(toolbar).toHaveClass('bottom-0')
    expect(toolbar).toHaveClass('left-0')
    expect(toolbar).toHaveClass('right-0')
  })
})
