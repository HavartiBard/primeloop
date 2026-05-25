import type pg from 'pg'
import {
  getAgentRuntimeConfig,
  getCapabilityProfileByName,
  getCapabilityProfile,
  insertToolGrant,
  listCapabilityBundleAdapters,
  type CapabilityProfile,
  type RegistryAgent,
  type ToolGrant,
} from './registry.js'

export interface ToolGrantTaskScope {
  allowed_primitives?: string[]
  denied_primitives?: string[]
  allowed_bundles?: string[]
  denied_bundles?: string[]
  [key: string]: unknown
}

export interface ToolGrantApprovalState {
  approved?: boolean
  [key: string]: unknown
}

export interface ToolGrantEnvironmentContext {
  available_provider_adapters?: Record<string, boolean>
  provider_adapter_health?: Record<string, string>
  [key: string]: unknown
}

export interface SelectedProviderAdapter {
  [key: string]: unknown
  kind: string
  ref: string
  bundle?: string
  priority?: number
  config?: Record<string, unknown>
}

export interface ToolGrantResolutionInput {
  agent: RegistryAgent
  routingCapability?: string
  capabilityProfileId?: string | null
  capabilityProfileName?: string | null
  taskScope?: ToolGrantTaskScope
  approvalState?: ToolGrantApprovalState
  environmentContext?: ToolGrantEnvironmentContext
  fallbackProviderAdapters?: SelectedProviderAdapter[]
  delegationId?: string
  workItemId?: string
}

interface GrantSurface {
  grantedPrimitives: string[]
  grantedCapabilityBundles: string[]
  selectedProviderAdapters: SelectedProviderAdapter[]
  exclusionReasons: Array<Record<string, unknown>>
}

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function matchesScope(rule: Record<string, unknown>, routingCapability: string, role: string | undefined, taskScope: ToolGrantTaskScope): boolean {
  const roles = asArray(rule.roles)
  if (roles.length > 0 && (!role || !roles.includes(role))) return false

  const routingCapabilities = asArray(rule.routing_capabilities)
  if (routingCapabilities.length > 0 && !routingCapabilities.includes(routingCapability)) return false

  const taskKeys = asArray(rule.task_keys)
  if (taskKeys.length > 0 && !taskKeys.some((key) => key in taskScope)) return false

  const needle = typeof rule.task_contains === 'string' ? rule.task_contains.trim() : ''
  if (needle && !JSON.stringify(taskScope).includes(needle)) return false

  return true
}

function ruleTarget(rule: Record<string, unknown>): { kind: 'primitive' | 'bundle'; name: string } | null {
  const kind = rule.kind === 'primitive' ? 'primitive' : rule.kind === 'bundle' ? 'bundle' : null
  if (kind === 'primitive' && typeof rule.name === 'string') return { kind, name: rule.name }
  if (kind === 'bundle' && typeof rule.bundle === 'string') return { kind, name: rule.bundle }
  if (typeof rule.target === 'string') {
    return { kind: rule.type === 'primitive' ? 'primitive' : 'bundle', name: rule.target }
  }
  return null
}

function applyExplicitList(
  current: string[],
  allowed: string[] | undefined,
  denied: string[] | undefined,
  exclusionReasons: Array<Record<string, unknown>>,
  reasonKind: string,
  targetKind: string,
): string[] {
  let next = [...current]
  if (allowed && allowed.length > 0) {
    next = next.filter((item) => allowed.includes(item))
    for (const item of current) {
      if (!allowed.includes(item)) {
        exclusionReasons.push({ kind: reasonKind, target: item, reason: `${targetKind} not included by task scope` })
      }
    }
  }
  if (denied && denied.length > 0) {
    next = next.filter((item) => !denied.includes(item))
    for (const item of denied) {
      if (current.includes(item)) {
        exclusionReasons.push({ kind: reasonKind, target: item, reason: `${targetKind} explicitly denied by task scope` })
      }
    }
  }
  return Array.from(new Set(next))
}

