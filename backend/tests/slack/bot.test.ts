import { describe, it, expect, vi } from 'vitest'
import { buildApprovalMessage } from '../../src/slack/bot.js'

describe('Slack message builder', () => {
  it('includes approval_id in button action_ids', () => {
    const blocks = buildApprovalMessage({
      approvalId: 'a1',
      runId: 'r1',
      action: 'write_file',
    })
    const actions = blocks.find((b: { type: string }) => b.type === 'actions')
    expect(JSON.stringify(actions)).toContain('approve:a1')
    expect(JSON.stringify(actions)).toContain('deny:a1')
  })

  it('includes action name in message text', () => {
    const blocks = buildApprovalMessage({ approvalId: 'a1', runId: 'r1', action: 'delete_file' })
    expect(JSON.stringify(blocks)).toContain('delete_file')
  })

  it('includes run_id in message text', () => {
    const blocks = buildApprovalMessage({ approvalId: 'a1', runId: 'run-xyz', action: 'write_file' })
    expect(JSON.stringify(blocks)).toContain('run-xyz')
  })

  it('approve button has primary style and deny button has danger style', () => {
    const blocks = buildApprovalMessage({ approvalId: 'a1', runId: 'r1', action: 'write_file' })
    const actions = blocks.find((b: { type: string }) => b.type === 'actions') as {
      elements: Array<{ style: string; action_id: string }>
    }
    const approve = actions.elements.find((e) => e.action_id.startsWith('approve:'))
    const deny = actions.elements.find((e) => e.action_id.startsWith('deny:'))
    expect(approve?.style).toBe('primary')
    expect(deny?.style).toBe('danger')
  })
})
