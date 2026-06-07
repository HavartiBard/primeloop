// Catalog API routes
//
// REST endpoints for catalog operations:
// - GET /templates - list templates
// - GET /templates/:id - get template details
// - POST /sync - sync templates from source
// - POST /templates/:id/versions/:v/validate - validate a version
// - POST /templates/:id/versions/:v/approve - approve a version
// - POST /templates/:id/rollback - rollback to previous version
// - POST /templates/:id/deprecate - deprecate template
// - POST /templates/:id/versions/:v/instantiate - instantiate a version

import { Router } from 'express';
import type pg from 'pg';

import { syncFromLocalSource, syncFromGitSource, validateVersion, requestApproval, approveVersion, rollbackVersion, deprecateTemplate, VersionStateError } from '../catalog/admission.js';
import { instantiateFromVersion } from '../catalog/instantiate.js';
import { createRegistrar } from '../catalog/registrar.js';
import { createCatalogStore } from '../catalog/store.js';
import { migrateToCatalog } from '../catalog/migrate.js';

/**
 * Resolve a (templateId text, version string) pair to a version row id.
 * Returns null when either the template or the version is unknown.
 */
async function resolveVersionId(
  pool: pg.Pool,
  templateId: string,
  version: string,
): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT v.id
       FROM catalog_template_versions v
       JOIN catalog_templates t ON t.id = v.template_pk
      WHERE t.template_id = $1 AND v.version = $2
      LIMIT 1`,
    [templateId, version],
  );
  return rows[0]?.id ?? null;
}

export interface CatalogDeps {
  pool: pg.Pool;
}

export function createCatalogRouter(deps: CatalogDeps): Router {
  const router = Router();
  
  // GET /templates - list templates (camelCase via store mapper)
  router.get('/templates', async (req, res) => {
    try {
      const store = createCatalogStore(deps.pool);
      const { rows } = await deps.pool.query(
        `SELECT id, template_id, name, current_version_id, lifecycle_state, created_at, updated_at
         FROM catalog_templates ORDER BY created_at DESC`,
      );
      // Re-use the store's mapTemplateRow by proxying through getTemplateById for each,
      // or just map inline (same logic as mapTemplateRow in store.ts).
      const templates = rows.map((row: any) => ({
        id: row.id,
        templateId: row.template_id,
        name: row.name,
        currentVersionId: row.current_version_id ?? undefined,
        lifecycleState: row.lifecycle_state,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      }));
      res.json({ templates });
    } catch (err) {
      console.error('[catalog] GET /templates error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // GET /templates/:id - get template with versions (all camelCase)
  router.get('/templates/:id', async (req, res) => {
    try {
      const store = createCatalogStore(deps.pool);
      const { id } = req.params;

      // Try templateId (slug) first, then UUID
      const template =
        (await store.getTemplateByTemplateId(id)) ?? (await store.getTemplateById(id));
      if (!template) {
        return res.status(404).json({ error: 'template not found' });
      }

      const versions = await store.listVersions(template.id);
      res.json({ template, versions });
    } catch (err) {
      console.error('[catalog] GET /templates/:id error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // POST /sync - sync templates from a local catalog source
  router.post('/sync', async (req, res) => {
    try {
      const store = createCatalogStore(deps.pool);
      const { sourceId } = req.body as { sourceId?: string };

      // Resolve source: use the provided sourceId or fall back to default-local
      let source;
      if (sourceId) {
        source = await store.getSourceById(sourceId);
        if (!source) {
          return res.status(404).json({ error: 'source not found', code: 'SOURCE_NOT_FOUND' });
        }
      } else {
        const sources = await store.listSources();
        source = sources.find((s) => s.name === 'default-local') ?? sources[0];
        if (!source) {
          return res.status(404).json({ error: 'no catalog source configured', code: 'NO_SOURCE' });
        }
      }

      let results;
      if (source.kind === 'local') {
        results = await syncFromLocalSource({
          pool: deps.pool,
          sourceId: source.id,
          sourcePath: source.location,
          subpath: source.subpath,
          sourceRef: (req.body as any).ref,
        });
      } else {
        // Git source: resolve ref→SHA at sync time (FR-014)
        const ref = (req.body as any).ref ?? source.defaultRef ?? 'main';
        results = await syncFromGitSource({
          pool: deps.pool,
          sourceId: source.id,
          repoPath: source.location,
          ref,
          subpath: source.subpath,
        });
      }

      res.json({ results });
    } catch (err) {
      console.error('[catalog] POST /sync error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });
  
  // POST /templates/:id/versions/:v/validate - re-run validation for a version
  router.post('/templates/:id/versions/:version/validate', async (req, res) => {
    try {
      const { id, version } = req.params;

      const versionId = await resolveVersionId(deps.pool, id, version);
      if (!versionId) {
        return res.status(404).json({ error: 'template version not found' });
      }

      const result = await validateVersion(deps.pool, versionId);
      res.json({
        state: result.success ? 'validated' : 'rejected',
        failureReasons: result.failureReasons ?? [],
      });
    } catch (err) {
      if (err instanceof VersionStateError) {
        return res.status(409).json({ error: err.message, code: 'INVALID_STATE' });
      }
      console.error('[catalog] POST /templates/:id/versions/:v/validate error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });
  
  // POST /templates/:id/versions/:v/approve - approve a pending version (→ registered)
  router.post('/templates/:id/versions/:version/approve', async (req, res) => {
    try {
      const { id, version } = req.params;
      const { note } = req.body as { note?: string };

      const versionId = await resolveVersionId(deps.pool, id, version);
      if (!versionId) {
        return res.status(404).json({ error: 'template version not found' });
      }

      const result = await approveVersion(deps.pool, versionId, note);
      // registered → { state: 'registered', capabilityProfileId }
      res.json({ state: 'registered', capabilityProfileId: result.capabilityProfileId });
    } catch (err) {
      if (err instanceof VersionStateError) {
        // Wrong admission state (e.g. not pending_approval) → 409
        return res.status(409).json({ error: err.message, code: 'INVALID_STATE' });
      }
      console.error('[catalog] POST /templates/:id/versions/:v/approve error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });
  
  // POST /templates/:id/rollback - rollback to previous version
  router.post('/templates/:id/rollback', async (req, res) => {
    try {
      const { id } = req.params;
      const { version } = req.body as { version: string };
      
      if (!version) {
        return res.status(400).json({ error: 'version is required' });
      }
      
      const result = await rollbackVersion(deps.pool, id, version);
      
      if (!result.success) {
        return res.status(400).json({ error: 'rollback failed' });
      }
      
      res.json({ success: true, versionId: result.versionId });
    } catch (err) {
      console.error('[catalog] POST /templates/:id/rollback error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });
  
  // POST /templates/:id/deprecate - deprecate template
  router.post('/templates/:id/deprecate', async (req, res) => {
    try {
      const { id } = req.params;
      
      const result = await deprecateTemplate(deps.pool, id);
      
      if (!result.success) {
        return res.status(404).json({ error: 'template not found' });
      }
      
      res.json({ success: true });
    } catch (err) {
      console.error('[catalog] POST /templates/:id/deprecate error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });
  
  // POST /templates/:id/versions/:v/instantiate - registered → active (managed agent)
  router.post('/templates/:id/versions/:version/instantiate', async (req, res) => {
    try {
      const { id, version } = req.params;
      const { overrides } = req.body as { overrides?: { name?: string } };

      const versionId = await resolveVersionId(deps.pool, id, version);
      if (!versionId) {
        return res.status(404).json({ error: 'template version not found' });
      }

      const result = await instantiateFromVersion(deps.pool, versionId, overrides);

      if (result.blocked) {
        if (result.blocked.code === 'CREDENTIAL_NOT_PROVISIONED') {
          return res.status(412).json({
            error: 'declared credential not provisioned',
            code: 'CREDENTIAL_NOT_PROVISIONED',
            missingCredentials: result.blocked.missingCredentials,
          });
        }
        // NOT_REGISTERED / NO_CAPABILITY_PROFILE → wrong state → 409
        return res.status(409).json({ error: result.blocked.detail, code: result.blocked.code });
      }

      res.status(201).json({ agentId: result.agentId, state: 'active' });
    } catch (err) {
      console.error('[catalog] POST /templates/:id/versions/:v/instantiate error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });
  
  // ── Sources endpoints (T037) ──────────────────────────────────────────────

  // GET /sources - list configured catalog sources
  router.get('/sources', async (req, res) => {
    try {
      const store = createCatalogStore(deps.pool);
      const sources = await store.listSources();
      res.json({ sources });
    } catch (err) {
      console.error('[catalog] GET /sources error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // POST /sources - add or update a catalog source
  router.post('/sources', async (req, res) => {
    try {
      const { kind, name, location, defaultRef, subpath } = req.body as {
        kind?: string; name?: string; location?: string; defaultRef?: string; subpath?: string;
      };
      if (!kind || !name || !location) {
        return res.status(400).json({ error: 'kind, name, and location are required' });
      }
      if (kind !== 'local' && kind !== 'git') {
        return res.status(400).json({ error: "kind must be 'local' or 'git'" });
      }
      const store = createCatalogStore(deps.pool);
      const id = await store.createSource({ kind, name, location, defaultRef, subpath, enabled: true });
      const source = await store.getSourceById(id);
      res.status(201).json({ source });
    } catch (err) {
      console.error('[catalog] POST /sources error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // POST /migrate - generate catalog YAML drafts from in-code templates
  // ?write=true also persists them to backend/catalog/
  router.post('/migrate', async (req, res) => {
    try {
      const write = req.query['write'] === 'true' || (req.body as Record<string, unknown>)?.write === true;
      const result = await migrateToCatalog({ write });
      res.status(200).json(result);
    } catch (err) {
      console.error('[catalog] POST /migrate error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}
