import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApprovalQueue } from '../../src/components/ApprovalQueue'
import type { Approval } from '../../src/types'

const approvals: Approval[] = [
  { approval_id: 'a1', run_id: 'r1', action: 'write_file', status: 'pending', created_at: '' },
  { approval_id: 'a2', run_id: 'r2', action: 'delete_file', status: 'pending', created_at: '' },
]

describe('ApprovalQueue', () => {
  it('renders all pending approvals', () => {
    render(<ApprovalQueue approvals={approvals} onApprove={vi.fn()} onDeny={vi.fn()} />)
    expect(screen.getByText('write_file')).toBeInTheDocument()
    expect(screen.getByText('delete_file')).toBeInTheDocument()
  })

  it('calls onApprove with approval_id when Approve clicked', () => {
    const onApprove = vi.fn()
    render(<ApprovalQueue approvals={[approvals[0]]} onApprove={onApprove} onDeny={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(onApprove).toHaveBeenCalledWith('a1')
  })

  it('calls onDeny with approval_id when Deny clicked', () => {
    const onDeny = vi.fn()
    render(<ApprovalQueue approvals={[approvals[0]]} onApprove={vi.fn()} onDeny={onDeny} />)
    fireEvent.click(screen.getByRole('button', { name: /deny/i }))
    expect(onDeny).toHaveBeenCalledWith('a1')
  })

  it('shows empty state when no pending approvals', () => {
    render(<ApprovalQueue approvals={[]} onApprove={vi.fn()} onDeny={vi.fn()} />)
    expect(screen.getByText(/no pending/i)).toBeInTheDocument()
  })
})
