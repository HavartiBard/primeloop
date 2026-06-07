// Registrar - on approval, map a validated version onto a capability profile and
// freeze the registered snapshot.
//
// Responsibilities (registration + version pointers only — NOT instantiation):
//  - registerVersion: create the capability_profiles row (via insertCapabilityProfile,
//    column-correct), link it to the version, set admission_state='registered',
//    point the template's current_version_id at it, and record an admission event.
//  - updateCurrentVersion / deprecateTemplate: thin store passthroughs.
//
// Instantiation lives exclusively in instantiate.ts.

import type { Pool } from 'pg';

import { insertCapabilityProfile, getCapabilityProfileByName } from '../registry.js';
import { createCatalogStore } from './store.js';

export interface Registrar {
  registerVersion(versionId: string): Promise<{ capabilityProfileId: string; templateId: string }>;
  updateCurrentVersion(templateId: string, versionId: string): Promise<void>;
  deprecateTemplate(templateId: string): Promise<void>;
}

/**
 * Create a registrar instance.
 */
export function createRegistrar(pool: Pool): Registrar {
  const store = createCatalogStore(pool);

  return {
    async registerVersion(versionId: string): Promise<{ capabilityProfileId: string; templateId: string }> {
      const version = await store.getVersionById(versionId);
      if (!version) {
        throw new Error(`Version ${versionId} not found`);
      }

      // Once registered the snapshot is frozen — re-registering is a no-op error.
      const isFrozen = await store.isVersionFrozen(versionId);
      if (isFrozen) {
        throw new Error(`Version ${versionId} is already registered`);
      }

      const def = version.resolvedDefinition as Record<string, unknown>;
      const templateId = (def.templateId as string | undefined) ?? versionId;
      const capProfile = (def.capabilityProfile as
        | { platformPrimitives?: string[]; capabilityBundles?: string[]; denyRules?: unknown[] }
        | undefined) ?? {};

      // Map the template declaration onto a capability_profiles row. Profile
      // names are unique; reuse an existing one if a prior version registered it.
      const profileName = `catalog:${templateId}:${version.version}`;
      let profile = await getCapabilityProfileByName(pool, profileName);
      if (!profile) {
        profile = await insertCapabilityProfile(pool, {
          name: profileName,
          description: `Capability profile for catalog template ${templateId}@${version.version}`,
          platform_primitives: capProfile.platformPrimitives ?? [],
          capability_bundles: capProfile.capabilityBundles ?? [],
          deny_rules: (capProfile.denyRules as Array<Record<string, unknown>>) ?? [],
          approval_rules: {},
          config: {},
        });
      }
      const capabilityProfileId = profile.id;

      // Link the profile, freeze the snapshot by moving to 'registered'.
      await pool.query(
        `UPDATE catalog_template_versions
            SET capability_profile_id = $1,
                admission_state = 'registered',
                updated_at = now()
          WHERE id = $2`,
        [capabilityProfileId, versionId],
      );

      // Point the template at this version as current.
      await store.updateTemplateCurrentVersion(templateId, versionId);

      // Audit the transition.
      await store.recordAdmissionEvent({
        versionId,
        fromState: 'pending_approval',
        toState: 'registered',
        actor: 'operator',
        reason: 'Registered: capability profile mapped and snapshot frozen',
        metadata: { capabilityProfileId },
      });

      return { capabilityProfileId, templateId };
    },

    async updateCurrentVersion(templateId: string, versionId: string): Promise<void> {
      await store.updateTemplateCurrentVersion(templateId, versionId);
    },

    async deprecateTemplate(templateId: string): Promise<void> {
      await store.deprecateTemplate(templateId);
    },
  };
}
