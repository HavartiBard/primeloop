import type pg from 'pg'
import {
  getAgentByRole,
  insertAgent,
  insertCapabilityProfile,
  getCapabilityProfileByName,
  upsertAgentRuntimeConfig,
  updateAgent,
  type RegistryAgent,
  type CapabilityProfile,
} from './registry.js'
import { createCatalogStore } from './catalog/store.js'

/**
 * Durable staff role definition.
 * Each role has a stable identity, capability profile, and persona file.
 */
export interface DurableStaffDefinition {
  /** Stable role identifier used for lookup and reconciliation */
  role: string
  /** Display name for the agent */
  name: string
  /** Agent type/runtime family */
  type: string
  /** Path to persona file relative to prompts/agents/ */
  personaFile: string
  /** System prompt override (optional — falls back to workspace template) */
  systemPrompt?: string
  /** Soul definition for the agent */
  soul: string
  /** Platform primitives granted by default */
  platformPrimitives: string[]
  /** Capability bundles granted by default */
  capabilityBundles: string[]
  /** Deny rules for the role's capability profile */
  denyRules: Array<Record<string, unknown>>
  /** Approval rules keyed by primitive/bundle name */
  approvalRules: Record<string, unknown>
}

/**
 * Result of bootstrapping durable staff.
 */
export interface DurableStaffBootstrapResult {
  created: RegistryAgent[]
  updated: RegistryAgent[]
  unchanged: string[]
}

/**
 * Default durable staff definitions per spec 002 decision #6.
 * Architect, SRE, and DevOps are always-on durable staff.
 */
const DEFAULT_DURABLE_STAFF: DurableStaffDefinition[] = [
  {
    role: 'architect',
    name: 'Architect',
    type: 'architect',
    personaFile: 'prompts/agents/architect.md',
    soul: 'Design-first thinker. Produces clear ADRs, cross-cutting consistency checks, and architectural guidance.',
    platformPrimitives: ['delegate', 'update_work_item', 'request_approval', 'soul.read', 'memory.read', 'memory.write', 'lesson.read', 'lesson.write', 'context.assemble'],
    capabilityBundles: ['repo.read', 'repo.write'],
    denyRules: [],
    approvalRules: {},
  },
  {
    role: 'sre',
    name: 'SRE',
    type: 'sre',
    personaFile: 'prompts/agents/sre.md',
    soul: 'Reliability engineer. Monitors system health, responds to incidents, maintains observability and runbooks.',
    platformPrimitives: ['delegate', 'update_work_item', 'request_approval', 'soul.read', 'memory.read', 'memory.write', 'lesson.read', 'lesson.write', 'context.assemble', 'loop.inspect'],
    capabilityBundles: ['repo.read', 'ci.inspect'],
    denyRules: [
      { kind: 'bundle', bundle: 'deploy.production', reason: 'SRE reviews deploys; DevOps executes' },
    ],
    approvalRules: {},
  },
  {
    role: 'devops',
    name: 'DevOps',
    type: 'devops',
    personaFile: 'prompts/agents/devops.md',
    soul: 'Infrastructure and deployment engineer. Manages CI/CD pipelines, environments, and production releases.',
    platformPrimitives: ['delegate', 'update_work_item', 'request_approval', 'soul.read', 'memory.read', 'memory.write', 'lesson.read', 'lesson.write', 'context.assemble'],
    capabilityBundles: ['repo.read', 'repo.write', 'ci.inspect', 'deploy.production'],
    denyRules: [],
    approvalRules: {},
  },
]

/**
 * Idempotently bootstrap durable staff agents.
 *
 * For each role in DEFAULT_DURABLE_STAFF:
 * - If no agent exists with that role, insert a new durable agent row.
 * - If an agent already exists, reconcile persona_file and capability profile without identity churn.
 * - Ensure the role's capability profile exists (upsert).
 * - Ensure the agent has a runtime config entry.
 *
 * Returns a summary of created, updated, and unchanged agents.
 */

/**
 * Expose the in-code defaults for the catalog migrator.
 * Do not call this from runtime paths — use the catalog instead.
 */
export function DEFAULT_DURABLE_STAFF_FOR_MIGRATION(): DurableStaffDefinition[] {
  return DEFAULT_DURABLE_STAFF;
}

/**
 * Resolve durable staff definitions from the catalog (registered versions).
 * Returns only durable templates found in the catalog; caller falls back to
 * in-code definitions for any roles not yet seeded.
 */
