// Goals module types — Agentic Control Plane (spec 016)
// Enums, entity interfaces, and API request/response types.
// Field names copied exactly from data-model.md and control-plane-api.yaml.

// ─── Enums / Unions ──────────────────────────────────────────────

export type GoalStatus =
  | 'draft'
  | 'queued'
  | 'in_progress'
  | 'awaiting_approval'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WorkItemStatus =
  | 'queued'
  | 'in_progress'
  | 'awaiting_approval'
  | 'blocked'
  | 'retrying'
  | 'escalated'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentTier = 'prime' | 'durable' | 'ephemeral';

export type Domain =
  | 'homelab'
  | 'development'
  | 'personal_assistant'
  | 'cross_domain';

export type Priority = 'low' | 'normal' | 'high';

// ─── Entity Interfaces (from data-model.md) ──────────────────────

/** Goal — 16 fields */
export interface Goal {
  id: string;
  title: string;
  intent: string;
  domainSummary: string;
  status: GoalStatus;
  priority: Priority;
  requestedBy: string;
  ownedByAgentRole: string;
  currentSummary: string;
  resultSummary: string | null;
  riskSummary: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

/** WorkItem — 17 fields */
export interface WorkItem {
  id: string;
  goalId: string;
  parentWorkItemId: string | null;
  assignedAgentRole: string;
  domain: Domain;
  title: string;
  scope: string;
  status: WorkItemStatus;
  priority: Priority;
  dependsOn: string[] | null;
  decisionSummary: string | null;
  outcomeSummary: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

/** AgentRole — 9 fields */
export interface AgentRole {
  id: string;
  name: string;
  tier: AgentTier;
  domainCapabilities: string[];
  status: string;
  description: string;
  canRequestApproval: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Supporting Entity Interfaces (referenced by GoalDetail) ─────

export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled';

/** Approval — 11 fields */
export interface Approval {
  id: string;
  goalId: string;
  workItemId: string | null;
  requestedByAgentRole: string;
  actionSummary: string;
  riskSummary: string | null;
  status: ApprovalStatus;
  decisionNotes: string | null;
  expiresAt: string;
  resolvedAt: string | null;
  createdAt: string;
}

export type RecoveryEventSeverity = 'low' | 'medium' | 'high' | 'critical';

export type RecoveryEventAction =
  | 'retry'
  | 'reroute'
  | 'escalate'
  | 'request_approval'
  | 'stop';

export type RecoveryEventResultStatus =
  | 'succeeded'
  | 'ongoing'
  | 'failed'
  | 'escalated';

/** RecoveryEvent — 11 fields */
export interface RecoveryEvent {
  id: string;
  goalId: string;
  workItemId: string | null;
  detectedCondition: string;
  detectedAt: string;
  severity: RecoveryEventSeverity | null;
  selectedAction: RecoveryEventAction;
  actionReason: string | null;
  resultStatus: RecoveryEventResultStatus;
  resultSummary: string | null;
  createdAt: string;
}

// ─── API Request / Response Types (from control-plane-api.yaml) ──

export interface CreateGoalRequest {
  title: string;
  intent: string;
  priority?: Priority;
}

export interface UpdateGoalRequest {
  title?: string;
  intent?: string;
  priority?: Priority;
}

export interface GoalSummary {
  id: string;
  title: string;
  status: GoalStatus;
  priority: Priority;
  currentSummary: string;
  updatedAt: string;
}

export interface GoalDetail extends GoalSummary {
  intent: string;
  resultSummary?: string | null;
  riskSummary?: string | null;
  workItems: WorkItem[];
  approvals: Approval[];
  recoveryEvents: RecoveryEvent[];
}
