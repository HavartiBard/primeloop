// Learning module — Agentic Control Plane (spec 016)
// Re-exports for learning record management.

// Types (implemented in T009)
export {
  LearningCategory,
  LearningSignalType,
  LearningConfidence,
} from './types.js';
export type {
  LearningRecord,
  CreateLearningRecordInput,
} from './types.js';

// Service (implemented in T030)
export { createLearningRecord, listLearningRecords } from './service.js';