function isApprovalRequired(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.toLowerCase().includes('approval')
  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    if (record.required === true) return true
    if (typeof record.state === 'string') return record.state.toLowerCase().includes('approval')
  }
  return false
}

async function selectProviderAdaptersForBundles(
  pool: pg.Pool,
  profile: CapabilityProfile | null,
  bundles: string[],
  environmentContext: ToolGrantEnvironmentContext,
  routingCapability: string,
  role: string | undefined,
  exclusionReasons: Array<Record<string, unknown>>,
): Promise<SelectedProviderAdapter[]> {
  const selected: SelectedProviderAdapter[] = []

  for (const bundle of bundles) {
    const mappings = await listCapabilityBundleAdapters(pool, bundle)
    let chosen: SelectedProviderAdapter | null = null

    for (const mapping of mappings) {
      const adapterKey = `${mapping.provider_adapter_kind}:${mapping.provider_adapter_ref}`
      const availabilityMap = environmentContext.available_provider_adapters ?? {}
      const healthMap = environmentContext.provider_adapter_health ?? {}
      const isAvailable = availabilityMap[adapterKey] ?? availabilityMap[mapping.provider_adapter_ref] ?? true
      const healthState = healthMap[adapterKey] ?? healthMap[mapping.provider_adapter_ref] ?? 'healthy'

      if (!isAvailable) {
        exclusionReasons.push({
          kind: 'unavailable',
          target: adapterKey,
          bundle,
          reason: `provider adapter unavailable for ${bundle}`,
        })
        continue
      }

      if (healthState !== 'healthy' && healthState !== 'degraded') {
        exclusionReasons.push({
          kind: 'health',
          target: adapterKey,
          bundle,
          reason: `provider adapter health is ${healthState} for ${bundle}`,
        })
        continue
      }

      chosen = {
        kind: mapping.provider_adapter_kind,
        ref: mapping.provider_adapter_ref,
        bundle,
        priority: mapping.priority,
        config: mapping.config ?? {},
      }
      break
    }

    if (chosen) {
      selected.push(chosen)
    } else {
      exclusionReasons.push({
        kind: 'missing-adapter',
        target: bundle,
        reason: `no healthy provider adapter available for ${bundle}`,
        routing_capability: routingCapability,
        role,
        capability_profile_id: profile?.id ?? null,
      })
    }
  }

  return selected
}

function buildFallbackProviderAdapters(fallback: SelectedProviderAdapter[] | undefined): SelectedProviderAdapter[] {
  return (fallback ?? []).map((adapter) => ({
    kind: adapter.kind,
    ref: adapter.ref,
    bundle: adapter.bundle,
    priority: adapter.priority,
    config: adapter.config ?? {},
  }))
}

function mergeDefaults(
  defaults: Record<string, unknown>,
  taskScope: ToolGrantTaskScope,
  approvalState: ToolGrantApprovalState,
  environmentContext: ToolGrantEnvironmentContext,
): { taskScope: ToolGrantTaskScope; approvalState: ToolGrantApprovalState; environmentContext: ToolGrantEnvironmentContext } {
  const defaultTaskScope = asRecord(defaults.task_scope)
  const defaultApprovalState = asRecord(defaults.approval_state)
  const defaultEnvironmentContext = asRecord(defaults.environment_context)

  return {
    taskScope: {
      ...defaultTaskScope,
      ...taskScope,
    },
    approvalState: {
      ...defaultApprovalState,
      ...approvalState,
    },
    environmentContext: {
      ...defaultEnvironmentContext,
      ...environmentContext,
    },
  }
}

