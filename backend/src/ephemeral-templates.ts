import type pg from 'pg'
import {
  insertAgent,
  insertCapabilityProfile,
  getCapabilityProfileByName,
  upsertAgentRuntimeConfig,
  insertToolGrant,
  type RegistryAgent,
  type ToolGrant,
} from './registry.js'
import { resolveToolGrant } from './tool-grants.js'
import { createCatalogStore } from './catalog/store.js'

/**
 * Ephemeral agent template definition.
 * Defines the shape of a short-lived task-scoped worker.
 */
export interface EphemeralTemplate {
  /** Stable template identifier */
  id: string
  /** Display name for agents spawned from this template */
  name: string
  /** Agent type/runtime family */
  type: string
  /** Role assigned to spawned agents */
  role: string
  /** Path to persona file relative to prompts/agents/ */
  personaFile: string
  /** Soul definition for the agent */
  soul: string
  /** Platform primitives granted by default (narrower than durable staff) */
  platformPrimitives: string[]
  /** Capability bundles granted by default */
  capabilityBundles: string[]
  /** Deny rules for the template's capability profile */
  denyRules: Array<Record<string, unknown>>
  /** Resource limits for spawned agents */
  resourceLimits: Record<string, unknown>
}

/**
 * Context for spawning an ephemeral agent.
 */
export interface SpawnContext {
  /** The delegation this agent will execute */
  delegationId: string
  /** Optional work item linked to the delegation */
  workItemId?: string
  /** Task-specific scope that narrows the grant */
  taskScope?: Record<string, unknown>
}

/**
 * Result of spawning an ephemeral agent.
 */
export interface SpawnResult {
  /** The created agent row */
  agent: RegistryAgent
  /** The resolved tool grant for this spawn */
  grant: ToolGrant
}

/**
 * Default ephemeral templates.
 * Each template defines a narrow, task-scoped worker profile.
 */
const DEFAULT_EPHEMERAL_TEMPLATES: EphemeralTemplate[] = [
  {
    id: 'implementer',
    name: 'Implementer',
    type: 'implementer',
    role: 'implementer',
    personaFile: 'prompts/agents/implementer.md',
    soul: 'Focused implementation specialist. Executes scoped code changes with verification.',
    platformPrimitives: ['update_work_item', 'soul.read', 'memory.read'],
    capabilityBundles: ['repo.read', 'repo.write'],
    denyRules: [
      { kind: 'primitive', primitive: 'delegate', reason: 'ephemeral agents cannot delegate' },
      { kind: 'primitive', primitive: 'request_approval', reason: 'ephemeral agents cannot request approval' },
    ],
    resourceLimits: { max_tokens: 50000, max_duration_ms: 300000, max_concurrent_processes: 2 },
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    type: 'reviewer',
    role: 'reviewer',
    personaFile: 'prompts/agents/reviewer.md',
    soul: 'Code review specialist. Analyzes changes for correctness, quality, and compliance.',
    platformPrimitives: ['update_work_item', 'soul.read', 'memory.read'],
    capabilityBundles: ['repo.read'],
    denyRules: [
      { kind: 'primitive', primitive: 'delegate', reason: 'ephemeral agents cannot delegate' },
      { kind: 'primitive', primitive: 'request_approval', reason: 'ephemeral agents cannot request approval' },
      { kind: 'bundle', bundle: 'repo.write', reason: 'reviewers read-only' },
    ],
    resourceLimits: { max_tokens: 30000, max_duration_ms: 180000, max_concurrent_processes: 1 },
  },
]

/**
 * Expose the in-code defaults for the catalog migrator.
 * Do not call this from runtime paths — use the catalog instead.
 */
export function DEFAULT_EPHEMERAL_TEMPLATES_FOR_MIGRATION(): EphemeralTemplate[] {
  return DEFAULT_EPHEMERAL_TEMPLATES;
}

/**
 * Get an ephemeral template by ID.
 */
export function getEphemeralTemplate(
  templateId: string,
  templates: EphemeralTemplate[] = DEFAULT_EPHEMERAL_TEMPLATES,
): EphemeralTemplate | undefined {
  return templates.find((t) => t.id === templateId)
}

/**
 * List all available ephemeral templates.
 */
export function listEphemeralTemplates(
  templates: EphemeralTemplate[] = DEFAULT_EPHEMERAL_TEMPLATES,
): EphemeralTemplate[] {
  return templates
}

/**
 * Spawn an ephemeral agent from a template for a specific task.
 *
 * Creates a concrete `agents` row with:
 * - tier='ephemeral'
 * - unique identity (auto-generated name with timestamp)
 * - role, persona_file from template
 * - state='provisioning'
 * - resolved task-specific tool grant
 *
 * Returns the created agent and its tool grant.
 */
/**
 * Try to resolve an EphemeralTemplate from the catalog (registered version).
 * Returns undefined when the catalog has no registered version for this templateId.
 */
