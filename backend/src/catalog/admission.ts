// Admission orchestration - discovered → validated → pending_approval → registered
//
// Orchestrates sync, validation, and state transitions.
// Returns SyncEntryResult[] for batch operations.

import type { Pool } from 'pg';

import type { FailureReason, SyncEntryResult, AdmissionState } from './types.js';
import { isLegalTransition, validateTransition } from './admission-state.js';
import { checkDuplicateTemplateIds, checkVersionConflicts, checkDuplicateVersions, validateTemplate, handleRejection } from './validator.js';
import { readLocalSource } from './source.js';
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
  
  // Read templates from local source
  const { templates, errors: readErrors } = await readLocalSource(sourcePath, subpath);
  
  if (readErrors.length > 0) {
    return readErrors.map(err => ({
      templateId: 'unknown',
      version: '0.0.0',
      outcome: 'rejected',
      failureReasons: [err],
    }));
  }
  
  // Check for duplicate template IDs in batch
  const duplicateErrors = checkDuplicateTemplateIds(templates as any);
  if (duplicateErrors.length > 0) {
    return duplicateErrors.map(err => ({
      templateId: err.field || 'unknown',
      version: '0.0.0',
      outcome: 'rejected',
      failureReasons: [err],
    }));
  }
  
  // Check for duplicate versions in batch
  const duplicateVersionErrors = checkDuplicateVersions(templates as any);
  if (duplicateVersionErrors.length > 0) {
    return duplicateVersionErrors.map(err => ({
      templateId: err.detail?.split(' ')[1] || 'unknown',
      version: err.detail?.split('version ')[1] || '0.0.0',
      outcome: 'rejected',
      failureReasons: [err],
    }));
  }
  
  // Check for version conflicts with existing versions
  const existingVersions = new Map<string, string>();
  const results: SyncEntryResult[] = [];
  
  for (const template of templates as any[]) {
    const result = await processTemplate(pool, store, template, sourceId, existingVersions);
    results.push(result);
  }
  
  return results;
}

/**
 * Process a single template through admission pipeline.
 */
async function processTemplate(
  pool: Pool,
  store: ReturnType<typeof createCatalogStore>,
  template: Record<string, unknown>,
  sourceId: string,
  existingVersions: Map<string, string>
): Promise<SyncEntryResult> {
  const templateId = template.templateId as string;
  const version = template.version as string;
  
  // Create or get template record
  let templateRecord = await store.getTemplateByTemplateId(templateId);
  if (!templateRecord) {
    const templatePk = await store.createTemplate(templateId, template.name as string);
    templateRecord = await store.getTemplateById(templatePk);
  }
  
  if (!templateRecord) {
    // Failing to create a template record is an internal/store error, not a
    // template validation failure — surface it as such rather than mislabeling
    // it with a validation code.
    throw new Error(`Failed to create template record for ${templateId}`);
  }

  // Read YAML content from file
  const yamlContent = ''; // Would read from file system

  // Validate the template
  const validationContext = {
    capabilityBundleAdapters: ['read-only', 'file-read', 'git-read', 'http-get'],
    mcpServers: [], // Would be populated from database
    providers: [], // Would be populated from database
    brokerCredentials: [], // Would be populated from credential broker
  };

  // validateTemplate returns { errors, warnings }. Reject only on errors.
  // Warnings (e.g. APPROVAL_POLICY_DOWNGRADED) keep the entry valid but disable
  // auto-approval downstream.
  const { errors: validationErrors, warnings: validationWarnings } =
    await validateTemplate(yamlContent, validationContext);

  if (validationErrors.length > 0) {
    return handleRejection(templateId, version, validationErrors);
  }

  // A downgrade warning forces human approval: auto_approved stays false.
  const autoApproved =
    (template.approvalPolicy as { autoEligible?: boolean } | undefined)?.autoEligible === true &&
    validationWarnings.length === 0;
  
  // Check version conflict
  const key = `${templateId}:${version}`;
  if (existingVersions.has(key)) {
    return {
      templateId,
      version,
      outcome: 'duplicate',
    };
  }
  
  // Create version record in 'discovered' state
  const contentHash = ''; // Would compute from resolved definition
  const versionPk = await store.createVersion({
    templatePk: templateRecord.id,
    version,
    admissionState: 'discovered',
    resolvedDefinition: template as unknown as Record<string, unknown>,
    contentHash,
    sourceId,
    commitSha: undefined,
    sourcePath: undefined,
    sourceRef: undefined,
    capabilityProfileId: undefined,
    failureReasons: [],
    approvalId: undefined,
    autoApproved,
  });
  
  // Transition to 'validated'
  await recordAdmissionEvent(pool, versionPk, 'discovered', 'validated', 'sync', 'Auto-validated');
  
  // Update existing versions map
  existingVersions.set(key, version);
  
  return {
    templateId,
    version,
    outcome: 'admitted',
    admissionState: 'validated' as any,
  };
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

  // TODO: Run full validation
  // For now, just transition
  await recordAdmissionEvent(pool, versionId, version.admissionState, 'validated', 'operator', 'Manual validation');

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
  return { success: true, capabilityProfileId };
}

/**
 * Record an admission event.
 */
async function recordAdmissionEvent(
  pool: Pool,
  versionId: string,
  fromState: string,
  toState: string,
  actor: 'operator' | 'prime' | 'sync' | 'migrate',
  reason?: string
): Promise<string> {
  const store = createCatalogStore(pool);
  
  // Validate transition
  try {
    validateTransition(fromState as AdmissionState, toState as AdmissionState);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid admission transition: ${message}`);
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
  
  // Get the target version
  const versions = await store.listVersions(templateId);
  const targetVersion = versions.find(v => v.version === toVersion);
  
  if (!targetVersion) {
    return { success: false, versionId: undefined };
  }
  
  // Verify target version is registered
  if (targetVersion.admissionState !== 'registered') {
    return { success: false, versionId: undefined };
  }
  
  // Record rollback event
  const currentVersion = await store.getLatestRegisteredVersion(templateId);
  await recordAdmissionEvent(
    pool,
    targetVersion.id,
    currentVersion?.admissionState || 'registered',
    'registered',
    'operator',
    `Rollback from ${currentVersion?.version || 'unknown'} to ${toVersion}`
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
  
  // Record deprecation event for all active versions
  const versions = await store.listVersions(templateId);
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

/**
 * Sync from Git source.
 */
export async function syncFromGitSource(
  pool: Pool,
  sourceId: string,
  url: string,
  ref: string,
  subpath?: string
): Promise<SyncEntryResult[]> {
  const store = createCatalogStore(pool);
  
  // TODO: Implement Git sync
  // For now, return placeholder results
  return [];
}