export async function resolveToolGrant(
  pool: pg.Pool,
  input: ToolGrantResolutionInput,
): Promise<ToolGrant> {
  const runtimeConfig = await getAgentRuntimeConfig(pool, input.agent.id)
  const profileId = input.capabilityProfileId ?? runtimeConfig?.capability_profile_id ?? null
  const profileName = input.capabilityProfileName ?? null
  const profile = profileId
    ? await getCapabilityProfile(pool, profileId)
    : profileName
      ? await getCapabilityProfileByName(pool, profileName)
      : null

  const defaults = mergeDefaults(
    runtimeConfig?.tool_grant_defaults ?? {},
    input.taskScope ?? {},
    input.approvalState ?? {},
    input.environmentContext ?? {},
  )
  const routingCapability = input.routingCapability ?? input.agent.role ?? input.agent.capabilities[0] ?? input.agent.type
  const exclusionReasons: Array<Record<string, unknown>> = []

  const grantedPrimitives = applyExplicitList(
    asArray(profile?.platform_primitives),
    asArray(defaults.taskScope.allowed_primitives),
    asArray(defaults.taskScope.denied_primitives),
    exclusionReasons,
    'narrowing',
    'primitive',
  )
  const grantedCapabilityBundles = applyExplicitList(
    asArray(profile?.capability_bundles),
    asArray(defaults.taskScope.allowed_bundles),
    asArray(defaults.taskScope.denied_bundles),
    exclusionReasons,
    'narrowing',
    'bundle',
  )

  if (profile) {
    for (const rule of profile.deny_rules ?? []) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue
      const record = rule as Record<string, unknown>
      if (!matchesScope(record, routingCapability, input.agent.role, defaults.taskScope)) continue
      const target = ruleTarget(record)
      if (!target) continue

      if (target.kind === 'primitive') {
        const filtered = grantedPrimitives.filter((value) => value !== target.name)
        if (filtered.length !== grantedPrimitives.length) {
          exclusionReasons.push({
            kind: 'deny',
            target: target.name,
            reason: typeof record.reason === 'string' ? record.reason : 'denied by capability profile',
          })
        }
        grantedPrimitives.splice(0, grantedPrimitives.length, ...filtered)
      } else {
        const filtered = grantedCapabilityBundles.filter((value) => value !== target.name)
        if (filtered.length !== grantedCapabilityBundles.length) {
          exclusionReasons.push({
            kind: 'deny',
            target: target.name,
            reason: typeof record.reason === 'string' ? record.reason : 'denied by capability profile',
          })
        }
        grantedCapabilityBundles.splice(0, grantedCapabilityBundles.length, ...filtered)
      }
    }

    for (const [name, requirement] of Object.entries(profile.approval_rules ?? {})) {
      if (!isApprovalRequired(requirement)) continue
      const approved = defaults.approvalState.approved === true
      if (approved) continue

      if (grantedPrimitives.includes(name)) {
        grantedPrimitives.splice(grantedPrimitives.indexOf(name), 1)
      }
      if (grantedCapabilityBundles.includes(name)) {
        grantedCapabilityBundles.splice(grantedCapabilityBundles.indexOf(name), 1)
      }
      exclusionReasons.push({
        kind: 'approval',
        target: name,
        reason: `approval required for ${name}`,
      })
    }
  } else {
    exclusionReasons.push({
      kind: 'missing-profile',
      target: routingCapability,
      reason: 'no capability profile assigned',
    })
  }

  const selectedProviderAdapters = profile
    ? await selectProviderAdaptersForBundles(
        pool,
        profile,
        grantedCapabilityBundles,
        defaults.environmentContext,
        routingCapability,
        input.agent.role,
        exclusionReasons,
      )
    : buildFallbackProviderAdapters(input.fallbackProviderAdapters)

  if (!profile && selectedProviderAdapters.length === 0) {
    exclusionReasons.push({
      kind: 'fallback',
      target: routingCapability,
      reason: 'using empty grant because no profile or fallback adapters were available',
    })
  }

  return insertToolGrant(pool, {
    agent_id: input.agent.id,
    delegation_id: input.delegationId,
    work_item_id: input.workItemId,
    capability_profile_id: profile?.id,
    routing_capability: routingCapability,
    granted_primitives: grantedPrimitives,
    granted_capability_bundles: grantedCapabilityBundles,
    selected_provider_adapters: selectedProviderAdapters,
    exclusion_reasons: exclusionReasons,
    task_scope: defaults.taskScope,
    approval_state: defaults.approvalState,
    environment_context: defaults.environmentContext,
    revocation_state: 'active',
  })
}
