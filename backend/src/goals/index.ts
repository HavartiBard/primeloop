// Goals module — Agentic Control Plane (spec 016)
// Re-exports for goal management, work items, and agent roles.

// Types (implemented in T007)
export * from './types.js';

// Services (implemented in T011, T012)
export {
  createGoal,
  getGoal,
  listGoals,
  updateGoal,
  cancelGoal,
  transitionGoalStatus,
} from './service.js';
export type { CreateGoalInput, UpdateGoalInput } from './service.js';

export * from './work-item-service.js';
