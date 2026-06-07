// Admission orchestration - discovered → validated → pending_approval → registered
//
// Orchestrates sync, validation, and state transitions.
// Returns SyncEntryResult[] for batch operations.

import type { Pool } from 'pg';

import * as yaml from 'yaml';
import { createHash } from 'crypto';
import type { FailureReason, SyncEntryResult, AdmissionState } from './types.js';
import { isLegalTransition, validateTransition } from './admission-state.js';
import { checkDuplicateTemplateIds, checkVersionConflicts, checkDuplicateVersions, validateTemplate, handleRejection } from './validator.js';
import { readLocalSource, readGitSourceLocal, resolveRefToSha } from './source.js';
import { createCatalogStore } from './store.js';
import { createRegistrar } from './registrar.js';

/**
 * Distinct outcome for "cannot operate from current state" — NOT a validation
 * failure. Lets routes surface a 4xx that is not confused with a rejected
 * template (which carries FailureReason[]).
 */
export class VersionStateError extends Error {
  constructor(
    message: string,
    public readonly currentState: string,
  ) {
    super(message);
    this.name = 'VersionStateError';
  }
}

export interface SyncContext {
  pool: Pool;
  sourceId: string;
  sourcePath: string;
  subpath?: string;
  /** For git sources: the ref supplied by the operator (branch/tag/SHA). */
  sourceRef?: string;
}

export interface GitSyncContext {
  pool: Pool;
  sourceId: string;
  repoPath: string;   // path to the local git repo (or remote URL for clone-based)
  ref: string;        // branch, tag, or commit SHA — resolved to SHA at sync time
  subpath?: string;
}

/**
 * Sync templates from local source.
 * Returns list of results for each template processed.
 */
export async function syncFromLocalSource(
  context: SyncContext
): Promise<SyncEntryResult[]> {
  const { pool, sourceId, sourcePath, subpath } = context;
  const store = createCatalogStore(pool);

  console.log(`[catalog:sync] starting sync sourceId=${sourceId} path=${sourcePath}`);

  // Read templates from local source
  const { templates, errors: readErrors } = await readLocalSource(sourcePath, subpath);

  if (readErrors.length > 0) {
    console.warn(`[catalog:sync] source read errors: ${readErrors.length}`);
    return readErrors.map(err => ({
      templateId: 'unknown',
      version: '0.0.0',
      outcome: 'rejected',
      failureReasons: [err],
    }));
  }

  // Batch-level duplicate checks — these fail the whole affected set, not the batch
  const duplicateErrors = checkDuplicateTemplateIds(templates as any);
  if (duplicateErrors.length > 0) {
    console.warn(`[catalog:sync] duplicate template IDs in batch: ${duplicateErrors.map(e => e.detail).join(', ')}`);
    return duplicateErrors.map(err => ({
      templateId: err.field || 'unknown',
      version: '0.0.0',
      outcome: 'rejected',
      failureReasons: [err],
    }));
  }

  const duplicateVersionErrors = checkDuplicateVersions(templates as any);
  if (duplicateVersionErrors.length > 0) {
    console.warn(`[catalog:sync] duplicate versions in batch`);
    return duplicateVersionErrors.map(err => ({
      templateId: err.detail?.split(' ')[1] || 'unknown',
      version: err.detail?.split('version ')[1] || '0.0.0',
      outcome: 'rejected',
      failureReasons: [err],
    }));
  }

  // Build validation context from DB (real references, not hardcoded)
  const validationContext = await buildValidationContext(pool);

  const existingVersions = new Map<string, string>();
  const results: SyncEntryResult[] = [];

  for (const template of templates as any[]) {
    const result = await processTemplate(pool, store, template, sourceId, existingVersions, validationContext, {
      sourceRef: context.sourceRef,
    });
    results.push(result);
    if (result.outcome === 'rejected') {
      console.warn(
        `[catalog:sync] rejected templateId=${result.templateId} version=${result.version} ` +
        `reasons=${result.failureReasons?.map(r => r.code).join(',') ?? 'none'}`,
      );
    } else {
      console.log(`[catalog:sync] ${result.outcome} templateId=${result.templateId} version=${result.version} state=${result.admissionState ?? ''}`);
    }
  }

  console.log(`[catalog:sync] complete: ${results.filter(r => r.outcome === 'admitted').length} admitted, ${results.filter(r => r.outcome === 'rejected').length} rejected`);
  return results;
}

