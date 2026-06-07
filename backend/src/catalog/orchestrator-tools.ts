// Catalog control-plane tools for the orchestrator (Prime).
//
// Exposed via mcp/service.ts so Prime can curate and instantiate agents from
// registered templates without direct DB access. All writes are funnelled
// through the admission/instantiation layer; every action records an admission
// event with actor='prime'. Grant intersection is enforced by instantiateFromVersion.
//
// Contract: contracts/orchestrator-skill.md

import type pg from 'pg';

import { createCatalogStore } from './store.js';
import { isWithinBaseline } from './baseline.js';
import { instantiateFromVersion } from './instantiate.js';
import type { CatalogTemplateVersionSnapshot, CatalogTemplate } from './types.js';

// ─── catalog.list_registered ─────────────────────────────────────────────────

export interface ListRegisteredArgs {
  capability?: string;
  lifecycleIntent?: 'durable' | 'ephemeral';
}

export interface RegisteredTemplateSummary {
  templateId: string;
  name: string;
  version: string;
  lifecycleIntent: string;
  routingCapabilities: string[];
  summary: string;
}

/**
 * List registered (non-deprecated) templates Prime may instantiate.
 * FR-029: Prime selects an appropriate template for an intent.
 */
export async function catalogListRegistered(
  pool: pg.Pool,
  args: ListRegisteredArgs,
): Promise<{ templates: RegisteredTemplateSummary[] }> {
  const store = createCatalogStore(pool);

  const { rows } = await pool.query<{
    template_id: string; name: string; lifecycle_state: string; current_version_id: string | null;
  }>(
    `SELECT template_id, name, lifecycle_state, current_version_id
       FROM catalog_templates
      WHERE lifecycle_state = 'available' AND current_version_id IS NOT NULL
      ORDER BY name ASC`,
  );

  const templates: RegisteredTemplateSummary[] = [];

  for (const row of rows) {
    if (!row.current_version_id) continue;

    const version = await store.getVersionById(row.current_version_id);
    if (!version || version.admissionState !== 'registered') continue;

    const def = version.resolvedDefinition as any;
    const lifecycleIntent = (def.lifecycleIntent as string) ?? 'durable';

    // Filter by lifecycleIntent if provided
    if (args.lifecycleIntent && lifecycleIntent !== args.lifecycleIntent) continue;

    const routingCapabilities: string[] = def.routing?.preferredRole
      ? [def.routing.preferredRole]
      : def.capabilityProfile?.capabilityBundles ?? [];

    // Filter by capability if provided
    if (args.capability && !routingCapabilities.includes(args.capability)) continue;

    templates.push({
      templateId: row.template_id,
      name: row.name,
      version: version.version,
      lifecycleIntent,
      routingCapabilities,
      summary: (def.soul as string) ?? (def.description as string) ?? '',
    });
  }

  return { templates };
}

// ─── catalog.propose_instantiation ───────────────────────────────────────────

export interface ProposeInstantiationArgs {
  intent: string;
  templateId?: string;
}

export interface InstantiationProposal {
  templateId: string;
  version: string;
  rationale: string;
  requiresHumanApproval: boolean;
  estimatedGrants: {
    primitives: string[];
    bundles: string[];
    mcp: string[];
    credentials: string[];
  };
}

/**
 * Produce a human-readable instantiation proposal (no side effects).
 * FR-029: Prime proposes with a rationale.
 * FR-030: requiresHumanApproval is true whenever grants exceed the safe baseline.
 */
