// Catalog DB store - CRUD operations for catalog tables
//
// Implements CRUD for catalog_sources, catalog_templates, catalog_template_versions.
// Content hashing, snapshot freeze + immutability guard.

import pg from 'pg';
import crypto from 'crypto';

import type { FailureReason } from './types.js';

const { Pool } = pg;

export interface Store {
  createSource(source: Partial<CatalogSource>): Promise<string>;
  getSourceById(id: string): Promise<CatalogSource | null>;
  listSources(): Promise<CatalogSource[]>;
  
  createTemplate(templateId: string, name: string): Promise<string>;
  getTemplateByTemplateId(templateId: string): Promise<CatalogTemplate | null>;
  getTemplateById(id: string): Promise<CatalogTemplate | null>;
  updateTemplateCurrentVersion(templateId: string, versionId: string): Promise<void>;
  deprecateTemplate(templateId: string): Promise<void>;
  
  createVersion(version: CatalogTemplateVersionInput): Promise<string>;
  getVersionById(id: string): Promise<CatalogTemplateVersionSnapshot | null>;
  listVersions(templateId: string): Promise<CatalogTemplateVersionSnapshot[]>;
  getLatestRegisteredVersion(templateId: string): Promise<CatalogTemplateVersionSnapshot | null>;
  
  recordAdmissionEvent(event: AdmissionEventInput): Promise<string>;
  getAdmissionEvents(versionId: string): Promise<AdmissionEvent[]>;
  
  isVersionFrozen(versionId: string): Promise<boolean>;
}

