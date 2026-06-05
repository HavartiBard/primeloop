/**
 * Runtime availability checker for spec 015.
 *
 * Determines whether a registered agent has a proven executable runtime path.
 */

import type pg from 'pg'
import type { RegistryAgent } from '../registry.js'
import type { AgentHarness } from '../fleet-executor/harness.js'
import type {
  RuntimeAvailability,
  ExecutionCapacity,
  RuntimeTruth,
  DispatchableTarget,
  SpawnableTarget,
} from './types.js'
import { listEphemeralTemplates, type EphemeralTemplate } from '../ephemeral-templates.js'

export interface RuntimeCheckerDeps {
  pool: pg.Pool
  getHarness?: (agentId: string) => AgentHarness | undefined
}

/**
 * Check runtime availability for a single agent.
 */
export async function checkAgentRuntime(
  deps: RuntimeCheckerDeps,
  agent: RegistryAgent,
): Promise<RuntimeAvailability> {
  const { pool } = deps
  const getHarness = deps.getHarness ?? (() => undefined)

  // Must be enabled to be dispatchable
  if (!agent.enabled) {
    return {
      agentId: agent.id,
      enabled: false,
      capacity: 'registered',
      unavailableReason: 'Agent is disabled',
      lastCheckedAt: new Date().toISOString(),
    }
  }

  // Check for a healthy harness
  const harness = getHarness(agent.id)
  if (harness) {
    return {
      agentId: agent.id,
      enabled: true,
      capacity: 'dispatchable',
      harnessHealthy: true,
      lastCheckedAt: new Date().toISOString(),
    }
  }

  // Check heartbeat — recent activity suggests the runtime is alive even if no harness yet
  const { rows } = await pool.query(
    `SELECT last_seen::text, healthy FROM agent_heartbeat WHERE agent = $1`,
    [agent.name],
  )

  if (rows.length > 0 && rows[0].healthy) {
    const lastSeen = new Date(rows[0].last_seen)
    const ageMs = Date.now() - lastSeen.getTime()
    const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

    if (ageMs < STALE_THRESHOLD_MS) {
      return {
        agentId: agent.id,
        enabled: true,
        capacity: 'dispatchable',
        harnessHealthy: false, // Harness not yet loaded but heartbeat is fresh
        lastCheckedAt: new Date().toISOString(),
      }
    }
  }

  // Lazy-provisioned durable ACP/PI agents are dispatchable even before the harness is
  // running because the dispatcher can start them on first routed work.
  if (
    process.env.LAZY_PROVISIONING === '1'
    && agent.tier === 'durable'
    && (agent.runtime_family === 'acp' || agent.runtime_family === 'pi')
  ) {
    return {
      agentId: agent.id,
      enabled: true,
      capacity: 'dispatchable',
      harnessHealthy: false,
      lastCheckedAt: new Date().toISOString(),
    }
  }

  // Check if this agent has a managed execution mode with a known spawn path
  if (agent.execution_mode === 'managed' && agent.runtime_family === 'local') {
    // Has a supported execution model but no active harness right now
    return {
      agentId: agent.id,
      enabled: true,
      capacity: 'registered',
      unavailableReason: 'Managed runtime exists but no active harness',
      lastCheckedAt: new Date().toISOString(),
    }
  }

  // External agents without a harness are registered-only
  return {
    agentId: agent.id,
    enabled: true,
    capacity: 'registered',
    unavailableReason: `No runnable harness for ${agent.runtime_family} agent`,
    lastCheckedAt: new Date().toISOString(),
  }
}

/**
 * Check runtime availability for all agents.
 */
export async function checkAllAgentRuntimes(
  deps: RuntimeCheckerDeps,
): Promise<RuntimeAvailability[]> {
  const { pool } = deps
  const { rows } = await pool.query<RegistryAgent>(
    `SELECT * FROM agents ORDER BY created_at`,
  )

  return Promise.all(rows.map((agent) => checkAgentRuntime(deps, agent)))
}