/**
 * Sync templates from a local git repository at a specific ref (T036, T038).
 * Resolves the ref to an immutable commit SHA at sync time (FR-014).
 */
export async function syncFromGitSource(
  context: GitSyncContext,
): Promise<SyncEntryResult[]> {
  const { pool, sourceId, repoPath, ref, subpath } = context;
  const store = createCatalogStore(pool);

  console.log(`[catalog:sync:git] starting git sync sourceId=${sourceId} repo=${repoPath} ref=${ref}`);

  // Resolve the (possibly moving) ref to an immutable SHA (FR-014)
  let commitSha: string;
  try {
    commitSha = await resolveRefToSha(repoPath, ref);
  } catch (err) {
    return [{ templateId: 'unknown', version: '0.0.0', outcome: 'rejected',
      failureReasons: [{ code: 'INVALID_FIELD_TYPE', detail: `Cannot resolve ref '${ref}': ${(err as Error).message}` }] }];
  }

  console.log(`[catalog:sync:git] resolved ref=${ref} → sha=${commitSha}`);

  const { templates, errors: readErrors } = await readGitSourceLocal(repoPath, commitSha, subpath);

  if (readErrors.length > 0) {
    return readErrors.map(err => ({ templateId: 'unknown', version: '0.0.0', outcome: 'rejected', failureReasons: [err] }));
  }

  const duplicateErrors = checkDuplicateTemplateIds(templates as any);
  if (duplicateErrors.length > 0) {
    return duplicateErrors.map(err => ({ templateId: err.field || 'unknown', version: '0.0.0', outcome: 'rejected', failureReasons: [err] }));
  }

  const duplicateVersionErrors = checkDuplicateVersions(templates as any);
  if (duplicateVersionErrors.length > 0) {
    return duplicateVersionErrors.map(err => ({ templateId: 'unknown', version: '0.0.0', outcome: 'rejected', failureReasons: [err] }));
  }

  const validationContext = await buildValidationContext(pool);
  const existingVersions = new Map<string, string>();
  const results: SyncEntryResult[] = [];

  for (const template of templates as any[]) {
    const result = await processTemplate(pool, store, template, sourceId, existingVersions, validationContext, {
      commitSha,
      sourceRef: ref,
    });
    results.push(result);
    if (result.outcome === 'rejected') {
      console.warn(`[catalog:sync:git] rejected templateId=${result.templateId} reasons=${result.failureReasons?.map(r => r.code).join(',')}`);
    } else {
      console.log(`[catalog:sync:git] ${result.outcome} templateId=${result.templateId} version=${result.version} sha=${commitSha}`);
    }
  }

  console.log(`[catalog:sync:git] complete sha=${commitSha}: ${results.filter(r => r.outcome === 'admitted').length} admitted, ${results.filter(r => r.outcome === 'rejected').length} rejected`);
  return results;
}

/** Build a validation context by querying live DB references. */
async function buildValidationContext(pool: Pool) {
  const [bundles, mcpRows, providerRows] = await Promise.all([
    pool.query<{ capability_bundle: string }>(
      `SELECT DISTINCT capability_bundle FROM capability_bundle_adapters`,
    ),
    pool.query<{ name: string }>(`SELECT name FROM mcp_servers WHERE true`),
    pool.query<{ name: string }>(`SELECT name FROM providers`),
  ]);
  return {
    capabilityBundleAdapters: bundles.rows.map(r => r.capability_bundle),
    mcpServers: mcpRows.rows.map(r => r.name),
    providers: providerRows.rows.map(r => r.name),
    brokerCredentials: [] as string[], // Credential broker checked at instantiation time
  };
}

