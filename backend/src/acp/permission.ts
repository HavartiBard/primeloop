import type pg from 'pg';
import { ensurePendingApproval } from '../approvals.js';

// Types for the ACP permission request/response based on v0.12.0 protocol
export interface SessionRequestPermissionRequestParams {
  sessionId: string;
  toolCall: {
    name: string;
    args: Record<string, unknown>;
  };
  options: {
    optionId: string;
    name: string;
    kind: 'allow_once' | 'deny_once' | 'allow_always' | 'deny_always';
  }[];
}

// v0.12.0 permission result only supports granted/denied outcomes
// selected/cancelled are handled internally by the policy
export interface SessionRequestPermissionResult {
  outcome: 'granted' | 'denied';
}

export interface PermissionConfig {
  lowRiskTools?: string[];
  sensitivePatterns?: string[];
  default?: 'gate' | 'allow';
  timeoutMs?: number;
}

export interface PermissionContext {
  agentId: string;
  sessionId: string;
  delegationId?: string;
  config: PermissionConfig;
}

const approvalRegistry = new Map<string, { policy: PermissionPolicy; context: PermissionContext }>();

export function lookupApprovalPolicy(approvalId: string) {
  return approvalRegistry.get(approvalId);
}

export class PermissionPolicy {
  private pendingPermissions = new Map<string, {
    resolve: (result: SessionRequestPermissionResult) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    options: { optionId: string; name: string; kind: string }[];
  }>();

  constructor(private pool: pg.Pool) {}

  public async resolvePermission(
    req: SessionRequestPermissionRequestParams,
    context: PermissionContext
  ): Promise<SessionRequestPermissionResult> {
    const { sessionId, toolCall, options } = req;
    const { agentId, delegationId, config } = context;
    const timeoutMs = config.timeoutMs ?? 30000;
    const lowRiskTools = config.lowRiskTools ?? ['read_file', 'list_directory', 'search_files'];

    // 1. Classify
    const isLowRisk = lowRiskTools.includes(toolCall.name);
    const classification = isLowRisk ? 'low_risk' : 'sensitive';

    // 2. Auto-resolve low risk
    if (isLowRisk) {
      const optionId = this.findOptionId(options, 'allow_once') || options[0]?.optionId;
      
      await this.recordRuntimeEvent(agentId, delegationId, 'acp.permission.auto_resolved', {
        session_id: sessionId,
        tool_name: toolCall.name,
        classification: 'low_risk',
        outcome: 'auto_allowed',
      });

      // v0.12.0 only supports granted/denied outcomes
      return optionId ? { outcome: 'granted' } : { outcome: 'denied' };
    }

    // 3. Gate sensitive requests
    const approvalId = `acp-perm-${crypto.randomUUID()}`;
    
    await this.recordRuntimeEvent(agentId, delegationId, 'acp.permission.gated', {
      session_id: sessionId,
      tool_name: toolCall.name,
      classification: 'sensitive',
      approval_id: approvalId,
    });

    // Create approval queue item
    await ensurePendingApproval(this.pool, {
      approval_id: approvalId,
      run_id: delegationId ?? sessionId,
      action: `ACP Tool: ${toolCall.name}`,
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        this.pendingPermissions.delete(approvalId);
        approvalRegistry.delete(approvalId);
        const optionId = this.findOptionId(options, 'reject_once');
        
        await this.recordRuntimeEvent(agentId, delegationId, 'acp.permission.timeout', {
          session_id: sessionId,
          tool_name: toolCall.name,
          approval_id: approvalId,
          outcome: 'timeout_denied',
        });

        // v0.12.0 only supports granted/denied outcomes
        resolve(optionId ? { outcome: 'granted' } : { outcome: 'denied' });
      }, timeoutMs);

      this.pendingPermissions.set(approvalId, {
        resolve,
        reject,
        timeout,
        options,
      });
      
      approvalRegistry.set(approvalId, { policy: this, context });
    });
  }

  public async handleApprovalDecision(
    approvalId: string,
    decision: 'approved' | 'denied',
    context: PermissionContext
  ): Promise<void> {
    const pending = this.pendingPermissions.get(approvalId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingPermissions.delete(approvalId);
    approvalRegistry.delete(approvalId);

    const kind = decision === 'approved' ? 'allow_once' : 'reject_once';
    const optionId = this.findOptionId(pending.options, kind);

    await this.recordRuntimeEvent(
      context.agentId,
      context.delegationId,
      decision === 'approved' ? 'acp.permission.approved' : 'acp.permission.denied',
      { approval_id: approvalId, outcome: decision }
    );

    if (optionId) {
      // v0.12.0 only supports granted/denied outcomes
      pending.resolve({ outcome: decision === 'approved' ? 'granted' : 'denied' });
    } else {
      pending.resolve({ outcome: 'denied' });
    }
  }

  public cancelPendingPermissions(agentId: string, sessionId: string, delegationId?: string): void {
    for (const [approvalId, pending] of this.pendingPermissions.entries()) {
      clearTimeout(pending.timeout);
      this.pendingPermissions.delete(approvalId);
      approvalRegistry.delete(approvalId);
      
      void this.recordRuntimeEvent(agentId, delegationId, 'acp.permission.cancelled', {
        session_id: sessionId,
        approval_id: approvalId,
        outcome: 'cancelled',
      });

      // v0.12.0 only supports granted/denied outcomes
      pending.resolve({ outcome: 'denied' });
    }
  }

  private findOptionId(options: { optionId: string; name: string; kind: string }[], preferredKind: string): string | undefined {
    const exact = options.find((opt) => opt.kind === preferredKind);
    if (exact) return exact.optionId;

    // Fallback to closest polarity
    if (preferredKind.startsWith('allow')) {
      return options.find((opt) => opt.kind.startsWith('allow'))?.optionId;
    }
    if (preferredKind.startsWith('reject')) {
      return options.find((opt) => opt.kind.startsWith('reject'))?.optionId;
    }

    return undefined;
  }

  private async recordRuntimeEvent(
    agentId: string,
    delegationId: string | undefined,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO runtime_events (event_type, actor, delegation_id, payload)
       VALUES ($1, $2, $3, $4)`,
      [eventType, 'permission-policy', delegationId ?? null, JSON.stringify({ agent_id: agentId, ...payload })]
    );
  }
}
