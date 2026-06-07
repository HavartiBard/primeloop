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
