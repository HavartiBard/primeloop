import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermissionPolicy, type PermissionConfig } from '../../src/acp/permission.js';
import { Pool } from 'pg';

vi.mock('pg', () => {
  return {
    Pool: vi.fn().mockImplementation(() => ({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
    })),
  };
});

vi.mock('../../src/approvals.js', () => {
  return {
    ensurePendingApproval: vi.fn().mockResolvedValue({ id: 'test-approval' }),
  };
});

describe('PermissionPolicy', () => {
  let policy: PermissionPolicy;
  let mockPool: any;

  beforeEach(() => {
    mockPool = new Pool();
    policy = new PermissionPolicy(mockPool);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('auto-resolves low-risk tools', async () => {
    const config: PermissionConfig = { lowRiskTools: ['read_file'] };
    const req = {
      sessionId: 's1',
      toolCall: { id: 't1', name: 'read_file', input: {} },
      options: [{ optionId: 'opt1', name: 'Allow once', kind: 'allow_once' }],
    };

    const result = await policy.resolvePermission(req as any, {
      agentId: 'agent-1',
      sessionId: 's1',
      config,
    });

    expect(result).toEqual({ outcome: 'selected', optionId: 'opt1' });
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO runtime_events'),
      expect.arrayContaining(['acp.permission.auto_resolved', 'permission-policy', null, expect.any(String)])
    );
  });

  it('gates sensitive tools and times out with deny', async () => {
    const config: PermissionConfig = { lowRiskTools: ['read_file'], timeoutMs: 10 }; // 10ms timeout for fast testing
    const req = {
      sessionId: 's1',
      toolCall: { id: 't1', name: 'execute_command', input: {} },
      options: [
        { optionId: 'opt1', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'opt2', name: 'Reject once', kind: 'reject_once' },
      ],
    };

    const promise = policy.resolvePermission(req as any, {
      agentId: 'agent-1',
      sessionId: 's1',
      config,
    });

    // Verify it created an approval item
    const { ensurePendingApproval } = await import('../../src/approvals.js');
    expect(ensurePendingApproval).toHaveBeenCalledWith(
      mockPool,
      expect.objectContaining({
        approval_id: expect.stringMatching(/^acp-perm-/),
        action: 'ACP Tool: execute_command',
      })
    );

    const result = await promise;
    expect(result).toEqual({ outcome: 'selected', optionId: 'opt2' }); // reject_once fallback
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO runtime_events'),
      expect.arrayContaining(['acp.permission.timeout', 'permission-policy', null, expect.any(String)])
    );
  });

  it('cancels pending permissions on abort', async () => {
    const config: PermissionConfig = { timeoutMs: 5000 };
    const req = {
      sessionId: 's1',
      toolCall: { id: 't1', name: 'execute_command', input: {} },
      options: [{ optionId: 'opt1', name: 'Reject once', kind: 'reject_once' }],
    };

    const promise = policy.resolvePermission(req as any, {
      agentId: 'agent-1',
      sessionId: 's1',
      config,
    });

    // Wait for resolvePermission to pass the await ensurePendingApproval and set up the pending promise
    await new Promise(resolve => setTimeout(resolve, 10));

    policy.cancelPendingPermissions('agent-1', 's1', 'delegation-1');

    const result = await promise;
    expect(result).toEqual({ outcome: 'cancelled' });
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO runtime_events'),
      expect.arrayContaining(['acp.permission.cancelled', 'permission-policy', 'delegation-1', expect.any(String)])
    );
  });

  it('falls back to closest polarity option if preferred kind is missing', async () => {
    const config: PermissionConfig = { lowRiskTools: [], timeoutMs: 10 };
    const req = {
      sessionId: 's1',
      toolCall: { id: 't1', name: 'execute_command', input: {} },
      options: [{ optionId: 'opt-deny', name: 'Deny always', kind: 'reject_always' }],
    };

    const promise = policy.resolvePermission(req as any, {
      agentId: 'agent-1',
      sessionId: 's1',
      config,
    });

    const result = await promise;
    // Should fall back to 'reject_always' since 'reject_once' is not available
    expect(result).toEqual({ outcome: 'selected', optionId: 'opt-deny' });
  });

  it('resolves pending permission when approved via handleApprovalDecision', async () => {
    const config: PermissionConfig = { lowRiskTools: [], timeoutMs: 5000 };
    const req = {
      sessionId: 's1',
      toolCall: { id: 't1', name: 'execute_command', input: {} },
      options: [
        { optionId: 'opt-allow', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'opt-deny', name: 'Reject once', kind: 'reject_once' },
      ],
    };

    const { ensurePendingApproval } = await import('../../src/approvals.js');
    
    const promise = policy.resolvePermission(req as any, {
      agentId: 'agent-1',
      sessionId: 's1',
      config,
    });

    // Wait for resolvePermission to pass the await ensurePendingApproval
    await new Promise(resolve => setTimeout(resolve, 10));

    // Capture the approvalId from the mock call
    const callArgs = (ensurePendingApproval as any).mock.calls[0][1];
    const approvalId = callArgs.approval_id;

    await policy.handleApprovalDecision(approvalId, 'approved', {
      agentId: 'agent-1',
      sessionId: 's1',
      config,
    });

    const result = await promise;
    expect(result).toEqual({ outcome: 'selected', optionId: 'opt-allow' });
  });

  it('resolves pending permission when denied via handleApprovalDecision', async () => {
    const config: PermissionConfig = { lowRiskTools: [], timeoutMs: 5000 };
    const req = {
      sessionId: 's1',
      toolCall: { id: 't1', name: 'execute_command', input: {} },
      options: [
        { optionId: 'opt-allow', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'opt-deny', name: 'Reject once', kind: 'reject_once' },
      ],
    };

    const { ensurePendingApproval } = await import('../../src/approvals.js');
    
    const promise = policy.resolvePermission(req as any, {
      agentId: 'agent-1',
      sessionId: 's1',
      config,
    });

    // Wait for resolvePermission to pass the await ensurePendingApproval
    await new Promise(resolve => setTimeout(resolve, 10));

    // Capture the approvalId from the mock call
    const callArgs = (ensurePendingApproval as any).mock.calls[0][1];
    const approvalId = callArgs.approval_id;

    await policy.handleApprovalDecision(approvalId, 'denied', {
      agentId: 'agent-1',
      sessionId: 's1',
      config,
    });

    const result = await promise;
    expect(result).toEqual({ outcome: 'selected', optionId: 'opt-deny' });
  });
});
