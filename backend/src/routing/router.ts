/**
 * Prime routing layer for spec 015.
 *
 * Resolves work requests through executable runtime-aware dispatch instead of
 * free-form delegation against enabled registry rows.
 */

import type pg from 'pg'
import type { RegistryAgent } from '../registry.js'
import type { AgentHarness } from '../fleet-executor/harness.js'
import type {
  RoutingRequest,
  RoutingOutcome,
  RoutingConstraints,
  RemediationSuggestion,
  BlockerSignature,
  RuntimeTruth,
  RoutingPolicy,
} from './types.js'
import type { RuntimeCheckerDeps } from './runtime-checker.js'
import { buildRuntimeTruth, checkAgentRuntime } from './runtime-checker.js'
import {
  loadRoutingPolicy,
  getStrategyForWorkClass,
  resolveCandidateRoles,
  isSpawnAllowed,
  getSpawnTemplateId,
  shouldInvestigateOnBlock,
} from './policy.js'
import { listEphemeralTemplates, getEphemeralTemplate } from '../ephemeral-templates.js'

export interface RouterDeps extends RuntimeCheckerDeps {
  /** Optional override for policy loading */
  loadPolicy?: (pool: pg.Pool) => Promise<RoutingPolicy>
}

/**
 * Route a work request to an executable target.
 *
 * This is the core routing function that validates executable runtime availability
 * before creating any delegation. It returns a structured outcome that tells Prime
 * exactly what happened and what to do next.
 */
export async function routeWorkRequest(
  deps: RouterDeps,
  request: RoutingRequest,
): Promise<RoutingOutcome> {
  const { pool } = deps
  const policy = await (deps.loadPolicy ?? loadRoutingPolicy)(pool)
  const runtimeTruth = await buildRuntimeTruth(deps)

  // Phase 1: Try to find a dispatchable agent
  const dispatchResult = tryDispatchExisting(
    request,
    runtimeTruth,
    policy,
  )
  if (dispatchResult) return dispatchResult

  // Phase 2: Try to spawn an ephemeral template
  const spawnResult = trySpawnEphemeral(
    request,
    runtimeTruth,
    policy,
  )
  if (spawnResult) return spawnResult

  // Phase 3: Determine the specific blocker type
  const blocker = determineBlocker(request, runtimeTruth, policy)
  return blocker
}

/**
 * Route an investigation/escalation through the same routing layer.
 *
 * This ensures investigations don't stall on non-runnable durable staff (FR-009).
 */
export async function routeInvestigation(
  deps: RouterDeps,
  input: {
    workClass?: string
    preferredRole?: string
    constraints?: RoutingConstraints
    sourceContext?: Record<string, unknown>
  },
): Promise<RoutingOutcome> {
  const { pool } = deps
  const policy = await (deps.loadPolicy ?? loadRoutingPolicy)(pool)
  const runtimeTruth = await buildRuntimeTruth(deps)

  const workClass = input.workClass ?? 'diagnostics'
  const strategy = getStrategyForWorkClass(policy, workClass)
  const candidateRoles = resolveCandidateRoles(policy, workClass)

  // Try dispatchable agents first, preferring SRE for investigations
  const investigationRole = input.preferredRole ?? 'sre'
  const candidateAgents = runtimeTruth.dispatchableAgents.filter(({ agent }) => {
    if (agent.role === investigationRole) return true
    if (candidateRoles.includes(agent.role ?? "")) return true
    if (Array.isArray(agent.capabilities)) {
      return agent.capabilities.some((cap) =>
        candidateRoles.includes(cap) || cap === workClass,
      )
    }
    return false
  })

  if (candidateAgents.length > 0) {
    // Pick the best match — prefer exact role match
    const exactMatch = candidateAgents.find(
      ({ agent }) => agent.role === investigationRole,
    )
    const target = exactMatch ?? candidateAgents[0]

    return {
      type: 'investigate',
      targetAgent: target.agent,
      investigationContext: {
        workClass,
        sourceContext: input.sourceContext ?? {},
        preferredRole: investigationRole,
      },
    }
  }

  // Try spawn if policy allows it for this work class
  if (isSpawnAllowed(policy, workClass, input.constraints?.allowEphemeralSpawn ?? false)) {
    const templateId = getSpawnTemplateId(policy, workClass)
    if (templateId) {
      return {
        type: 'investigate',
        templateId,
        investigationContext: {
          workClass,
          sourceContext: input.sourceContext ?? {},
          preferredRole: investigationRole,
        },
      }
    }
  }

  // Blocked — no investigation route exists
  const affectedAgents = runtimeTruth.registeredOnlyAgents
    .filter(({ agent }) => candidateRoles.includes(agent.role ?? ""))
    .map(({ agent, runtime }) => ({
      agentId: agent.id,
      agentName: agent.name,
      reason: runtime.unavailableReason ?? 'Runtime unavailable',
    }))

  return {
    type: 'blocked_runtime_unavailable',
    blockerType: 'runtime_unavailable',
    explanation: `No executable investigation route for '${workClass}'. ${candidateRoles.length > 0 ? `Required roles (${candidateRoles.join(', ')}) have no dispatchable runtime.` : 'No matching role found.'}`,
    affectedAgents,
    suggestedRemediations: buildInvestigationRemediations(workClass, candidateRoles),
  }
}