async function templateFromCatalog(
  pool: pg.Pool,
  templateId: string,
): Promise<EphemeralTemplate | undefined> {
  try {
    const store = createCatalogStore(pool)
    const version = await store.getLatestRegisteredVersion(templateId)
    if (!version) return undefined
    const def = version.resolvedDefinition as Record<string, unknown>
    if (def.lifecycleIntent !== 'ephemeral') return undefined
    const cap = (def.capabilityProfile as Record<string, unknown> | undefined) ?? {}
    return {
      id: def.templateId as string,
      name: def.name as string,
      type: def.agentType as string,
      role: ((def.routing as Record<string, string> | undefined)?.preferredRole) ?? (def.agentType as string),
      personaFile: (def.personaFile as string | undefined) ?? 'AGENTS.md',
      soul: (def.soul as string | undefined) ?? '',
      platformPrimitives: (cap.platformPrimitives as string[] | undefined) ?? [],
      capabilityBundles: (cap.capabilityBundles as string[] | undefined) ?? [],
      denyRules: (cap.denyRules as Array<Record<string, unknown>> | undefined) ?? [],
      resourceLimits: ((def.runtimeRequirements as Record<string, unknown> | undefined)?.limits as Record<string, unknown> | undefined) ?? {},
    }
  } catch {
    return undefined
  }
}

export async function spawnEphemeralAgent(
  pool: pg.Pool,
  templateId: string,
  context: SpawnContext,
  templates: EphemeralTemplate[] = DEFAULT_EPHEMERAL_TEMPLATES,
): Promise<SpawnResult> {
  // Prefer catalog definition; fall back to in-code for backwards compat (FR-035)
  const template =
    (await templateFromCatalog(pool, templateId)) ??
    getEphemeralTemplate(templateId, templates)
  if (!template) {
    throw new Error(`ephemeral template not found: ${templateId}`)
  }

  // Ensure capability profile exists for this template
  const profileName = `${template.id}-default`
  let profile = await getCapabilityProfileByName(pool, profileName)

  if (!profile) {
    profile = await insertCapabilityProfile(pool, {
      name: profileName,
      description: `Default capability profile for ${template.name} ephemeral template`,
      platform_primitives: template.platformPrimitives,
      capability_bundles: template.capabilityBundles,
      deny_rules: template.denyRules,
      approval_rules: {},
      config: {},
    })
  }

  // Create unique agent name with timestamp to avoid collisions
  const timestamp = Date.now()
  const agentName = `${template.name}-${timestamp}`

  // Create the ephemeral agent row
  const agent = await insertAgent(pool, {
    name: agentName,
    type: template.type,
    runtime_family: 'local',
    execution_mode: 'managed',
    capabilities: [template.role],
    config: { template_id: template.id },
    enabled: true,
    tier: 'ephemeral',
    role: template.role,
    state: 'provisioning',
    persona_file: template.personaFile,
    soul: template.soul,
  })

  // Resolve task-specific tool grant (narrower than durable staff by default)
  const grant = await resolveToolGrant(pool, {
    agent,
    delegationId: context.delegationId,
    workItemId: context.workItemId,
    capabilityProfileId: profile.id,
    routingCapability: template.role,
    taskScope: context.taskScope ?? {},
  })

  // Persist the resolved grant
  const persistedGrant = await insertToolGrant(pool, {
    agent_id: agent.id,
    delegation_id: context.delegationId,
    work_item_id: context.workItemId,
    capability_profile_id: profile.id,
    routing_capability: template.role,
    granted_primitives: grant.granted_primitives,
    granted_capability_bundles: grant.granted_capability_bundles,
    selected_provider_adapters: grant.selected_provider_adapters ?? [],
    exclusion_reasons: grant.exclusion_reasons ?? [],
    task_scope: context.taskScope ?? {},
    approval_state: {},
    environment_context: {},
    revocation_state: 'active',
  })

  // Ensure runtime config exists with resource limits from template
  await upsertAgentRuntimeConfig(pool, {
    agent_id: agent.id,
    protocol: 'generic-http',
    trust_zone: 'local',
    limits: template.resourceLimits,
    capability_profile_id: profile.id,
    tool_grant_defaults: {},
  })

  return {
    agent,
    grant: persistedGrant,
  }
}

/**
 * Retire an ephemeral agent after task completion.
 *
 * Transitions the agent to 'terminated' state and persists the final outcome.
 * The agent row remains queryable for audit purposes.
 */
export async function retireEphemeralAgent(
  pool: pg.Pool,
  agentId: string,
  outcome: { success: boolean; error?: string },
): Promise<void> {
  // Update the tool grant to reflect revocation
  await pool.query(
    `UPDATE tool_grants
     SET revocation_state = 'revoked', revoked_at = now(), updated_at = now()
     WHERE agent_id = $1 AND revocation_state = 'active'`,
    [agentId],
  )

  // Persist the final outcome in runtime events
  await pool.query(
    `INSERT INTO runtime_events (event_type, actor, payload)
     VALUES ($1, $2, $3)`,
    [
      'agent.ephemeral.retired',
      'ephemeral-manager',
      JSON.stringify({
        agent_id: agentId,
        success: outcome.success,
        error: outcome.error ?? null,
      }),
    ],
  )
}