export interface CatalogSource {
  id: string;
  kind: 'local' | 'git';
  name: string;
  location: string;
  defaultRef?: string;
  subpath?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogTemplate {
  id: string;
  templateId: string;
  name: string;
  currentVersionId?: string;
  lifecycleState: 'available' | 'deprecated';
  createdAt: string;
  updatedAt: string;
}

export interface CatalogTemplateVersionInput {
  templatePk: string;
  version: string;
  admissionState: string;
  resolvedDefinition: Record<string, unknown>;
  contentHash: string;
  sourceId?: string;
  commitSha?: string;
  sourcePath?: string;
  sourceRef?: string;
  capabilityProfileId?: string;
  failureReasons: FailureReason[];
  approvalId?: string;
  autoApproved: boolean;
}

export interface AdmissionEventInput {
  versionId: string;
  fromState?: string;
  toState: string;
  actor: 'operator' | 'prime' | 'sync' | 'migrate';
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface AdmissionEvent {
  id: string;
  versionId: string;
  fromState?: string;
  toState: string;
  actor: 'operator' | 'prime' | 'sync' | 'migrate';
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CatalogTemplateVersionSnapshot {
  id: string;
  templateId: string;
  version: string;
  admissionState: string;
  resolvedDefinition: Record<string, unknown>;
  contentHash: string;
  sourceId?: string;
  commitSha?: string;
  sourcePath?: string;
  sourceRef?: string;
  capabilityProfileId?: string;
  failureReasons: FailureReason[];
  approvalId?: string;
  autoApproved: boolean;
  createdAt: string;
  updatedAt: string;
}

export function createCatalogStore(pool: pg.Pool): Store {
  function hashContent(json: Record<string, unknown>): string {
    return crypto.createHash('sha256').update(JSON.stringify(json)).digest('hex');
  }

  function toIso(v: unknown): string {
    return v instanceof Date ? v.toISOString() : String(v);
  }

  function mapSourceRow(row: any): CatalogSource {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      location: row.location,
      defaultRef: row.default_ref ?? undefined,
      subpath: row.subpath ?? undefined,
      enabled: row.enabled,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  function mapTemplateRow(row: any): CatalogTemplate {
    return {
      id: row.id,
      templateId: row.template_id,
      name: row.name,
      currentVersionId: row.current_version_id ?? undefined,
      lifecycleState: row.lifecycle_state,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  function mapVersionRow(row: any): CatalogTemplateVersionSnapshot {
    return {
      id: row.id,
      templateId: row.template_id ?? '',
      version: row.version,
      admissionState: row.admission_state,
      resolvedDefinition: row.resolved_definition,
      contentHash: row.content_hash,
      sourceId: row.source_id ?? undefined,
      commitSha: row.commit_sha ?? undefined,
      sourcePath: row.source_path ?? undefined,
      sourceRef: row.source_ref ?? undefined,
      capabilityProfileId: row.capability_profile_id ?? undefined,
      failureReasons: row.failure_reasons,
      approvalId: row.approval_id ?? undefined,
      autoApproved: row.auto_approved,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  return {
    async createSource(source: Partial<CatalogSource>): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO catalog_sources (kind, name, location, default_ref, subpath, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO UPDATE SET
           kind = EXCLUDED.kind,
           location = EXCLUDED.location,
           default_ref = EXCLUDED.default_ref,
           subpath = EXCLUDED.subpath,
           enabled = EXCLUDED.enabled,
           updated_at = now()
         RETURNING id`,
        [source.kind, source.name, source.location, source.defaultRef, source.subpath, source.enabled ?? true]
      );
      return rows[0].id;
    },
    
    async getSourceById(id: string): Promise<CatalogSource | null> {
      const { rows } = await pool.query(
        `SELECT id, kind, name, location, default_ref, subpath, enabled, created_at, updated_at
         FROM catalog_sources WHERE id = $1`,
        [id]
      );
      return rows[0] ? mapSourceRow(rows[0]) : null;
    },

    async listSources(): Promise<CatalogSource[]> {
      const { rows } = await pool.query(
        `SELECT id, kind, name, location, default_ref, subpath, enabled, created_at, updated_at
         FROM catalog_sources ORDER BY created_at DESC`
      );
      return rows.map(mapSourceRow);
    },
    
    async createTemplate(templateId: string, name: string): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO catalog_templates (template_id, name)
         VALUES ($1, $2)
         ON CONFLICT (template_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
         RETURNING id`,
        [templateId, name]
      );
      return rows[0].id;
    },
    
    async getTemplateByTemplateId(templateId: string): Promise<CatalogTemplate | null> {
      const { rows } = await pool.query(
        `SELECT id, template_id, name, current_version_id, lifecycle_state, created_at, updated_at
         FROM catalog_templates WHERE template_id = $1`,
        [templateId]
      );
      return rows[0] ? mapTemplateRow(rows[0]) : null;
    },

    async getTemplateById(id: string): Promise<CatalogTemplate | null> {
      const { rows } = await pool.query(
        `SELECT id, template_id, name, current_version_id, lifecycle_state, created_at, updated_at
         FROM catalog_templates WHERE id = $1`,
        [id]
      );
      return rows[0] ? mapTemplateRow(rows[0]) : null;
    },
    
    async updateTemplateCurrentVersion(templateId: string, versionId: string): Promise<void> {
      await pool.query(
        `UPDATE catalog_templates SET current_version_id = $1, updated_at = now()
         WHERE template_id = $2`,
        [versionId, templateId]
      );
    },
    
    async deprecateTemplate(templateId: string): Promise<void> {
      await pool.query(
        `UPDATE catalog_templates SET lifecycle_state = 'deprecated', updated_at = now()
         WHERE template_id = $1`,
        [templateId]
      );
    },
    
    async createVersion(version: CatalogTemplateVersionInput): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO catalog_template_versions (
          template_pk, version, admission_state, resolved_definition, content_hash,
          source_id, commit_sha, source_path, source_ref,
          capability_profile_id, failure_reasons, approval_id, auto_approved
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (template_pk, version) DO UPDATE SET
           admission_state = EXCLUDED.admission_state,
           resolved_definition = EXCLUDED.resolved_definition,
           source_id = EXCLUDED.source_id,
           commit_sha = EXCLUDED.commit_sha,
           source_path = EXCLUDED.source_path,
           source_ref = EXCLUDED.source_ref,
           capability_profile_id = EXCLUDED.capability_profile_id,
           failure_reasons = EXCLUDED.failure_reasons,
           approval_id = EXCLUDED.approval_id,
           auto_approved = EXCLUDED.auto_approved,
           updated_at = now()
         RETURNING id`,
        [
          version.templatePk,
          version.version,
          version.admissionState,
          JSON.stringify(version.resolvedDefinition),
          version.contentHash,
          version.sourceId,
          version.commitSha,
          version.sourcePath,
          version.sourceRef,
          version.capabilityProfileId,
          JSON.stringify(version.failureReasons),
          version.approvalId,
          version.autoApproved,
        ]
      );
      return rows[0].id;
    },
    
    async getVersionById(id: string): Promise<CatalogTemplateVersionSnapshot | null> {
      const { rows } = await pool.query(
        `SELECT v.id, t.template_id, v.version, v.admission_state, v.resolved_definition, v.content_hash,
                v.source_id, v.commit_sha, v.source_path, v.source_ref,
                v.capability_profile_id, v.failure_reasons, v.approval_id, v.auto_approved,
                v.created_at, v.updated_at
         FROM catalog_template_versions v
         JOIN catalog_templates t ON t.id = v.template_pk
         WHERE v.id = $1`,
        [id]
      );
      return rows[0] ? mapVersionRow(rows[0]) : null;
    },
    
    async listVersions(templateId: string): Promise<CatalogTemplateVersionSnapshot[]> {
      const { rows } = await pool.query(
        `SELECT v.id, t.template_id, v.version, v.admission_state, v.resolved_definition, v.content_hash,
                v.source_id, v.commit_sha, v.source_path, v.source_ref,
                v.capability_profile_id, v.failure_reasons, v.approval_id, v.auto_approved,
                v.created_at, v.updated_at
         FROM catalog_template_versions v
         JOIN catalog_templates t ON t.id = v.template_pk
         WHERE v.template_pk = $1
         ORDER BY v.created_at DESC`,
        [templateId]
      );
      return (rows as any[]).map(mapVersionRow);
    },
    
    async getLatestRegisteredVersion(templateId: string): Promise<CatalogTemplateVersionSnapshot | null> {
      const { rows } = await pool.query(
        `SELECT v.id, t.template_id, v.version, v.admission_state, v.resolved_definition, v.content_hash,
                v.source_id, v.commit_sha, v.source_path, v.source_ref,
                v.capability_profile_id, v.failure_reasons, v.approval_id, v.auto_approved,
                v.created_at, v.updated_at
         FROM catalog_template_versions v
         JOIN catalog_templates t ON t.id = v.template_pk
         WHERE v.template_pk = $1 AND v.admission_state = 'registered'
         ORDER BY v.created_at DESC LIMIT 1`,
        [templateId]
      );
      return rows[0] ? mapVersionRow(rows[0]) : null;
    },
    
    async recordAdmissionEvent(event: AdmissionEventInput): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO catalog_admission_events (version_id, from_state, to_state, actor, reason, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [event.versionId, event.fromState || null, event.toState, event.actor, event.reason || null, JSON.stringify(event.metadata || {})]
      );
      return rows[0].id;
    },
    
    async getAdmissionEvents(versionId: string): Promise<AdmissionEvent[]> {
      const { rows } = await pool.query(
        `SELECT id, version_id, from_state, to_state, actor, reason, metadata, created_at
         FROM catalog_admission_events WHERE version_id = $1 ORDER BY created_at ASC`,
        [versionId]
      );
      return (rows as any[]).map(row => ({
        id: row.id,
        versionId: row.version_id,
        fromState: row.from_state || undefined,
        toState: row.to_state,
        actor: row.actor as any,
        reason: row.reason || undefined,
        metadata: row.metadata,
        createdAt: row.created_at.toISOString(),
      }));
    },
    
    async isVersionFrozen(versionId: string): Promise<boolean> {
      const { rows } = await pool.query(
        `SELECT admission_state FROM catalog_template_versions WHERE id = $1`,
        [versionId]
      );
      return (rows[0] as any)?.admission_state === 'registered';
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prime Agent Module Version Store
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleTemplateVersionInput {
  templatePk: string;
  version: string;
  admissionState: string;
  manifest: Record<string, unknown>;
  interface?: Record<string, unknown> | null;
  configurationSchema?: Record<string, unknown> | null;
  dependencies: ModuleDependency[];
  testing?: Record<string, unknown> | null;
  provenance?: Record<string, unknown> | null;
  contentHash: string;
  sourceId?: string;
  commitSha?: string;
  sourcePath?: string;
  sourceRef?: string;
  failureReasons: FailureReason[];
}

export interface ModuleDependency {
  templateId: string;
  versionRange: string;
}

export function createModuleStore(pool: pg.Pool): ModuleStore {
  return {
    async createModuleTemplate(templateId: string, name: string): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO prime_agent_module_templates (template_id, name)
         VALUES ($1, $2)
         ON CONFLICT (template_id) DO UPDATE SET
           name = EXCLUDED.name,
           updated_at = now()
         RETURNING id`,
        [templateId, name]
      );
      return rows[0].id;
    },
    
    async getModuleTemplateByTemplateId(templateId: string): Promise<ModuleTemplate | null> {
      const { rows } = await pool.query(
        `SELECT id, template_id, name, current_version_id, lifecycle_state, created_at, updated_at
         FROM prime_agent_module_templates WHERE template_id = $1`,
        [templateId]
      );
      return rows[0] ? mapModuleTemplateRow(rows[0]) : null;
    },
    
    async updateModuleCurrentVersion(templateId: string, versionId: string): Promise<void> {
      await pool.query(
        `UPDATE prime_agent_module_templates SET current_version_id = $1, updated_at = now()
         WHERE template_id = $2`,
        [versionId, templateId]
      );
    },
    
    async createModuleVersion(version: ModuleTemplateVersionInput): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO prime_agent_module_versions (
          template_pk, version, admission_state, manifest, interface, configuration_schema,
          dependencies, testing, provenance, content_hash,
          source_id, commit_sha, source_path, source_ref, failure_reasons
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (template_pk, version) DO UPDATE SET
           admission_state = EXCLUDED.admission_state,
           manifest = EXCLUDED.manifest,
           interface = EXCLUDED.interface,
           configuration_schema = EXCLUDED.configuration_schema,
           dependencies = EXCLUDED.dependencies,
           testing = EXCLUDED.testing,
           provenance = EXCLUDED.provenance,
           content_hash = EXCLUDED.content_hash,
           source_id = EXCLUDED.source_id,
           commit_sha = EXCLUDED.commit_sha,
           source_path = EXCLUDED.source_path,
           source_ref = EXCLUDED.source_ref,
           failure_reasons = EXCLUDED.failure_reasons,
           updated_at = now()
         RETURNING id`,
        [
          version.templatePk,
          version.version,
          version.admissionState,
          JSON.stringify(version.manifest),
          version.interface ? JSON.stringify(version.interface) : null,
          version.configurationSchema ? JSON.stringify(version.configurationSchema) : null,
          JSON.stringify(version.dependencies.map(d => ({ templateId: d.templateId, versionRange: d.versionRange }))),
          version.testing ? JSON.stringify(version.testing) : null,
          version.provenance ? JSON.stringify(version.provenance) : null,
          version.contentHash,
          version.sourceId || null,
          version.commitSha || null,
          version.sourcePath || null,
          version.sourceRef || null,
          JSON.stringify(version.failureReasons),
        ]
      );
      return rows[0].id;
    },
    
    async getModuleVersionById(id: string): Promise<ModuleVersionSnapshot | null> {
      const { rows } = await pool.query(
        `SELECT v.id, t.template_id, v.version, v.admission_state, v.manifest, v.interface,
                v.configuration_schema, v.dependencies, v.testing, v.provenance,
                v.content_hash, v.source_id, v.commit_sha, v.source_path, v.source_ref,
                v.failure_reasons, v.created_at, v.updated_at
         FROM prime_agent_module_versions v
         JOIN prime_agent_module_templates t ON t.id = v.template_pk
         WHERE v.id = $1`,
        [id]
      );
      return rows[0] ? mapModuleVersionRow(rows[0]) : null;
    },
    
    async listModuleVersions(templateId: string): Promise<ModuleVersionSnapshot[]> {
      const { rows } = await pool.query(
        `SELECT v.id, t.template_id, v.version, v.admission_state, v.manifest, v.interface,
                v.configuration_schema, v.dependencies, v.testing, v.provenance,
                v.content_hash, v.source_id, v.commit_sha, v.source_path, v.source_ref,
                v.failure_reasons, v.created_at, v.updated_at
         FROM prime_agent_module_versions v
         JOIN prime_agent_module_templates t ON t.id = v.template_pk
         WHERE t.template_id = $1
         ORDER BY v.created_at DESC`,
        [templateId]
      );
      return (rows as any[]).map(mapModuleVersionRow);
    },
    
    async getLatestRegisteredModuleVersion(templateId: string): Promise<ModuleVersionSnapshot | null> {
      const { rows } = await pool.query(
        `SELECT v.id, t.template_id, v.version, v.admission_state, v.manifest, v.interface,
                v.configuration_schema, v.dependencies, v.testing, v.provenance,
                v.content_hash, v.source_id, v.commit_sha, v.source_path, v.source_ref,
                v.failure_reasons, v.created_at, v.updated_at
         FROM prime_agent_module_versions v
         JOIN prime_agent_module_templates t ON t.id = v.template_pk
         WHERE t.template_id = $1 AND v.admission_state = 'registered'
         ORDER BY v.created_at DESC LIMIT 1`,
        [templateId]
      );
      return rows[0] ? mapModuleVersionRow(rows[0]) : null;
    },
    
    async recordModuleDependency(
      moduleVersionId: string,
      dependencyTemplateId: string,
      requiredVersionRange: string
    ): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO prime_agent_module_dependencies (
          module_version_id, dependency_template_id, required_version_range
        ) VALUES ($1, $2, $3)
         ON CONFLICT (module_version_id, dependency_template_id) DO UPDATE SET
           required_version_range = EXCLUDED.required_version_range,
           resolved_version = NULL,
           satisfied = false,
           updated_at = now()
         RETURNING id`,
        [moduleVersionId, dependencyTemplateId, requiredVersionRange]
      );
      return rows[0].id;
    },
    
    async updateModuleDependencySatisfied(
      moduleVersionId: string,
      dependencyTemplateId: string,
      satisfied: boolean,
      resolvedVersion?: string
    ): Promise<void> {
      await pool.query(
        `UPDATE prime_agent_module_dependencies SET
           satisfied = $1,
           resolved_version = $2,
           updated_at = now()
         WHERE module_version_id = $3 AND dependency_template_id = $4`,
        [satisfied, resolvedVersion || null, moduleVersionId, dependencyTemplateId]
      );
    },
    
    async pinModuleVersion(moduleVersionId: string, actor: string, reason?: string): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO prime_agent_module_pins (module_version_id, actor, reason)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [moduleVersionId, actor, reason || null]
      );
      return rows[0].id;
    },
    
    async rollbackModuleVersion(
      moduleTemplateId: string,
      fromVersionId: string,
      toVersionId: string,
      actor: string,
      reason?: string
    ): Promise<string> {
      const { rows } = await pool.query(
        `INSERT INTO prime_agent_module_rollback_history (
          module_template_id, from_version_id, to_version_id, actor, reason
        ) VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [moduleTemplateId, fromVersionId, toVersionId, actor, reason || null]
      );
      return rows[0].id;
    },
  };
}

function mapModuleTemplateRow(row: any): ModuleTemplate {
  return {
    id: row.id,
    templateId: row.template_id,
    name: row.name,
    currentVersionId: row.current_version_id || undefined,
    lifecycleState: row.lifecycle_state as 'available' | 'deprecated',
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapModuleVersionRow(row: any): ModuleVersionSnapshot {
  return {
    id: row.id,
    templateId: row.template_id,
    version: row.version,
    admissionState: row.admission_state,
    manifest: JSON.parse(row.manifest),
    interface: row.interface ? JSON.parse(row.interface) : undefined,
    configurationSchema: row.configuration_schema ? JSON.parse(row.configuration_schema) : undefined,
    dependencies: JSON.parse(row.dependencies || '[]'),
    testing: row.testing ? JSON.parse(row.testing) : undefined,
    provenance: row.provenance ? JSON.parse(row.provenance) : undefined,
    contentHash: row.content_hash,
    sourceId: row.source_id || undefined,
    commitSha: row.commit_sha || undefined,
    sourcePath: row.source_path || undefined,
    sourceRef: row.source_ref || undefined,
    failureReasons: JSON.parse(row.failure_reasons || '[]'),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface ModuleTemplate {
  id: string;
  templateId: string;
  name: string;
  currentVersionId?: string;
  lifecycleState: 'available' | 'deprecated';
  createdAt: string;
  updatedAt: string;
}

export interface ModuleVersionSnapshot {
  id: string;
  templateId: string;
  version: string;
  admissionState: string;
  manifest: Record<string, unknown>;
  interface?: Record<string, unknown>;
  configurationSchema?: Record<string, unknown>;
  dependencies: ModuleDependency[];
  testing?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  contentHash: string;
  sourceId?: string;
  commitSha?: string;
  sourcePath?: string;
  sourceRef?: string;
  failureReasons: FailureReason[];
  createdAt: string;
  updatedAt: string;
}

export interface ModuleStore {
  createModuleTemplate(templateId: string, name: string): Promise<string>;
  getModuleTemplateByTemplateId(templateId: string): Promise<ModuleTemplate | null>;
  updateModuleCurrentVersion(templateId: string, versionId: string): Promise<void>;
  
  createModuleVersion(version: ModuleTemplateVersionInput): Promise<string>;
  getModuleVersionById(id: string): Promise<ModuleVersionSnapshot | null>;
  listModuleVersions(templateId: string): Promise<ModuleVersionSnapshot[]>;
  getLatestRegisteredModuleVersion(templateId: string): Promise<ModuleVersionSnapshot | null>;
  
  recordModuleDependency(
    moduleVersionId: string,
    dependencyTemplateId: string,
    requiredVersionRange: string
  ): Promise<string>;
  updateModuleDependencySatisfied(
    moduleVersionId: string,
    dependencyTemplateId: string,
    satisfied: boolean,
    resolvedVersion?: string
  ): Promise<void>;
  
  pinModuleVersion(moduleVersionId: string, actor: string, reason?: string): Promise<string>;
  rollbackModuleVersion(
    moduleTemplateId: string,
    fromVersionId: string,
    toVersionId: string,
    actor: string,
    reason?: string
  ): Promise<string>;
}