/**
 * Check if a routing request has already produced a blocked outcome for the same work.
 * Used for deduplication (FR-011).
 */
export async function findExistingBlocker(
  pool: pg.Pool,
  signature: BlockerSignature,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM routing_outcomes
     WHERE outcome_type IN ('blocked_missing_capability', 'blocked_runtime_unavailable')
       AND status = 'active'
       AND COALESCE(thread_id::text, '') = COALESCE($1, '')
       AND work_class = $2
       AND blocker_type = $3
     LIMIT 1`,
    [signature.threadId ?? '', signature.workClass, signature.blockerType],
  )
  return (rows[0]?.count ?? 0) > 0
}

/**
 * Record a routing outcome in the database for audit and deduplication.
 */
export async function recordRoutingOutcome(
  pool: pg.Pool,
  request: RoutingRequest,
  outcome: RoutingOutcome,
): Promise<void> {
  const outcomeType = outcome.type
  const blockerType =
    'blockerType' in outcome ? (outcome as { blockerType: string }).blockerType : null
  const targetAgentId =
    'targetAgent' in outcome && outcome.targetAgent
      ? outcome.targetAgent.id
      : null

  await pool.query(
    `INSERT INTO routing_outcomes (
       request_id, work_class, preferred_role, outcome_type, blocker_type,
       target_agent_id, template_id, explanation, suggested_remediations,
       thread_id, work_item_id, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      request.id,
      request.workClass,
      request.preferredRole ?? null,
      outcomeType,
      blockerType,
      targetAgentId,
      'templateId' in outcome ? (outcome as { templateId?: string }).templateId ?? null : null,
      'explanation' in outcome ? (outcome as { explanation?: string }).explanation ?? '' : '',
      JSON.stringify(
        'suggestedRemediations' in outcome
          ? (outcome as { suggestedRemediations?: RemediationSuggestion[] }).suggestedRemediations ?? []
          : [],
      ),
      request.threadId ?? null,
      request.workItemId ?? null,
      outcomeType.startsWith('blocked_') ? 'active' : 'resolved',
    ],
  )
}

/**
 * Try to dispatch to an existing agent with a runnable harness.
 */
function tryDispatchExisting(
  request: RoutingRequest,
  runtimeTruth: RuntimeTruth,
  policy: RoutingPolicy,
): RoutingOutcome | null {
  const strategy = getStrategyForWorkClass(policy, request.workClass)
  const candidateRoles = resolveCandidateRoles(policy, request.workClass)

  // If a specific role was requested, prioritize it
  if (request.preferredRole) {
    const exactMatch = runtimeTruth.dispatchableAgents.find(
      ({ agent }) => agent.role === request.preferredRole,
    )
    if (exactMatch) {
      return { type: 'dispatch_existing', targetAgent: exactMatch.agent }
    }
  }

  // Try preferred roles first, then fallback
  for (const role of candidateRoles) {
    const match = runtimeTruth.dispatchableAgents.find(
      ({ agent }) => agent.role === role,
    )
    if (match) {
      return { type: 'dispatch_existing', targetAgent: match.agent }
    }
  }

  // Try capability-based matching for the work class
  const workClassCap = request.workClass
  for (const { agent } of runtimeTruth.dispatchableAgents) {
    if (Array.isArray(agent.capabilities)) {
      if (agent.capabilities.includes(workClassCap)) {
        return { type: 'dispatch_existing', targetAgent: agent }
      }
      // Check if any candidate role is in capabilities
      if (candidateRoles.some((role) => agent.capabilities.includes(role))) {
        return { type: 'dispatch_existing', targetAgent: agent }
      }
    }
  }

  // Try general agents as last resort if the strategy allows fallback to general
  if (strategy.preferredRoles.includes('general') || strategy.fallbackRoles?.includes('general')) {
    const generalAgent = runtimeTruth.dispatchableAgents.find(
      ({ agent }) => agent.role === 'general' || agent.capabilities?.includes('general'),
    )
    if (generalAgent) {
      return { type: 'dispatch_existing', targetAgent: generalAgent.agent }
    }
  }

  return null
}

/**
 * Try to spawn an ephemeral template for the work.
 */
