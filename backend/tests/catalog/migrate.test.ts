// T047: Migration parity test.
//
// Verifies that YAML drafts generated from DEFAULT_EPHEMERAL_TEMPLATES and
// DEFAULT_DURABLE_STAFF contain all fields required by the catalog schema
// and that the resolved definitions match the in-code definitions (SC-009).

import { describe, it, expect } from 'vitest';
import * as yaml from 'yaml';

import { migrateToCatalog } from '../../src/catalog/migrate.js';
import { DEFAULT_EPHEMERAL_TEMPLATES_FOR_MIGRATION } from '../../src/ephemeral-templates.js';
import { DEFAULT_DURABLE_STAFF_FOR_MIGRATION } from '../../src/durable-staff.js';
import { REQUIRED_FIELDS } from '../../src/catalog/schema.js';

describe('Catalog Migration Parity (T047)', () => {
  it('generates one draft per in-code template', async () => {
    const { drafts, errors } = await migrateToCatalog({ write: false });

    expect(errors).toHaveLength(0);

    const ephemeralIds = DEFAULT_EPHEMERAL_TEMPLATES_FOR_MIGRATION().map((t) => t.id);
    const durableIds = DEFAULT_DURABLE_STAFF_FOR_MIGRATION().map((d) => d.role);
    const expectedIds = [...ephemeralIds, ...durableIds];

    const draftIds = drafts.map((d) => d.templateId);
    for (const id of expectedIds) {
      expect(draftIds).toContain(id);
    }
    expect(drafts).toHaveLength(expectedIds.length);
  });

  it('drafts contain all required schema fields', async () => {
    const { drafts } = await migrateToCatalog({ write: false });

    for (const draft of drafts) {
      const parsed = yaml.parse(draft.yaml) as Record<string, unknown>;
      for (const field of REQUIRED_FIELDS) {
        expect(parsed, `${draft.templateId} missing required field '${field}'`).toHaveProperty(field);
      }
    }
  });

  it('ephemeral draft definitions match in-code template fields', async () => {
    const { drafts } = await migrateToCatalog({ write: false });

    const templates = DEFAULT_EPHEMERAL_TEMPLATES_FOR_MIGRATION();
    for (const t of templates) {
      const draft = drafts.find((d) => d.templateId === t.id);
      expect(draft, `No draft for template '${t.id}'`).toBeDefined();

      const def = draft!.definition;
      expect(def.soul).toBe(t.soul);
      expect(def.personaFile).toBe(t.personaFile);
      expect(def.lifecycleIntent).toBe('ephemeral');
      expect((def.capabilityProfile as any).platformPrimitives).toEqual(t.platformPrimitives);
      expect((def.capabilityProfile as any).capabilityBundles).toEqual(t.capabilityBundles);
      expect((def.runtimeRequirements as any).limits).toEqual(t.resourceLimits);
    }
  });

  it('durable staff draft definitions match in-code role fields', async () => {
    const { drafts } = await migrateToCatalog({ write: false });

    const staff = DEFAULT_DURABLE_STAFF_FOR_MIGRATION();
    for (const d of staff) {
      const draft = drafts.find((dr) => dr.templateId === d.role);
      expect(draft, `No draft for role '${d.role}'`).toBeDefined();

      const def = draft!.definition;
      expect(def.soul).toBe(d.soul);
      expect(def.personaFile).toBe(d.personaFile);
      expect(def.lifecycleIntent).toBe('durable');
      expect((def.capabilityProfile as any).platformPrimitives).toEqual(d.platformPrimitives);
      expect((def.capabilityProfile as any).capabilityBundles).toEqual(d.capabilityBundles);
    }
  });

  it('draft YAML parses back to the same definition', async () => {
    const { drafts } = await migrateToCatalog({ write: false });

    for (const draft of drafts) {
      const reparsed = yaml.parse(draft.yaml) as Record<string, unknown>;
      // Key shape fields round-trip correctly
      expect(reparsed.templateId).toBe(draft.definition.templateId);
      expect(reparsed.version).toBe(draft.definition.version);
      expect(reparsed.lifecycleIntent).toBe(draft.definition.lifecycleIntent);
    }
  });
});
