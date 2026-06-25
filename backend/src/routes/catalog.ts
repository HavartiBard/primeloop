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
import { createModuleStore } from '../catalog/store.js';
import type { ModuleTemplate, ModuleVersionSnapshot, ModuleDependency } from '../catalog/store.js';
import { parseModuleDependency, isValidVersionRange } from '../catalog/schema.js';
import { compareVersions, findHighestSatisfyingVersion, detectCircularDependencies, parseVersion, satisfiesVersion } from '../catalog/types.js';

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

  // ─────────────────────────────────────────────────────────────────────────────
  // Prime Agent Module Versioning API (spec 027)
  // ─────────────────────────────────────────────────────────────────────────────

  // GET /modules - list all module templates with their versions
  router.get('/modules', async (req, res) => {
    try {
      const store = createModuleStore(deps.pool);
      const { rows } = await deps.pool.query(
        `SELECT id, template_id, name, current_version_id, lifecycle_state, created_at, updated_at
         FROM prime_agent_module_templates ORDER BY created_at DESC`,
      );
      const templates: ModuleTemplate[] = rows.map((row: any) => ({
        id: row.id,
        templateId: row.template_id,
        name: row.name,
        currentVersionId: row.current_version_id ?? undefined,
        lifecycleState: row.lifecycle_state,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
        updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
      }));
      
      // Load versions for each template
      const result = await Promise.all(
        templates.map(async (t) => ({
          ...t,
          versions: await store.listModuleVersions(t.templateId),
        }))
      );
      res.json({ modules: result });
    } catch (err) {
      console.error('[catalog] GET /modules error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // GET /modules/:id - get module template with all versions
  router.get('/modules/:id', async (req, res) => {
    try {
      const store = createModuleStore(deps.pool);
      const { id } = req.params;
      
      const template = await store.getModuleTemplateByTemplateId(id);
      if (!template) {
        return res.status(404).json({ error: 'module template not found' });
      }
      
      const versions = await store.listModuleVersions(template.templateId);
      res.json({ module: template, versions });
    } catch (err) {
      console.error('[catalog] GET /modules/:id error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // POST /modules/:id/versions - register a new module version from YAML
  router.post('/modules/:id/versions', async (req, res) => {
    try {
      const { id } = req.params;
      const { version, manifest, interface: iface, configuration_schema, dependencies, testing, provenance } = req.body as {
        version: string;
        manifest: Record<string, unknown>;
        interface?: Record<string, unknown>;
        configuration_schema?: Record<string, unknown>;
        dependencies?: ModuleDependency[];
        testing?: Record<string, unknown>;
        provenance?: Record<string, unknown>;
      };
      
      if (!version || !manifest) {
        return res.status(400).json({ error: 'version and manifest are required' });
      }
      
      const store = createModuleStore(deps.pool);
      let templateId = id;
      
      // Create or get template
      const existingTemplate = await store.getModuleTemplateByTemplateId(id);
      if (!existingTemplate) {
        templateId = await store.createModuleTemplate(id, typeof manifest.name === 'string' ? manifest.name : id);
      }
      
      // Validate dependencies
      for (const dep of dependencies || []) {
        if (!isValidVersionRange(dep.versionRange)) {
          return res.status(400).json({ error: `Invalid version range: ${dep.versionRange}` });
        }
      }
      
      const contentHash = Buffer.from(JSON.stringify({ version, manifest, dependencies }), 'utf8').toString('hex');
      const versionId = await store.createModuleVersion({
        templatePk: templateId,
        version,
        admissionState: 'discovered',
        manifest,
        interface: iface || null,
        configurationSchema: configuration_schema || null,
        dependencies: dependencies || [],
        testing: testing || null,
        provenance: provenance || null,
        contentHash,
        sourceId: undefined,
        commitSha: undefined,
        sourcePath: undefined,
        sourceRef: undefined,
        failureReasons: [],
      });
      
      // Record dependencies
      for (const dep of dependencies || []) {
        await store.recordModuleDependency(versionId, dep.templateId, dep.versionRange);
      }
      
      res.status(201).json({ versionId, state: 'discovered' });
    } catch (err) {
      console.error('[catalog] POST /modules/:id/versions error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // POST /modules/:id/versions/:version/approve - approve a module version
  router.post('/modules/:id/versions/:version/approve', async (req, res) => {
    try {
      const { id, version } = req.params;
      const store = createModuleStore(deps.pool);
      
      const versions = await store.listModuleVersions(id);
      const targetVersion = versions.find(v => v.version === version);
      if (!targetVersion) {
        return res.status(404).json({ error: 'version not found' });
      }
      
      // Resolve dependencies
      const allVersions = await store.listModuleVersions(id);
      const moduleMap = new Map<string, { version: any; dependencies: ModuleDependency[] }>();
      for (const v of allVersions) {
        moduleMap.set(v.templateId, { version: parseVersion(v.version), dependencies: v.dependencies });
      }
      
      let allSatisfied = true;
      const resolvedDeps: Array<{ templateId: string; resolvedVersion?: string }> = [];
      
      for (const dep of targetVersion.dependencies) {
        const depVersions = allVersions.filter(v => v.templateId === dep.templateId);
        if (depVersions.length === 0) {
          allSatisfied = false;
          resolvedDeps.push({ templateId: dep.templateId });
          continue;
        }
        
        const satisfying = depVersions.filter(v => {
          const parsed = parseVersion(v.version);
          return parsed ? compareVersions(parsed, parseVersion(version)!) >= 0 && satisfiesVersion(parsed, dep.versionRange) : false;
        });
        
        if (satisfying.length === 0) {
          allSatisfied = false;
          resolvedDeps.push({ templateId: dep.templateId });
          continue;
        }
        
        const highest = findHighestSatisfyingVersion(
          satisfying.map(v => parseVersion(v.version)!),
          [{ templateId: dep.templateId, versionRange: dep.versionRange }]
        );
        
        if (highest) {
          await store.updateModuleDependencySatisfied(targetVersion.id, dep.templateId, true, highest.major + '.' + highest.minor + '.' + highest.patch);
          resolvedDeps.push({ templateId: dep.templateId, resolvedVersion: highest.major + '.' + highest.minor + '.' + highest.patch });
        } else {
          allSatisfied = false;
        }
      }
      
      // Update admission state
      await store.createModuleVersion({
        ...targetVersion,
        templatePk: targetVersion.id,
        admissionState: 'registered',
        failureReasons: [],
      });
      
      res.json({
        versionId: targetVersion.id,
        state: 'registered',
        dependenciesSatisfied: allSatisfied,
        resolvedDependencies: resolvedDeps,
      });
    } catch (err) {
      console.error('[catalog] POST /modules/:id/versions/:version/approve error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // POST /modules/:id/rollback - rollback to a previous version
  router.post('/modules/:id/rollback', async (req, res) => {
    try {
      const { id } = req.params;
      const { version } = req.body as { version: string };
      const actor = req.body?.actor || 'operator';
      const reason = req.body?.reason;
      
      if (!version) {
        return res.status(400).json({ error: 'version is required' });
      }
      
      const store = createModuleStore(deps.pool);
      const template = await store.getModuleTemplateByTemplateId(id);
      if (!template) {
        return res.status(404).json({ error: 'module template not found' });
      }
      
      const versions = await store.listModuleVersions(id);
      const targetVersion = versions.find(v => v.version === version);
      if (!targetVersion) {
        return res.status(404).json({ error: 'target version not found' });
      }
      
      const currentVersionId = template.currentVersionId;
      if (!currentVersionId) {
        return res.status(400).json({ error: 'no current version to rollback from' });
      }
      
      // Record rollback
      await store.rollbackModuleVersion(
        template.id,
        currentVersionId,
        targetVersion.id,
        actor,
        reason
      );
      
      // Update current version pointer
      await store.updateModuleCurrentVersion(id, targetVersion.id);
      
      res.json({
        success: true,
        fromVersion: versions.find(v => v.id === currentVersionId)?.version,
        toVersion: version,
        actor,
        reason,
      });
    } catch (err) {
      console.error('[catalog] POST /modules/:id/rollback error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // POST /modules/:id/pins - pin a module version
  router.post('/modules/:id/pins', async (req, res) => {
    try {
      const { id } = req.params;
      const { version } = req.body as { version: string };
      const actor = req.body?.actor || 'operator';
      const reason = req.body?.reason;
      
      if (!version) {
        return res.status(400).json({ error: 'version is required' });
      }
      
      const store = createModuleStore(deps.pool);
      const template = await store.getModuleTemplateByTemplateId(id);
      if (!template) {
        return res.status(404).json({ error: 'module template not found' });
      }
      
      const versions = await store.listModuleVersions(id);
      const targetVersion = versions.find(v => v.version === version);
      if (!targetVersion) {
        return res.status(404).json({ error: 'version not found' });
      }
      
      const pinId = await store.pinModuleVersion(targetVersion.id, actor, reason);
      
      res.status(201).json({
        pinId,
        versionId: targetVersion.id,
        version,
        actor,
        reason,
      });
    } catch (err) {
      console.error('[catalog] POST /modules/:id/pins error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // GET /modules/:id/versions/:version/dependencies - check dependency satisfaction
  router.get('/modules/:id/versions/:version/dependencies', async (req, res) => {
    try {
      const { id, version } = req.params;
      const store = createModuleStore(deps.pool);
      
      const versions = await store.listModuleVersions(id);
      const targetVersion = versions.find(v => v.version === version);
      if (!targetVersion) {
        return res.status(404).json({ error: 'version not found' });
      }
      
      // Check dependency satisfaction
      const dependencyStatus = await Promise.all(
        targetVersion.dependencies.map(async (dep) => {
          const depVersions = await store.listModuleVersions(dep.templateId);
          const satisfied = depVersions.some(v => {
            const parsed = parseVersion(v.version);
            return parsed ? satisfiesVersion(parsed, dep.versionRange) : false;
          });
          
          return {
            templateId: dep.templateId,
            requiredVersionRange: dep.versionRange,
            satisfied,
            availableVersions: depVersions.map(v => v.version),
          };
        })
      );
      
      res.json({
        versionId: targetVersion.id,
        version: targetVersion.version,
        dependencies: dependencyStatus,
      });
    } catch (err) {
      console.error('[catalog] GET /modules/:id/versions/:version/dependencies error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}
