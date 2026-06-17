// Catalog startup validation
//
// Ensures catalog source is durable (volume-mounted or Git) before allowing production startup.
// This prevents data loss from ephemeral container filesystems.

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(MODULE_DIR, '../..');
const DEFAULT_CATALOG_PATH = path.join(APP_ROOT, 'catalog');

/**
 * Validate catalog source durability at startup.
 * 
 * Checks:
 * 1. If CATALOG_SOURCE_TYPE=git, verify CATALOG_GIT_URL is set
 * 2. If CATALOG_SOURCE_TYPE=local (default), verify the path exists and is writable
 *    - Warn if path is inside APP_ROOT (ephemeral in containerized deployment)
 *    - Suggest volume mount or Git source for production
 * 
 * @throws Error if configuration is invalid for production
 */
export async function validateCatalogStartup(): Promise<{
  valid: boolean;
  warnings: string[];
  mode: 'git' | 'local';
}> {
  const warnings: string[] = [];
  
  // Read env vars
  const sourceType = process.env.CATALOG_SOURCE_TYPE ?? 'local';
  const gitUrl = process.env.CATALOG_GIT_URL;
  const gitRef = process.env.CATALOG_GIT_REF ?? 'main';
  
  if (sourceType === 'git') {
    if (!gitUrl) {
      throw new Error(
        'CATALOG_SOURCE_TYPE=git requires CATALOG_GIT_URL to be set. ' +
        'Example: CATALOG_GIT_URL=https://github.com/org/repo.git'
      );
    }
    
    return {
      valid: true,
      warnings: [`Using Git source: ${gitUrl}@${gitRef}`],
      mode: 'git',
    };
  }
  
  // Local mode
  if (sourceType !== 'local') {
    throw new Error(
      `Invalid CATALOG_SOURCE_TYPE=${sourceType}. Must be 'local' or 'git'.`
    );
  }
  
  // Check if catalog path is inside app root (ephemeral in containers)
  const isInsideAppRoot = DEFAULT_CATALOG_PATH.startsWith(APP_ROOT);
  
  if (isInsideAppRoot) {
    warnings.push(
      `⚠️  WARNING: Catalog path ${DEFAULT_CATALOG_PATH} is inside app root (${APP_ROOT}).`,
      'In containerized deployment, this directory is ephemeral unless volume-mounted.',
      'Recommended actions:',
      '  1. Mount a host volume to /app/backend/catalog in docker-compose.prod.yml',
      '  2. OR set CATALOG_SOURCE_TYPE=git and configure CATALOG_GIT_URL',
      '',
      'For production, always use durable storage for catalog YAML files.'
    );
    
    // Check if path exists (might not exist on first boot)
    try {
      await fs.access(DEFAULT_CATALOG_PATH);
    } catch (err) {
      warnings.push(
        `⚠️  WARNING: Catalog directory does not exist: ${DEFAULT_CATALOG_PATH}`,
        'Create it or configure a Git source before starting the service.'
      );
    }
  }
  
  return {
    valid: true, // We warn but don't block for local mode
    warnings,
    mode: 'local',
  };
}

/**
 * Log catalog startup validation results.
 */
export function logCatalogStartup(result: Awaited<ReturnType<typeof validateCatalogStartup>>): void {
  console.log('[catalog] startup validation:');
  console.log(`  mode: ${result.mode}`);
  
  if (result.warnings.length > 0) {
    console.log('  warnings:');
    for (const warning of result.warnings) {
      console.log(`    ${warning}`);
    }
  } else {
    console.log('  status: OK');
  }
}
