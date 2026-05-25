/**
 * Routing layer public API for spec 015: Prime Routing + Runtime Truth.
 */

export {
  routeWorkRequest,
  routeInvestigation,
  findExistingBlocker,
  recordRoutingOutcome,
} from './router.js'

export {
  checkAgentRuntime,
  checkAllAgentRuntimes,
  buildRuntimeTruth,
} from './runtime-checker.js'

export {
  loadRoutingPolicy,
  getStrategyForWorkClass,
  resolveCandidateRoles,
  isSpawnAllowed,
  getSpawnTemplateId,
  shouldInvestigateOnBlock,
  updateRoutingPolicy,
} from './policy.js'

export {
  isRoleAllowedForDomain,
  validateDomainRoleAssignment,
  assertDomainRoleAssignment,
} from './domain-validation.js'

// Types
export type {
  ExecutionCapacity,
  RuntimeAvailability,
  DispatchableTarget,
  SpawnableTarget,
  RoutingRequest,
  RoutingConstraints,
  RoutingOutcomeType,
  DispatchOutcome,
  SpawnOutcome,
  BlockedMissingCapabilityOutcome,
  BlockedRuntimeUnavailableOutcome,
  InvestigateOutcome,
  RequestUserDecisionOutcome,
  RoutingOutcome,
  RemediationSuggestion,
  RoutingPolicy,
  RoutingStrategy,
  RuntimeTruth,
  BlockerSignature,
} from './types.js'

export type { RuntimeCheckerDeps } from './runtime-checker.js'
export type { RouterDeps } from './router.js'
