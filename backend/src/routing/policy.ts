/**
 * Routing policy for spec 015.
 *
 * Maps work classes to fulfillment strategies independently of Prime prompt wording.
 */

import type pg from 'pg'
import type { RoutingPolicy, RoutingStrategy } from './types.js'

const DEFAULT_POLICY_VERSION = '1.0.0'

/**
 * Default routing policy.
 * This is the baseline — can be overridden by database configuration.
 */
const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  version: DEFAULT_POLICY_VERSION,
  workClassMap: {
    code_review: {
      preferredRoles: ['reviewer', 'architect'],
      fallbackRoles: ['general'],
      allowSpawn: true,
      spawnTemplateId: 'reviewer',
      investigateOnBlock: false,
    },
    implementation: {
      preferredRoles: ['implementer', 'developer', 'general'],
      allowSpawn: true,
      spawnTemplateId: 'implementer',
      investigateOnBlock: false,
    },
    diagnostics: {
      preferredRoles: ['sre', 'devops', 'architect'],
      fallbackRoles: ['general'],
      allowSpawn: false,
      investigateOnBlock: true,
    },
    infrastructure: {
      preferredRoles: ['devops', 'sre'],
      fallbackRoles: ['general'],
      allowSpawn: false,
      investigateOnBlock: true,
    },
    incident_response: {
      preferredRoles: ['sre', 'devops'],
      fallbackRoles: ['architect', 'general'],
      allowSpawn: false,
      investigateOnBlock: true,
    },
    architecture_review: {
      preferredRoles: ['architect'],
      fallbackRoles: ['general'],
      allowSpawn: false,
      investigateOnBlock: false,
    },
    deployment: {
      preferredRoles: ['devops', 'sre'],
      fallbackRoles: ['general'],
      allowSpawn: false,
      investigateOnBlock: true,
    },
  },
  defaultStrategy: {
    preferredRoles: ['general'],
    allowSpawn: true,
    spawnTemplateId: 'implementer',
    investigateOnBlock: false,
  },
  allowEphemeralSpawn: true,
}

/**
 * Load routing policy from database or return the default.
 */
export async function loadRoutingPolicy(pool: pg.Pool): Promise<RoutingPolicy> {
  // Check for a custom policy in prime_agent_config first
  const { rows } = await pool.query(
    `SELECT config FROM prime_agent_config WHERE id = 'default'`,
  )

  if (rows.length > 0 && rows[0].config?.routing_policy) {
    try {
      const stored = rows[0].config.routing_policy as Record<string, unknown>
      return validatePolicy(stored) ?? DEFAULT_ROUTING_POLICY
    } catch {
      // Fall through to default
    }
  }

  return DEFAULT_ROUTING_POLICY
}

/**
 * Get the routing strategy for a specific work class.
 */
export function getStrategyForWorkClass(
  policy: RoutingPolicy,
  workClass: string,
): RoutingStrategy {
  return policy.workClassMap[workClass] ?? policy.defaultStrategy
}

/**
 * Resolve the list of candidate roles for a work class (preferred + fallback).
 */
export function resolveCandidateRoles(
  policy: RoutingPolicy,
  workClass: string,
): string[] {
  const strategy = getStrategyForWorkClass(policy, workClass)
  const preferred = strategy.preferredRoles ?? []
  const fallback = strategy.fallbackRoles ?? []
  // Deduplicate while preserving order
  const seen = new Set<string>()
  const roles: string[] = []
  for (const role of [...preferred, ...fallback]) {
    if (!seen.has(role)) {
      seen.add(role)
      roles.push(role)
    }
  }
  return roles
}

/**
 * Check if spawning is allowed for a work class under current policy.
 */
export function isSpawnAllowed(
  policy: RoutingPolicy,
  workClass: string,
  constraintsAllowSpawn: boolean = true,
): boolean {
  if (!policy.allowEphemeralSpawn) return false
  if (!constraintsAllowSpawn) return false

  const strategy = getStrategyForWorkClass(policy, workClass)
  return strategy.allowSpawn
}

/**
 * Get the preferred spawn template for a work class.
 */
export function getSpawnTemplateId(
  policy: RoutingPolicy,
  workClass: string,
): string | undefined {
  const strategy = getStrategyForWorkClass(policy, workClass)
  return strategy.spawnTemplateId
}

/**
 * Check if investigation should be triggered when routing is blocked.
 */
export function shouldInvestigateOnBlock(
  policy: RoutingPolicy,
  workClass: string,
): boolean {
  const strategy = getStrategyForWorkClass(policy, workClass)
  return strategy.investigateOnBlock
}

/**
 * Validate and normalize a policy object.
 */
function validatePolicy(raw: Record<string, unknown>): RoutingPolicy | null {
  if (typeof raw.version !== 'string') return null
  if (typeof raw.allowEphemeralSpawn !== 'boolean') return null

  const workClassMap = raw.workClassMap as Record<string, unknown> ?? {}
  const defaultStrategy = raw.defaultStrategy as RoutingStrategy ?? {
    preferredRoles: ['general'],
    allowSpawn: true,
    investigateOnBlock: false,
  }

  const normalized: RoutingPolicy = {
    version: raw.version as string,
    workClassMap: normalizeWorkClassMap(workClassMap),
    defaultStrategy,
    allowEphemeralSpawn: raw.allowEphemeralSpawn as boolean,
  }

  return normalized
}

function normalizeWorkClassMap(
  raw: Record<string, unknown>,
): Record<string, RoutingStrategy> {
  const map: Record<string, RoutingStrategy> = {}

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue

    const v = value as Record<string, unknown>
    const strategy: RoutingStrategy = {
      preferredRoles: Array.isArray(v.preferredRoles)
        ? (v.preferredRoles as string[]).filter((r): r is string => typeof r === 'string')
        : ['general'],
      fallbackRoles: Array.isArray(v.fallbackRoles)
        ? (v.fallbackRoles as string[]).filter((r): r is string => typeof r === 'string')
        : undefined,
      allowSpawn: v.allowSpawn === true,
      spawnTemplateId: typeof v.spawnTemplateId === 'string' ? v.spawnTemplateId : undefined,
      investigateOnBlock: v.investigateOnBlock === true,
    }

    map[key] = strategy
  }

  return map
}

/**
 * Update routing policy in the database.
 */
export async function updateRoutingPolicy(
  pool: pg.Pool,
  policy: RoutingPolicy,
): Promise<void> {
  await pool.query(
    `UPDATE prime_agent_config
     SET config = jsonb_set(
       COALESCE(config, '{}'::jsonb),
       '{routing_policy}',
       $1
     ),
     updated_at = now()
     WHERE id = 'default'`,
    [JSON.stringify(policy)],
  )
}
