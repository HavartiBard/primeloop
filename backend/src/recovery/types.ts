// Recovery event types — Agentic Control Plane (spec 016)
// Matches data-model.md "Recovery Event" section and control-plane-api.yaml schema.

export type RecoverySeverity = 'low' | 'medium' | 'high' | 'critical';

export type RecoveryAction = 'retry' | 'reroute' | 'escalate' | 'request_approval' | 'stop';

export type RecoveryResultStatus = 'succeeded' | 'ongoing' | 'failed' | 'escalated';

export interface RecoveryEvent {
  id: string;
  goalId: string;
  workItemId?: string;
  detectedCondition: string;
  detectedAt: string; // ISO timestamp
  severity?: RecoverySeverity;
  selectedAction: RecoveryAction;
  actionReason?: string;
  resultStatus: RecoveryResultStatus;
  resultSummary?: string;
  createdAt: string;
}

export interface CreateRecoveryEventInput {
  goalId: string;
  workItemId?: string;
  detectedCondition: string;
  detectedAt: string;
  severity?: RecoverySeverity;
  selectedAction: RecoveryAction;
  actionReason?: string;
  resultStatus: RecoveryResultStatus;
  resultSummary?: string;
}
