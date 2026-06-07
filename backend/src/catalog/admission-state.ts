// Admission state machine for catalog templates
//
// Defines legal transitions and handles event logging.

import type { AdmissionState, FailureReason } from './types.js';

// Legal state transitions
const LEGAL_TRANSITIONS: Record<AdmissionState, AdmissionState[]> = {
  discovered: ['validated', 'rejected'],
  validated: ['pending_approval', 'rejected'],
  rejected: ['discovered'], // Can re-sync after fixing
  pending_approval: ['registered', 'rejected'],
  registered: ['active', 'deprecated'],
  active: ['registered', 'deprecated'],
  deprecated: [],
};

/**
 * Check if a state transition is legal.
 */
export function isLegalTransition(fromState: AdmissionState, toState: AdmissionState): boolean {
  const allowed = LEGAL_TRANSITIONS[fromState] || [];
  return allowed.includes(toState);
}

/**
 * Get all possible next states from current state.
 */
export function getNextStates(state: AdmissionState): AdmissionState[] {
  return LEGAL_TRANSITIONS[state] || [];
}

/**
 * Validate that a transition is legal, throw if not.
 */
export function validateTransition(fromState: AdmissionState, toState: AdmissionState): void {
  if (!isLegalTransition(fromState, toState)) {
    throw new Error(`Invalid transition: ${fromState} → ${toState}. Legal: ${LEGAL_TRANSITIONS[fromState]?.join(', ') || 'none'}`);
  }
}

/**
 * Check if a state is terminal (no further transitions).
 */
export function isTerminalState(state: AdmissionState): boolean {
  return getNextStates(state).length === 0;
}

/**
 * Check if a template can be auto-approved (within safe baseline).
 */
export interface AutoApprovalCheck {
  eligible: boolean;
  reasons: string[];
}

export function checkAutoApproval(eligible: boolean, failureReasons: FailureReason[]): AutoApprovalCheck {
  const reasons: string[] = [];
  
  if (!eligible) {
    reasons.push('Template declares auto_eligible: false');
  }
  
  // Additional checks would go here (e.g., baseline validation)
  
  return {
    eligible: eligible && reasons.length === 0,
    reasons,
  };
}
