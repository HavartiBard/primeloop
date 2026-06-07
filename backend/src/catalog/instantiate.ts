// Instantiation - create a managed agent from a registered template version.
//
// Consolidated, single source of truth for catalog instantiation. Mirrors the
// `spawnEphemeralAgent` flow (registry.ts helpers + resolveToolGrant), so it
// reuses the same column-correct INSERT paths and least-privilege grant logic.
//
// IMPORTANT: this creates DB records only. It MUST NOT boot a runtime process —
// the on-demand RuntimeLease system provisions a process when work arrives.

import type { Pool } from 'pg';

import { insertAgent, upsertAgentRuntimeConfig } from '../registry.js';
import { resolveToolGrant } from '../tool-grants.js';
import { createCatalogStore } from './store.js';

/**
 * Distinct block reasons. Only CREDENTIAL_NOT_PROVISIONED maps to the 412
 * response; NOT_REGISTERED / NO_CAPABILITY_PROFILE are wrong-state errors that
 * the route surfaces as 409.
 */
export type InstantiationBlock =
  | { code: 'CREDENTIAL_NOT_PROVISIONED'; missingCredentials: string[] }
  | { code: 'NOT_REGISTERED'; detail: string }
  | { code: 'NO_CAPABILITY_PROFILE'; detail: string };

export interface InstantiationResult {
  agentId?: string;
  capabilityProfileId?: string;
  blocked?: InstantiationBlock;
}

/**
 * Check the credential broker for the named credentials a template declares.
 *
 * A declared credential is considered "provisioned" when an active brokered
 * credential exists whose injected env-var name matches the declared name.
 * Brokered credentials store that name in `scope->>'envName'`.
 *
 * Returns the subset of declared credentials that are NOT provisioned.
 */
async function findMissingCredentials(
  pool: Pool,
  credentialNeeds: string[],
): Promise<string[]> {
  if (credentialNeeds.length === 0) return [];

  const { rows } = await pool.query<{ env_name: string }>(
    `SELECT DISTINCT scope->>'envName' AS env_name
       FROM brokered_credentials
      WHERE status = 'active'
        AND (expires_at IS NULL OR expires_at > now())
        AND scope->>'envName' = ANY($1::text[])`,
    [credentialNeeds],
  );
  const provisioned = new Set(rows.map((r) => r.env_name).filter(Boolean));
  return credentialNeeds.filter((c) => !provisioned.has(c));
}

/**
 * Instantiate a managed agent from a registered template version.
 *
 * Steps (no process boot):
 *  1. Resolve the version snapshot; require admission_state='registered' and a
 *     linked capability_profile_id (else a distinct wrong-state block).
 *  2. Verify all declared credential needs are provisioned in the broker; else
 *     return CREDENTIAL_NOT_PROVISIONED (412 at the route).
 *  3. Create the `agents` row via insertAgent (execution_mode='managed', tier
 *     from lifecycle intent, prompt/soul/persona/config populated), then link
 *     catalog_template_version_id.
 *  4. Create agent_runtime_configs via upsertAgentRuntimeConfig (limits from
 *     runtimeRequirements, capability_profile_id, tool_grant_defaults).
 *  5. Resolve the effective tool grant via resolveToolGrant (declaration ∩
 *     runtime policy) and persist it via insertToolGrant.
 *  6. Resolve mcpAccess server NAMES → ids and create agent_mcp_assignments.
 *  7. Transition the version registered → active and record an admission event.
 */