/**
 * Build a complete runtime truth snapshot.
 */
export async function buildRuntimeTruth(
  deps: RuntimeCheckerDeps,
  templates: EphemeralTemplate[] = listEphemeralTemplates(),
): Promise<RuntimeTruth> {
  const allAvailability = await checkAllAgentRuntimes(deps)

  const dispatchableAgents: DispatchableTarget[] = []
  const registeredOnlyAgents: Array<{ agent: RegistryAgent; runtime: RuntimeAvailability }> = []

  // Build a map of agentId -> agent for matching
  const { rows: agents } = await deps.pool.query<RegistryAgent>(
    `SELECT * FROM agents ORDER BY created_at`,
  )
  const agentMap = new Map<string, RegistryAgent>()
  for (const agent of agents) {
    agentMap.set(agent.id, agent)
  }

  for (const runtime of allAvailability) {
    const agent = agentMap.get(runtime.agentId)
    if (!agent) continue

    if (runtime.capacity === 'dispatchable') {
      dispatchableAgents.push({ agent, runtime })
    } else {
      registeredOnlyAgents.push({ agent, runtime })
    }
  }

  // Build spawnable targets from templates
  const spawnableTemplates: SpawnableTarget[] = templates.map((template) => ({
    template,
    capabilities: [template.role, ...extractTemplateCapabilities(template)],
  }))

  // Determine capability gaps — work classes with no fulfillment path
  const allCapabilities = new Set<string>()

  for (const { agent } of dispatchableAgents) {
    if (Array.isArray(agent.capabilities)) {
      for (const cap of agent.capabilities) {
        allCapabilities.add(cap)
      }
    }
    // Also consider the role as a capability
    if (agent.role) {
      allCapabilities.add(agent.role)
    }
  }

  for (const spawnTarget of spawnableTemplates) {
    for (const cap of spawnTarget.capabilities) {
      allCapabilities.add(cap)
    }
  }

  // Known work classes that might have gaps
  const knownWorkClasses = new Set([
    'code_review',
    'implementation',
    'diagnostics',
    'infrastructure',
    'security_audit',
    'documentation',
    'testing',
    'deployment',
    'incident_response',
    'architecture_review',
  ])

  const capabilityGaps: string[] = []
  for (const workClass of knownWorkClasses) {
    if (!isWorkClassCovered(workClass, allCapabilities, dispatchableAgents, spawnableTemplates)) {
      capabilityGaps.push(workClass)
    }
  }

  return {
    dispatchableAgents,
    registeredOnlyAgents,
    spawnableTemplates,
    capabilityGaps,
    allRuntimeAvailability: allAvailability,
  }
}

/**
 * Check if a work class can be fulfilled by any dispatchable agent or spawnable template.
 */
function isWorkClassCovered(
  workClass: string,
  allCapabilities: Set<string>,
  _dispatchableAgents: DispatchableTarget[],
  _spawnableTemplates: SpawnableTarget[],
): boolean {
  // Direct capability match
  if (allCapabilities.has(workClass)) return true

  // Role-based matching for common work classes
  const roleMap: Record<string, string[]> = {
    code_review: ['reviewer', 'architect'],
    implementation: ['implementer', 'developer', 'general'],
    diagnostics: ['sre', 'devops', 'general'],
    infrastructure: ['devops', 'sre'],
    security_audit: ['architect', 'sre'],
    documentation: ['general', 'architect'],
    testing: ['implementer', 'developer'],
    deployment: ['devops', 'sre'],
    incident_response: ['sre', 'devops'],
    architecture_review: ['architect'],
  }

  const matchingRoles = roleMap[workClass] ?? []
  return matchingRoles.some((role) => allCapabilities.has(role))
}

function extractTemplateCapabilities(template: EphemeralTemplate): string[] {
  const caps = new Set<string>()
  if (template.role) caps.add(template.role)
  for (const bundle of template.capabilityBundles) {
    caps.add(bundle)
  }
  return [...caps]
}
