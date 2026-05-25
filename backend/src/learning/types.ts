// Learning Record types — Agentic Control Plane (spec 016)
// Matches data-model.md LearningRecord section and control-plane-api.yaml schema.

export enum LearningCategory {
  Planning = 'planning',
  Delegation = 'delegation',
  Recovery = 'recovery',
  Approval = 'approval',
  Ux = 'ux',
  DomainSpecific = 'domain_specific',
}

export enum LearningSignalType {
  Success = 'success',
  Failure = 'failure',
  Inefficiency = 'inefficiency',
  OperatorCorrection = 'operator_correction',
  MissedRisk = 'missed_risk',
}

export enum LearningConfidence {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export interface LearningRecord {
  id: string;
  goalId: string;
  workItemId?: string;
  category: LearningCategory;
  signalType: LearningSignalType;
  observation: string;
  recommendation?: string;
  confidence?: LearningConfidence;
  appliesToDomains?: string[];
  createdAt: string;
}

export interface CreateLearningRecordInput {
  goalId: string;
  workItemId?: string;
  category: LearningCategory;
  signalType: LearningSignalType;
  observation: string;
  recommendation?: string;
  confidence?: LearningConfidence;
  appliesToDomains?: string[];
}