/**
 * Process a single template through admission pipeline.
 */
interface TemplateProvenance {
  commitSha?: string;
  sourceRef?: string;
  sourcePath?: string;
}

async function processTemplate(
  pool: Pool,
  store: ReturnType<typeof createCatalogStore>,
  template: Record<string, unknown>,
  sourceId: string,
  existingVersions: Map<string, string>,
  validationContext: Awaited<ReturnType<typeof buildValidationContext>>,
  provenance: TemplateProvenance = {},
): Promise<SyncEntryResult> {
  const templateId = (template.templateId as string | undefined) ?? 'unknown';
  const version = (template.version as string | undefined) ?? '';

  // Compute content hash first — if this exact version already exists and
  // hasn't changed (same hash), return 'duplicate' without re-processing.
  const contentHash = computeHash(template);
  const existingByHash = await pool.query<{ id: string; admission_state: string }>(
    `SELECT v.id, v.admission_state
       FROM catalog_template_versions v
       JOIN catalog_templates t ON t.id = v.template_pk
      WHERE t.template_id = $1 AND v.version = $2 AND v.content_hash = $3
      LIMIT 1`,
    [templateId, version, contentHash],
  );
  if (existingByHash.rows.length > 0 && existingByHash.rows[0].admission_state !== 'rejected') {
    return { templateId, version, outcome: 'duplicate', admissionState: existingByHash.rows[0].admission_state as any };
  }

  // Serialize the resolved template back to YAML for the validator.
  // (readLocalSource already resolved file references into the object.)
  const yamlContent = yaml.stringify(template);

  // validateTemplate returns { errors, warnings }. Reject only on errors.
  // Run validation BEFORE touching the DB so a structural failure (e.g. missing
  // required field) never results in a partial DB write with null columns.
  const { errors: validationErrors, warnings: validationWarnings } =
    await validateTemplate(yamlContent, validationContext);

  if (validationErrors.length > 0) {
    // Only persist a version row when we have both templateId and version —
    // missing-required-field templates may lack them and would violate NOT NULL.
    if (templateId !== 'unknown' && version !== '') {
      let templateRecord = await store.getTemplateByTemplateId(templateId);
      if (!templateRecord) {
        const templatePk = await store.createTemplate(templateId, (template.name as string) || templateId);
        templateRecord = await store.getTemplateById(templatePk);
      }
      if (templateRecord) {
        const versionPk = await store.createVersion({
          templatePk: templateRecord.id,
          version,
          admissionState: 'rejected',
          resolvedDefinition: template as unknown as Record<string, unknown>,
          contentHash,
          sourceId,
          commitSha: provenance.commitSha,
          sourceRef: provenance.sourceRef,
          sourcePath: provenance.sourcePath,
          failureReasons: validationErrors,
          autoApproved: false,
        });
        await recordAdmissionEvent(pool, versionPk, undefined, 'rejected', 'sync',
          validationErrors.map(e => e.code).join(', '));
      }
    }
    return handleRejection(templateId, version, validationErrors);
  }

  // Check in-batch version conflict (after validation so we have real templateId+version)
  const key = `${templateId}:${version}`;
  if (existingVersions.has(key)) {
    return { templateId, version, outcome: 'duplicate' };
  }

  // Create or get template record for a valid template
  let templateRecord = await store.getTemplateByTemplateId(templateId);
  if (!templateRecord) {
    const templatePk = await store.createTemplate(templateId, template.name as string);
    templateRecord = await store.getTemplateById(templatePk);
  }
  if (!templateRecord) {
    throw new Error(`Failed to create template record for ${templateId}`);
  }

  // APPROVAL_POLICY_DOWNGRADED warning forces human approval (auto_approved=false)
  const autoApproved =
    (template.approvalPolicy as { autoEligible?: boolean } | undefined)?.autoEligible === true &&
    validationWarnings.length === 0;

  const versionPk = await store.createVersion({
    templatePk: templateRecord.id,
    version,
    admissionState: 'validated',
    resolvedDefinition: template as unknown as Record<string, unknown>,
    contentHash,
    sourceId,
    commitSha: provenance.commitSha,
    sourceRef: provenance.sourceRef,
    sourcePath: provenance.sourcePath,
    failureReasons: [],
    autoApproved,
  });

  await recordAdmissionEvent(pool, versionPk, 'discovered', 'validated', 'sync', 'Auto-validated');
  existingVersions.set(key, version);

  return { templateId, version, outcome: 'admitted', admissionState: 'validated' };
}