export async function catalogProposeInstantiation(
  pool: pg.Pool,
  args: ProposeInstantiationArgs,
): Promise<InstantiationProposal> {
  const store = createCatalogStore(pool);

  let templateId = args.templateId;

  if (!templateId) {
    // Simple intent-matching: find the first registered template whose
    // routing capabilities or soul/description mentions a keyword from intent.
    const intentLower = args.intent.toLowerCase();
    const { rows } = await pool.query<{ template_id: string; current_version_id: string }>(
      `SELECT template_id, current_version_id FROM catalog_templates
        WHERE lifecycle_state = 'available' AND current_version_id IS NOT NULL`,
    );

    for (const row of rows) {
      const version = await store.getVersionById(row.current_version_id);
      if (!version || version.admissionState !== 'registered') continue;
      const def = version.resolvedDefinition as any;
      const text = [
        def.routing?.preferredRole,
        def.routing?.workClass,
        def.soul,
        def.description,
        ...(def.capabilityProfile?.capabilityBundles ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (text.includes(intentLower) || intentLower.includes((def.routing?.preferredRole ?? '').toLowerCase())) {
        templateId = row.template_id;
        break;
      }
    }

    if (!templateId) {
      throw new Error(`No registered template found matching intent: "${args.intent}"`);
    }
  }

  const tmpl = await store.getTemplateByTemplateId(templateId);
  if (!tmpl?.currentVersionId) {
    throw new Error(`Template '${templateId}' has no registered version`);
  }

  const version = await store.getVersionById(tmpl.currentVersionId);
  if (!version || version.admissionState !== 'registered') {
    throw new Error(`Template '${templateId}' current version is not registered`);
  }

  const def = version.resolvedDefinition as any;
  const requiresHumanApproval = !isWithinBaseline(def as CatalogTemplate) || !def.approvalPolicy?.autoEligible;

  const rationale = [
    `Selected template "${tmpl.name}" (${templateId}@${version.version}).`,
    def.soul ? `Role: ${def.soul}` : null,
    `Lifecycle: ${def.lifecycleIntent ?? 'durable'}.`,
    requiresHumanApproval
      ? 'This template requires human approval before an agent is created.'
      : 'This template is eligible for auto-approval.',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    templateId,
    version: version.version,
    rationale,
    requiresHumanApproval,
    estimatedGrants: {
      primitives: def.capabilityProfile?.platformPrimitives ?? [],
      bundles: def.capabilityProfile?.capabilityBundles ?? [],
      mcp: def.mcpAccess ?? [],
      credentials: def.credentialNeeds ?? [],
    },
  };
}

// ─── catalog.instantiate ─────────────────────────────────────────────────────

export interface CatalogInstantiateArgs {
  templateId: string;
  version?: string;
  name?: string;
}

export type CatalogInstantiateResult =
  | { status: 'active'; agentId: string }
  | { status: 'pending_approval'; approvalId?: string; message: string }
  | { status: 'blocked'; code: string; detail: string; missingCredentials?: string[] };

/**
 * Request instantiation of a registered template.
 * FR-030: routes through approval policy; never widens grants beyond declaration.
 * T046: records actor='prime' admission events.
 */
export async function catalogInstantiate(
  pool: pg.Pool,
  args: CatalogInstantiateArgs,
): Promise<CatalogInstantiateResult> {
  const store = createCatalogStore(pool);

  const tmpl = await store.getTemplateByTemplateId(args.templateId);
  if (!tmpl) {
    return { status: 'blocked', code: 'TEMPLATE_NOT_FOUND', detail: `Template '${args.templateId}' not found` };
  }

  const versionId = args.version
    ? (await pool.query<{ id: string }>(
        `SELECT v.id FROM catalog_template_versions v
          JOIN catalog_templates t ON t.id = v.template_pk
         WHERE t.template_id = $1 AND v.version = $2 LIMIT 1`,
        [args.templateId, args.version],
      )).rows[0]?.id
    : tmpl.currentVersionId ?? undefined;

  if (!versionId) {
    return { status: 'blocked', code: 'VERSION_NOT_FOUND', detail: `No registered version found for '${args.templateId}'` };
  }

  const version = await store.getVersionById(versionId);
  if (!version) {
    return { status: 'blocked', code: 'VERSION_NOT_FOUND', detail: `Version not found` };
  }

  const def = version.resolvedDefinition as any;
  const withinBaseline = isWithinBaseline(def as CatalogTemplate);
  const autoEligible = def.approvalPolicy?.autoEligible === true;

  // Record that Prime is proposing this instantiation
  await pool.query(
    `INSERT INTO catalog_admission_events (version_id, from_state, to_state, actor, reason, metadata)
     VALUES ($1, $2, $3, 'prime', $4, '{}')`,
    [versionId, version.admissionState, version.admissionState, `Prime requested instantiation: ${args.name ?? 'unnamed'}`],
  );

  // If approval required, route through the approval surface (FR-030)
  if (!autoEligible || !withinBaseline) {
    // Create an approval request (reuses existing approvals table)
    const { rows: approvalRows } = await pool.query(
      `INSERT INTO approvals (id, run_id, action, status)
       VALUES (gen_random_uuid()::text, $1, $2, 'pending')
       RETURNING id`,
      [versionId, `catalog.instantiate:${args.templateId}@${version.version}`],
    );
    const approvalId = approvalRows[0]?.id;

    console.log(`[catalog:orchestrator] pending_approval templateId=${args.templateId} approvalId=${approvalId} reason=not-auto-eligible`);
    return {
      status: 'pending_approval',
      approvalId,
      message: `Instantiation of '${args.templateId}@${version.version}' requires human approval. Approval ID: ${approvalId}`,
    };
  }

  // Auto-approvable — attempt instantiation
  const result = await instantiateFromVersion(pool, versionId, { name: args.name });

  if (result.blocked) {
    console.warn(`[catalog:orchestrator] blocked templateId=${args.templateId} code=${result.blocked.code}`);
    if (result.blocked.code === 'CREDENTIAL_NOT_PROVISIONED') {
      return {
        status: 'blocked',
        code: 'CREDENTIAL_NOT_PROVISIONED',
        detail: `Missing credentials: ${result.blocked.missingCredentials.join(', ')}`,
        missingCredentials: result.blocked.missingCredentials,
      };
    }
    return { status: 'blocked', code: result.blocked.code, detail: result.blocked.detail };
  }

  // Record successful instantiation by Prime
  await pool.query(
    `INSERT INTO catalog_admission_events (version_id, from_state, to_state, actor, reason, metadata)
     VALUES ($1, 'registered', 'active', 'prime', $2, '{}')`,
    [versionId, `Auto-instantiated by Prime: agentId=${result.agentId}`],
  );

  console.log(`[catalog:orchestrator] active agentId=${result.agentId} templateId=${args.templateId}`);
  return { status: 'active', agentId: result.agentId! };
}
