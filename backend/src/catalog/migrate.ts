// Catalog migrator: converts in-code agent definitions to catalog YAML drafts.
//
// Reads DEFAULT_EPHEMERAL_TEMPLATES and DEFAULT_DURABLE_STAFF and emits validated
// YAML template drafts that can be written to backend/catalog/ and synced from there.
// This is a one-time migration path; after seeding, the catalog is the source of truth.
//
// POST /api/catalog/migrate calls migrateToCatalog({ write: true }) to persist the
// YAML files to disk; omitting write returns the drafts for operator review.

import fs from 'node:fs/promises';
import path from 'node:path';
import * as yaml from 'yaml';

import type { EphemeralTemplate } from '../ephemeral-templates.js';
import type { DurableStaffDefinition } from '../durable-staff.js';
import { DEFAULT_EPHEMERAL_TEMPLATES_FOR_MIGRATION } from '../ephemeral-templates.js';
import { DEFAULT_DURABLE_STAFF_FOR_MIGRATION } from '../durable-staff.js';

export interface CatalogDraft {
  templateId: string;
  filename: string;
  yaml: string;
  definition: Record<string, unknown>;
}

export interface MigrateResult {
  drafts: CatalogDraft[];
  written: string[];
  errors: Array<{ templateId: string; error: string }>;
}

/**
 * Convert an EphemeralTemplate to a catalog template definition object.
 */
function ephemeralToCatalogDef(t: EphemeralTemplate): Record<string, unknown> {
  return {
    templateId: t.id,
    name: t.name,
    version: '1.0.0',
    agentType: t.type,
    runtimeFamily: 'local',
    lifecycleIntent: 'ephemeral',
    soul: t.soul,
    personaFile: t.personaFile,
    capabilityProfile: {
      platformPrimitives: t.platformPrimitives,
      capabilityBundles: t.capabilityBundles,
      denyRules: t.denyRules,
    },
    credentialNeeds: [],
    runtimeRequirements: {
      limits: t.resourceLimits,
    },
    approvalPolicy: { autoEligible: false },
    routing: { preferredRole: t.role },
  };
}

/**
 * Convert a DurableStaffDefinition to a catalog template definition object.
 */
function durableToCatalogDef(d: DurableStaffDefinition): Record<string, unknown> {
  return {
    templateId: d.role,
    name: d.name,
    version: '1.0.0',
    agentType: d.type,
    runtimeFamily: 'local',
    lifecycleIntent: 'durable',
    soul: d.soul,
    personaFile: d.personaFile,
    ...(d.systemPrompt ? { systemPrompt: d.systemPrompt } : {}),
    capabilityProfile: {
      platformPrimitives: d.platformPrimitives,
      capabilityBundles: d.capabilityBundles,
      denyRules: d.denyRules,
    },
    credentialNeeds: [],
    runtimeRequirements: { limits: {} },
    approvalPolicy: { autoEligible: false },
    routing: { preferredRole: d.role },
  };
}

/**
 * Generate YAML catalog drafts from in-code ephemeral templates and durable staff.
 *
 * @param write - if true, write the YAML files to `outputDir`
 * @param outputDir - directory to write YAML files into (default: backend/catalog)
 */
export async function migrateToCatalog(options: {
  write?: boolean;
  outputDir?: string;
} = {}): Promise<MigrateResult> {
  const { write = false, outputDir } = options;

  // Resolve catalog directory relative to this file's location (backend/src/catalog/migrate.ts)
  const catalogDir = outputDir ?? path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../catalog',
  );

  const drafts: CatalogDraft[] = [];
  const written: string[] = [];
  const errors: Array<{ templateId: string; error: string }> = [];

  const ephemeralTemplates = DEFAULT_EPHEMERAL_TEMPLATES_FOR_MIGRATION();
  const durableStaff = DEFAULT_DURABLE_STAFF_FOR_MIGRATION();

  for (const t of ephemeralTemplates) {
    try {
      const def = ephemeralToCatalogDef(t);
      const yamlContent = yaml.stringify(def, { lineWidth: 120 });
      drafts.push({ templateId: t.id, filename: `${t.id}.yaml`, yaml: yamlContent, definition: def });
    } catch (err) {
      errors.push({ templateId: t.id, error: String(err) });
    }
  }

  for (const d of durableStaff) {
    try {
      const def = durableToCatalogDef(d);
      const yamlContent = yaml.stringify(def, { lineWidth: 120 });
      drafts.push({ templateId: d.role, filename: `${d.role}.yaml`, yaml: yamlContent, definition: def });
    } catch (err) {
      errors.push({ templateId: d.role, error: String(err) });
    }
  }

  if (write) {
    await fs.mkdir(catalogDir, { recursive: true });
    for (const draft of drafts) {
      const filePath = path.join(catalogDir, draft.filename);
      try {
        await fs.writeFile(filePath, draft.yaml, 'utf-8');
        written.push(filePath);
      } catch (err) {
        errors.push({ templateId: draft.templateId, error: `Write failed: ${err}` });
      }
    }
  }

  return { drafts, written, errors };
}
