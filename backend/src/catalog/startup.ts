// Catalog startup validation
//
// Ensures catalog source is durable (volume-mounted or Git) before allowing production startup.
// This prevents data loss from ephemeral container filesystems.
//
// On startup:
// - Git mode: clones/pulls catalog repo to /app/backend/catalog
// - Local mode: warns if path is inside ephemeral container root

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(MODULE_DIR, '../..');
const DEFAULT_CATALOG_PATH = path.join(APP_ROOT, 'catalog');

/**
 * Validate catalog source durability at startup.
 * 
 * Checks:
 * 1. If CATALOG_SOURCE_TYPE=git, verify CATALOG_GIT_URL is set and clone repo
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
  const gitToken = process.env.CATALOG_GIT_TOKEN;
  
  if (sourceType === 'git') {
    if (!gitUrl) {
      throw new Error(
        'CATALOG_SOURCE_TYPE=git requires CATALOG_GIT_URL to be set. ' +
        'Example: CATALOG_GIT_URL=https://github.com/org/repo.git'
      );
    }
    
    // Clone or pull Git catalog repo
    try {
      await cloneOrPullGitCatalog(gitUrl, gitRef, gitToken);
      warnings.push(`Successfully cloned catalog from ${gitUrl}@${gitRef}`);
    } catch (err) {
      throw new Error(
        `Failed to clone catalog repo: ${(err as Error).message}. ` +
        'Verify CATALOG_GIT_URL and CATALOG_GIT_TOKEN are correct.'
      );
    }
    
    return {
      valid: true,
      warnings,
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
 * Clone or pull Git catalog repo to DEFAULT_CATALOG_PATH.
 */
async function cloneOrPullGitCatalog(
  url: string,
  ref: string,
  token?: string
): Promise<void> {
  try {
    await fs.access(DEFAULT_CATALOG_PATH);
    // Directory exists, try to pull
    try {
      const authUrl = token ? injectTokenIntoUrl(url, token) : url;
      await execFile('git', ['pull', authUrl, ref], { cwd: DEFAULT_CATALOG_PATH });
      console.log('[catalog] Git catalog pulled:', ref);
    } catch (err) {
      // Pull failed, might not be a git repo or auth issue
      console.log('[catalog] Git pull failed, re-cloning:', (err as Error).message);
      await fs.rm(DEFAULT_CATALOG_PATH, { recursive: true, force: true });
      await cloneGitCatalog(url, ref, token);
    }
  } catch (err) {
    // Directory doesn't exist, clone fresh
    await cloneGitCatalog(url, ref, token);
  }
}

/**
 * Clone Git catalog repo to DEFAULT_CATALOG_PATH.
 */
async function cloneGitCatalog(
  url: string,
  ref: string,
  token?: string
): Promise<void> {
  const authUrl = token ? injectTokenIntoUrl(url, token) : url;
  
  await fs.mkdir(path.dirname(DEFAULT_CATALOG_PATH), { recursive: true });
  
  await execFile('git', [
    'clone',
    '--branch', ref,
    '--single-branch',
    authUrl,
    DEFAULT_CATALOG_PATH
  ]);
  
  console.log('[catalog] Git catalog cloned:', url, '@', ref);
}

/**
 * Inject PAT token into HTTPS URL for authentication.
 * Transforms: https://github.com/org/repo.git
 *            -> https://TOKEN@github.com/org/repo.git
 */
function injectTokenIntoUrl(url: string, token: string): string {
  if (url.startsWith('https://')) {
    return url.replace('https://', `https://${token}@`);
  }
  // Git SSH URLs require SSH key auth, not token
  throw new Error('Git SSH URLs not supported. Use HTTPS with CATALOG_GIT_TOKEN.');
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
