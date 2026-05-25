// Recovery module — Agentic Control Plane (spec 016)
// Re-exports for recovery event management.

// Types (implemented in T008)
export type {
  RecoveryEvent,
  CreateRecoveryEventInput,
  RecoverySeverity,
  RecoveryAction,
  RecoveryResultStatus,
} from './types.js';

// Service (implemented in T028)
export { createRecoveryEvent, listRecoveryEvents, selectRecoveryAction } from './service.js';