function trySpawnEphemeral(
  request: RoutingRequest,
  runtimeTruth: RuntimeTruth,
  policy: RoutingPolicy,
): RoutingOutcome | null {
  // Check if spawning is allowed by both policy and constraints
  if (
    !isSpawnAllowed(
      policy,
      request.workClass,
      request.constraints.allowEphemeralSpawn ?? true,
    )
  ) {
    return null
  }

  const strategy = getStrategyForWorkClass(policy, request.workClass)
  const templateId = strategy.spawnTemplateId

  if (templateId) {
    const template = getEphemeralTemplate(templateId)
    if (template) {
      return {
        type: 'spawn_ephemeral',
        templateId: template.id,
        templateName: template.name,
        spawnContext: {
          workClass: request.workClass,
          constraints: request.constraints,
        },
      }
    }
  }

  // Try to find any spawnable template that matches the work class
  const candidateRoles = resolveCandidateRoles(policy, request.workClass)
  for (const spawnTarget of runtimeTruth.spawnableTemplates) {
    if (spawnTarget.capabilities.some((cap) => candidateRoles.includes(cap))) {
      return {
        type: 'spawn_ephemeral',
        templateId: spawnTarget.template.id,
        templateName: spawnTarget.template.name,
        spawnContext: {
          workClass: request.workClass,
          constraints: request.constraints,
        },
      }
    }
  }

  return null
}

/**
 * Determine the specific blocker type when no route exists.
 */
function determineBlocker(
  request: RoutingRequest,
  runtimeTruth: RuntimeTruth,
  policy: RoutingPolicy,
): RoutingOutcome {
  const candidateRoles = resolveCandidateRoles(policy, request.workClass)

  // Check if any registered agent has the right role but is not dispatchable
  const registeredMatches = runtimeTruth.registeredOnlyAgents.filter(
    ({ agent }) =>
      agent.role === request.preferredRole ||
      candidateRoles.includes(agent.role ?? "") ||
      (Array.isArray(agent.capabilities) &&
        (agent.capabilities.includes(request.workClass) ||
          candidateRoles.some((role) => agent.capabilities.includes(role)))),
  )

  if (registeredMatches.length > 0) {
    // Agent exists but runtime is unavailable
    return {
      type: 'blocked_runtime_unavailable',
      blockerType: 'runtime_unavailable',
      explanation: `Agent(s) with matching role exist but have no executable runtime.`,
      affectedAgents: registeredMatches.map(({ agent, runtime }) => ({
        agentId: agent.id,
        agentName: agent.name,
        reason: runtime.unavailableReason ?? 'Runtime unavailable',
      })),
      suggestedRemediations: buildRuntimeRemediations(registeredMatches),
    }
  }

  // No matching agent or template at all
  return {
    type: 'blocked_missing_capability',
    blockerType: 'missing_capability',
    explanation: `No dispatchable or spawnable target for work class '${request.workClass}'.`,
    requestedWorkClass: request.workClass,
    suggestedRemediations: buildCapabilityRemediations(
      request.workClass,
      candidateRoles,
      runtimeTruth.dispatchableAgents.map(({ agent }) => agent),
    ),
  }
}

/**
 * Build remediation suggestions for a missing capability gap.
 */
function buildCapabilityRemediations(
  workClass: string,
  candidateRoles: string[],
  existingAgents: RegistryAgent[],
): RemediationSuggestion[] {
  const remediations: RemediationSuggestion[] = []

  // Suggest extending an existing agent
  const generalAgents = existingAgents.filter(
    (a) => a.role === 'general' || a.enabled,
  ).slice(0, 3)

  if (generalAgents.length > 0) {
    remediations.push({
      action: 'extend_agent',
      description: `Add capability '${workClass}' to one of the existing agents: ${generalAgents.map((a) => a.name).join(', ')}`,
      target: generalAgents[0]?.name,
    })
  }

  // Suggest creating a new agent for the primary role
  const primaryRole = candidateRoles[0] ?? 'general'
  remediations.push({
    action: 'create_agent',
    description: `Create a new enabled agent with role '${primaryRole}' and capability '${workClass}'`,
    target: primaryRole,
  })

  return remediations
}

/**
 * Build remediation suggestions for a runtime-unavailable blocker.
 */
function buildRuntimeRemediations(
  matches: Array<{ agent: RegistryAgent; runtime: { unavailableReason?: string } }>,
): RemediationSuggestion[] {
  const remediations: RemediationSuggestion[] = []

  for (const { agent, runtime } of matches) {
    remediations.push({
      action: 'enable_runtime',
      description: `Repair or enable runtime for '${agent.name}' (${runtime.unavailableReason ?? 'unknown reason'})`,
      target: agent.name,
    })
  }

  // Suggest creating a template as alternative
  if (matches.length > 0) {
    const role = matches[0].agent.role
    remediations.push({
      action: 'create_template',
      description: `Create an ephemeral template for role '${role}' to handle work when durable runtime is unavailable`,
      target: role,
    })
  }

  return remediations
}

/**
 * Build remediation suggestions specifically for investigation routing failures.
 */

/**
 * Build remediation suggestions specifically for investigation routing failures.
 */
function buildInvestigationRemediations(
  workClass: string,
  candidateRoles: string[],
): RemediationSuggestion[] {
  const rolesList = candidateRoles.map((r) => `'${r}'`).join(', ')
  return [
    {
      action: 'enable_runtime',
      description: `Enable or repair runtime for an agent with role ${rolesList} to handle investigations`,
    },
    {
      action: 'create_template',
      description: `Create an ephemeral template that can be spawned for '${workClass}' investigations`,
    },
    {
      action: 'request_user_decision',
      description: 'Escalate to human operator for manual investigation',
    },
  ]
}
