/**
 * Routing types for spec 015: Prime Routing + Runtime Truth.
 *
 * Defines the contract between Prime intent and executable system behavior.
 */

import type { RegistryAgent } from '../registry.js'
import type { EphemeralTemplate } from '../ephemeral-templates.js'

/**
 * Execution capacity classification for a registered agent.
 * - `dispatchable`: Has a healthy runnable harness, can accept work immediately
 * - `registered`: Exists in ACP but runtime is unavailable or unproven
 * - `spawnable`: An ephemeral template that can be instantiated on demand
 */
export type ExecutionCapacity = 'dispatchable' | 'registered' | 'spawnable'

/**
 * Runtime availability status for a specific agent.
 */
export interface RuntimeAvailability {
  /** Agent identifier */
  agentId: string
  /** Whether the agent row is enabled */
  enabled: boolean
  /** Current execution capacity classification */
  capacity: ExecutionCapacity
  /** Harness is available and healthy (only for dispatchable agents) */
  harnessHealthy?: boolean
  /** Reason if not dispatchable */
  unavailableReason?: string
  /** Last health check timestamp */
  lastCheckedAt?: string
}

/**
 * A dispatchable target — a registered agent with a proven runnable execution path.
 */
export interface DispatchableTarget {
  agent: RegistryAgent
  runtime: RuntimeAvailability
}

/**
 * A spawnable template that can be instantiated to satisfy work.
 */
export interface SpawnableTarget {
  template: EphemeralTemplate
  /** Roles/capabilities this template can fulfill */
  capabilities: string[]
}

/**
 * Prime-generated routing request expressing work intent without selecting a concrete target.
 */
export interface RoutingRequest {
  /** Unique identifier for the routing request */
  id: string
  /** Work class describing the type of work (e.g., 'code_review', 'diagnostics', 'implementation') */
  workClass: string
  /** Optional role preference (e.g., 'sre', 'architect') — advisory only */
  preferredRole?: string
  /** Constraints on execution (e.g., scope, approval requirements) */
  constraints: RoutingConstraints
  /** The work item this routing request is associated with */
  workItemId?: string
  /** The thread this request originated from */
  threadId?: string
  /** Source of the request ('prime-agent', 'investigation', 'escalation') */
  source: string
  /** Created timestamp */
  createdAt: string
}

/**
 * Constraints on how work should be routed.
 */
export interface RoutingConstraints {
  /** Required capabilities for the target */
  requiredCapabilities?: string[]
  /** Whether the work requires user approval before execution */
  requiresApproval?: boolean
  /** Maximum tokens allowed for the task */
  maxTokens?: number
  /** Maximum duration in milliseconds */
  maxDurationMs?: number
  /** Whether ephemeral spawn is acceptable */
  allowEphemeralSpawn?: boolean
  /** Trust zone requirement */
  trustZone?: string
}

/**
 * Routing outcome types — the backend result of evaluating a routing request.
 */
export type RoutingOutcomeType =
  | 'dispatch_existing'
  | 'spawn_ephemeral'
  | 'blocked_missing_capability'
  | 'blocked_runtime_unavailable'
  | 'investigate'
  | 'request_user_decision'

/**
 * A successful dispatch to an existing agent with a runnable harness.
 */
export interface DispatchOutcome {
  type: 'dispatch_existing'
  targetAgent: RegistryAgent
  delegationId?: string
}

/**
 * A spawn outcome — work will be executed by spawning an ephemeral agent from a template.
 */
export interface SpawnOutcome {
  type: 'spawn_ephemeral'
  templateId: string
  templateName: string
  spawnContext: Record<string, unknown>
}

/**
 * Blocked because no dispatchable or spawnable target exists for the requested work class.
 */
export interface BlockedMissingCapabilityOutcome {
  type: 'blocked_missing_capability'
  blockerType: 'missing_capability'
  explanation: string
  requestedWorkClass: string
  suggestedRemediations: RemediationSuggestion[]
}

/**
 * Blocked because the right agent exists but its runtime is unavailable.
 */
export interface BlockedRuntimeUnavailableOutcome {
  type: 'blocked_runtime_unavailable'
  blockerType: 'runtime_unavailable'
  explanation: string
  affectedAgents: Array<{ agentId: string; agentName: string; reason: string }>
  suggestedRemediations: RemediationSuggestion[]
}

/**
 * Investigation outcome — work should be routed to an investigation/escalation path.
 */
export interface InvestigateOutcome {
  type: 'investigate'
  targetAgent?: RegistryAgent
  templateId?: string
  investigationContext: Record<string, unknown>
}

/**
 * Request user decision outcome — operator input is required before proceeding.
 */
export interface RequestUserDecisionOutcome {
  type: 'request_user_decision'
  explanation: string
  options: Array<{ label: string; description: string }>
}

/**
 * Complete routing outcome — one of the specific outcome types plus metadata.
 */
export type RoutingOutcome =
  | DispatchOutcome
  | SpawnOutcome
  | BlockedMissingCapabilityOutcome
  | BlockedRuntimeUnavailableOutcome
  | InvestigateOutcome
  | RequestUserDecisionOutcome

/**
 * A suggested remediation for a blocked routing outcome.
 */
export interface RemediationSuggestion {
  /** Action type: 'extend_agent', 'enable_runtime', 'create_template', 'create_agent' */
  action: string
  /** Human-readable description of the fix */
  description: string
  /** Target agent or template if applicable */
  target?: string
}

/**
 * Routing policy — maps work classes to fulfillment strategies.
 * Evolvable independently of Prime prompt wording.
 */
export interface RoutingPolicy {
  /** Version identifier for the policy */
  version: string
  /** Work class to strategy mappings */
  workClassMap: Record<string, RoutingStrategy>
  /** Default strategy when no specific mapping exists */
  defaultStrategy: RoutingStrategy
  /** Whether ephemeral spawn is globally allowed */
  allowEphemeralSpawn: boolean
}

/**
 * Strategy for fulfilling a specific work class.
 */
export interface RoutingStrategy {
  /** Preferred roles that can handle this work class */
  preferredRoles: string[]
  /** Fallback roles if preferred are unavailable */
  fallbackRoles?: string[]
  /** Whether ephemeral spawn is allowed for this work class */
  allowSpawn: boolean
  /** Preferred template for spawn if no dispatchable agent exists */
  spawnTemplateId?: string
  /** Whether to investigate when blocked instead of failing silently */
  investigateOnBlock: boolean
}

/**
 * Full runtime truth snapshot for Prime context assembly.
 */
export interface RuntimeTruth {
  /** Agents that are currently dispatchable (have healthy harness) */
  dispatchableAgents: DispatchableTarget[]
  /** Agents that are registered but not dispatchable */
  registeredOnlyAgents: Array<{ agent: RegistryAgent; runtime: RuntimeAvailability }>
  /** Templates that can be spawned on demand */
  spawnableTemplates: SpawnableTarget[]
  /** Capability gaps — work classes with no fulfillment path */
  capabilityGaps: string[]
  /** All runtime availability records */
  allRuntimeAvailability: RuntimeAvailability[]
}

/**
 * Deduplication key for blocked routing artifacts.
 * Prevents creating duplicate pending/investigation items for the same unresolved work.
 */
export interface BlockerSignature {
  /** The work class that triggered the block */
  workClass: string
  /** The specific blocker type */
  blockerType: 'missing_capability' | 'runtime_unavailable'
  /** Optional thread context */
  threadId?: string
}