export async function instantiateFromVersion(
  pool: Pool,
  versionId: string,
  overrides?: { name?: string },
): Promise<InstantiationResult> {
  const store = createCatalogStore(pool);

  const version = await store.getVersionById(versionId);
  if (!version) {
    throw new Error(`Version ${versionId} not found`);
  }

  // Wrong-state checks are distinct from credential blocks so the route can
  // return 409 rather than 412.
  if (version.admissionState !== 'registered') {
    return {
      blocked: {
        code: 'NOT_REGISTERED',
        detail: `Version must be 'registered' to instantiate, got '${version.admissionState}'`,
      },
    };
  }

  if (!version.capabilityProfileId) {
    return {
      blocked: {
        code: 'NO_CAPABILITY_PROFILE',
        detail: 'capability_profile_id not set on version',
      },
    };
  }

  const def = version.resolvedDefinition as Record<string, unknown>;

  // Credential provisioning gate (real broker check).
  const credentialNeeds = (def.credentialNeeds as string[] | undefined) ?? [];
  const missingCredentials = await findMissingCredentials(pool, credentialNeeds);
  if (missingCredentials.length > 0) {
    return { blocked: { code: 'CREDENTIAL_NOT_PROVISIONED', missingCredentials } };
  }

  const lifecycleIntent = (def.lifecycleIntent as 'durable' | 'ephemeral' | undefined) ?? 'durable';
  const tier: 'durable' | 'ephemeral' = lifecycleIntent === 'ephemeral' ? 'ephemeral' : 'durable';
  const runtimeFamily = (def.runtimeFamily as string | undefined) ?? 'custom';
  const agentType = (def.agentType as string | undefined) ?? (def.templateId as string) ?? 'managed';
  const role = ((def.routing as { preferredRole?: string } | undefined)?.preferredRole) ?? agentType;
  const agentName =
    overrides?.name ?? (def.name as string | undefined) ?? `${agentType}-${Date.now()}`;

  // 3. Create the managed-agent row (column-correct via insertAgent).
  const agent = await insertAgent(pool, {
    name: agentName,
    type: agentType,
    runtime_family: runtimeFamily,
    execution_mode: 'managed',
    capabilities: [role],
    config: { template_id: def.templateId, catalog_version_id: versionId },
    enabled: true,
    tier,
    role,
    state: 'ready',
    persona_file: (def.personaFile as string | undefined) ?? 'AGENTS.md',
    system_prompt: (def.systemPrompt as string | undefined) ?? undefined,
    soul: (def.soul as string | undefined) ?? undefined,
  });

  // Link provenance (catalog_template_version_id is not part of insertAgent).
  await pool.query(`UPDATE agents SET catalog_template_version_id = $1 WHERE id = $2`, [
    versionId,
    agent.id,
  ]);

  // 4. Runtime config: limits from runtimeRequirements, profile + grant defaults.
  const runtimeRequirements = (def.runtimeRequirements as { limits?: Record<string, unknown> } | undefined) ?? {};
  const toolGrantDefaults = (def.toolAccess as string[] | undefined) ?? [];
  await upsertAgentRuntimeConfig(pool, {
    agent_id: agent.id,
    protocol: 'generic-http',
    trust_zone: 'local',
    workspace_root: undefined,
    limits: runtimeRequirements.limits ?? {},
    capability_profile_id: version.capabilityProfileId,
    tool_grant_defaults: { tool_access: toolGrantDefaults },
  });

  // 5. Effective grant = declaration ∩ runtime policy. resolveToolGrant computes
  // the intersection against the capability profile + runtime config defaults
  // AND persists the resulting tool_grants row (same path as spawnEphemeralAgent),
  // so the default instantiation grant never exceeds the template declaration.
  await resolveToolGrant(pool, {
    agent,
    capabilityProfileId: version.capabilityProfileId,
    routingCapability: role,
    taskScope: {},
  });

  // 6. MCP assignments: resolve server NAMES → ids.
  const mcpAccess = (def.mcpAccess as string[] | undefined) ?? [];
  for (const mcpName of mcpAccess) {
    await pool.query(
      `INSERT INTO agent_mcp_assignments (agent_id, mcp_server_id)
       SELECT $1, id FROM mcp_servers WHERE name = $2
       ON CONFLICT (agent_id, mcp_server_id) DO NOTHING`,
      [agent.id, mcpName],
    );
  }

  // 7. Transition registered → active + admission event.
  await store.recordAdmissionEvent({
    versionId,
    fromState: 'registered',
    toState: 'active',
    actor: 'operator',
    reason: `Instantiated managed agent ${agent.id}`,
  });
  await pool.query(
    `UPDATE catalog_template_versions SET admission_state = 'active', updated_at = now() WHERE id = $1`,
    [versionId],
  );

  return { agentId: agent.id, capabilityProfileId: version.capabilityProfileId };
}