async function definitionsFromCatalog(pool: pg.Pool): Promise<DurableStaffDefinition[]> {
  try {
    const store = createCatalogStore(pool)
    const { rows } = await pool.query<{ template_id: string }>(
      `SELECT template_id FROM catalog_templates WHERE lifecycle_state = 'available' AND current_version_id IS NOT NULL`
    )
    const defs: DurableStaffDefinition[] = []
    for (const row of rows) {
      const version = await store.getLatestRegisteredVersion(row.template_id)
      if (!version) continue
      const def = version.resolvedDefinition as Record<string, unknown>
      if (def.lifecycleIntent !== 'durable') continue
      const cap = (def.capabilityProfile as Record<string, unknown> | undefined) ?? {}
      defs.push({
        role: (def.templateId as string),
        name: def.name as string,
        type: def.agentType as string,
        personaFile: (def.personaFile as string | undefined) ?? 'AGENTS.md',
        soul: (def.soul as string | undefined) ?? '',
        platformPrimitives: (cap.platformPrimitives as string[] | undefined) ?? [],
        capabilityBundles: (cap.capabilityBundles as string[] | undefined) ?? [],
        denyRules: (cap.denyRules as Array<Record<string, unknown>> | undefined) ?? [],
        approvalRules: {},
      })
    }
    return defs
  } catch {
    return []
  }
}

export async function bootstrapDurableStaff(
  pool: pg.Pool,
  definitions?: DurableStaffDefinition[],
): Promise<DurableStaffBootstrapResult> {
  // Prefer catalog definitions; merge with in-code for any roles not seeded yet (FR-035)
  let resolvedDefinitions = definitions
  if (!resolvedDefinitions) {
    const catalogDefs = await definitionsFromCatalog(pool)
    if (catalogDefs.length > 0) {
      const catalogRoles = new Set(catalogDefs.map((d) => d.role))
      const inCodeFallbacks = DEFAULT_DURABLE_STAFF.filter((d) => !catalogRoles.has(d.role))
      resolvedDefinitions = [...catalogDefs, ...inCodeFallbacks]
    } else {
      resolvedDefinitions = DEFAULT_DURABLE_STAFF
    }
  }
  const result: DurableStaffBootstrapResult = {
    created: [],
    updated: [],
    unchanged: [],
  }

  for (const def of resolvedDefinitions) {
    // Ensure capability profile exists for this role
    const profileName = `${def.role}-default`
    let profile = await getCapabilityProfileByName(pool, profileName)

    if (!profile) {
      profile = await insertCapabilityProfile(pool, {
        name: profileName,
        description: `Default capability profile for ${def.name} durable staff`,
        platform_primitives: def.platformPrimitives,
        capability_bundles: def.capabilityBundles,
        deny_rules: def.denyRules,
        approval_rules: def.approvalRules,
        config: {},
      })
    }

    // Look up existing agent by role for idempotent reconciliation
    const existing = await getAgentByRole(pool, def.role)

    if (!existing) {
      // Create new durable agent
      const agent = await insertAgent(pool, {
        name: def.name,
        type: def.type,
        runtime_family: 'local',
        execution_mode: 'managed',
        capabilities: [def.role],
        config: {},
        enabled: true,
        tier: 'durable',
        role: def.role,
        state: 'provisioning',
        persona_file: def.personaFile,
        system_prompt: def.systemPrompt,
        soul: def.soul,
      })

      // Ensure runtime config exists
      await upsertAgentRuntimeConfig(pool, {
        agent_id: agent.id,
        protocol: 'generic-http',
        trust_zone: 'local',
        limits: {},
        capability_profile_id: profile.id,
        tool_grant_defaults: {},
      })

      result.created.push(agent)
    } else {
      // Reconcile existing agent without identity churn
      let needsUpdate = false
      const updates: Partial<Record<string, unknown>> = {}

      if (existing.persona_file !== def.personaFile) {
        updates.persona_file = def.personaFile
        needsUpdate = true
      }

      if (existing.soul !== def.soul) {
        updates.soul = def.soul
        needsUpdate = true
      }

      // Update capability profile with current definition (idempotent upsert)
      await pool.query(
        `UPDATE capability_profiles SET
          platform_primitives = $1,
          capability_bundles = $2,
          deny_rules = $3,
          approval_rules = $4,
          updated_at = now()
        WHERE id = $5`,
        [
          JSON.stringify(def.platformPrimitives),
          JSON.stringify(def.capabilityBundles),
          JSON.stringify(def.denyRules),
          JSON.stringify(def.approvalRules),
          profile.id,
        ],
      )

      if (needsUpdate) {
        const updatedAgent = await updateAgent(pool, existing.id, updates)
        result.updated.push(updatedAgent)
      } else {
        result.unchanged.push(def.role)
      }

      // Ensure runtime config exists with current profile
      await upsertAgentRuntimeConfig(pool, {
        agent_id: existing.id,
        protocol: 'generic-http',
        trust_zone: 'local',
        limits: {},
        capability_profile_id: profile.id,
        tool_grant_defaults: {},
      })
    }
  }

  return result
}