function computeHash(obj: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
}

/**
 * Validate a specific version and transition to validated.
 */
export async function validateVersion(
  pool: Pool,
  versionId: string
): Promise<{ success: boolean; failureReasons?: FailureReason[] }> {
  const store = createCatalogStore(pool);

  const version = await store.getVersionById(versionId);
  if (!version) {
    // "Not found" is not a validation failure; it has no FailureReason code.
    throw new VersionStateError(`Version ${versionId} not found`, 'missing');
  }

  // Wrong state is also not a validation failure — distinct error shape.
  if (!['discovered', 'rejected'].includes(version.admissionState)) {
    throw new VersionStateError(
      `Cannot validate from state '${version.admissionState}'`,
      version.admissionState,
    );
  }

  // Re-run full validation against live DB references
  const validationContext = await buildValidationContext(pool);
  const yamlContent = yaml.stringify(version.resolvedDefinition);
  const { errors: validationErrors } = await validateTemplate(yamlContent, validationContext);

  if (validationErrors.length > 0) {
    // Persist updated failure_reasons and keep in 'rejected'
    await pool.query(
      `UPDATE catalog_template_versions SET admission_state = 'rejected', failure_reasons = $1, updated_at = now() WHERE id = $2`,
      [JSON.stringify(validationErrors), versionId],
    );
    await recordAdmissionEvent(pool, versionId, version.admissionState, 'rejected', 'operator',
      validationErrors.map(e => e.code).join(', '));
    console.warn(`[catalog:validate] rejected versionId=${versionId} reasons=${validationErrors.map(e => e.code).join(',')}`);
    return { success: false, failureReasons: validationErrors };
  }

  await pool.query(
    `UPDATE catalog_template_versions SET admission_state = 'validated', failure_reasons = '[]', updated_at = now() WHERE id = $1`,
    [versionId],
  );
  await recordAdmissionEvent(pool, versionId, version.admissionState, 'validated', 'operator', 'Manual validation');
  console.log(`[catalog:validate] validated versionId=${versionId}`);
  return { success: true };
}

/**
 * Request approval for a validated version.
 */
export async function requestApproval(
  pool: Pool,
  versionId: string
): Promise<{ success: boolean; approvalId?: string }> {
  const store = createCatalogStore(pool);
  
  const version = await store.getVersionById(versionId);
  if (!version) {
    return { success: false, approvalId: undefined };
  }
  
  // Check current state allows approval request
  if (version.admissionState !== 'validated') {
    return { success: false, approvalId: undefined };
  }
  
  // TODO: Create approval record in approvals table
  // For now, transition directly to registered for auto-eligible templates
  
  await recordAdmissionEvent(pool, versionId, version.admissionState, 'pending_approval', 'operator', 'Approval requested');
  
  return { success: true, approvalId: undefined };
}

/**
 * Approve a pending version and register it.
 */
export async function approveVersion(
  pool: Pool,
  versionId: string,
  note?: string
): Promise<{ success: boolean; capabilityProfileId?: string }> {
  const store = createCatalogStore(pool);

  const version = await store.getVersionById(versionId);
  if (!version) {
    throw new VersionStateError(`Version ${versionId} not found`, 'missing');
  }

  // Only a pending_approval version can be approved → registered.
  if (version.admissionState !== 'pending_approval') {
    throw new VersionStateError(
      `Cannot approve from state '${version.admissionState}'`,
      version.admissionState,
    );
  }

  // Delegate the actual registration to the registrar: it maps the capability
  // profile, links it, freezes the snapshot (state → registered), points the
  // template's current_version_id, and records the admission event. Single path.
  const registrar = createRegistrar(pool);
  const { capabilityProfileId } = await registrar.registerVersion(versionId);

  void note; // approval note reserved for the approval-queue link (future)
  console.log(`[catalog:approve] registered versionId=${versionId} capabilityProfileId=${capabilityProfileId}`);
  return { success: true, capabilityProfileId };
}

/**
 * Record an admission event.
 */
async function recordAdmissionEvent(
  pool: Pool,
  versionId: string,
  fromState: string | undefined,
  toState: string,
  actor: 'operator' | 'prime' | 'sync' | 'migrate',
  reason?: string
): Promise<string> {
  const store = createCatalogStore(pool);
  
  // Only validate state-machine transitions when fromState is known.
  // When fromState is undefined the version is being written for the first time
  // (e.g. immediate rejection before a 'discovered' row exists); skip the check.
  if (fromState !== undefined) {
    try {
      validateTransition(fromState as AdmissionState, toState as AdmissionState);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid admission transition: ${message}`);
    }
  }
  
  return store.recordAdmissionEvent({
    versionId,
    fromState,
    toState,
    actor,
    reason,
  });
}

/**
 * Rollback to a previous registered version.
 * Restores the previous registered version as the current version.
 */
export async function rollbackVersion(
  pool: Pool,
  templateId: string,
  toVersion: string
): Promise<{ success: boolean; versionId?: string }> {
  const store = createCatalogStore(pool);

  // templateId is the stable slug — resolve to the UUID PK first
  const tmpl = await store.getTemplateByTemplateId(templateId);
  if (!tmpl) return { success: false };

  const versions = await store.listVersions(tmpl.id);
  const targetVersion = versions.find(v => v.version === toVersion);

  if (!targetVersion) {
    return { success: false, versionId: undefined };
  }

  if (targetVersion.admissionState !== 'registered') {
    return { success: false, versionId: undefined };
  }

  const currentVersion = versions.find(v => v.id === tmpl.currentVersionId);

  // Write a rollback audit event directly (bypasses state-machine validation —
  // this is a pointer update, not a real state transition; both versions stay 'registered').
  const auditVersionId = currentVersion?.id ?? targetVersion.id;
  await pool.query(
    `INSERT INTO catalog_admission_events (version_id, from_state, to_state, actor, reason, metadata)
     VALUES ($1, 'registered', 'registered', 'operator', $2, '{}')`,
    [auditVersionId, `Rollback: current version changed from ${currentVersion?.version ?? 'unknown'} to ${toVersion}`],
  );

  // Update template's current version
  await store.updateTemplateCurrentVersion(templateId, targetVersion.id);
  
  return { success: true, versionId: targetVersion.id };
}

/**
 * Deprecate a template.
 * Marks the template as deprecated and updates its lifecycle state.
 */
export async function deprecateTemplate(
  pool: Pool,
  templateId: string
): Promise<{ success: boolean }> {
  const store = createCatalogStore(pool);
  
  // Get template record
  const template = await store.getTemplateByTemplateId(templateId);
  if (!template) {
    return { success: false };
  }
  
  // Record deprecation event for all active versions (listVersions needs UUID PK)
  const versions = await store.listVersions(template.id);
  for (const version of versions) {
    if (['active', 'registered'].includes(version.admissionState)) {
      await recordAdmissionEvent(
        pool,
        version.id,
        version.admissionState,
        'deprecated',
        'operator',
        `Template ${templateId} deprecated`
      );
    }
  }
  
  // Update template lifecycle state
  await store.deprecateTemplate(templateId);
  
  return { success: true };
}

