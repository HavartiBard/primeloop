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
const DEFAULT_MODULES_PATH = path.join(DEFAULT_CATALOG_PATH, 'modules');

/**
 * Validate catalog source durability at startup.
 * 
 * Checks:
 * 1. If CATALOG_SOURCE_TYPE=git, verify CATALOG_GIT_URL is set and clone repo
 *    - Also syncs workspace/ content from catalog repo to /workspace
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
      
      // Sync workspace/ from catalog repo to /workspace
      const workspaceSyncResult = await syncWorkspaceFromCatalog();
      if (workspaceSyncResult.synced) {
        warnings.push(`Workspace synced from catalog repo (${workspaceSyncResult.filesCount} files)`);
      } else if (workspaceSyncResult.warning) {
        warnings.push(workspaceSyncResult.warning);
      }
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
 * Sync workspace/ content from catalog repo to /workspace.
 * Copies files from DEFAULT_CATALOG_PATH/workspace/ to WORKSPACE_ROOT.
 */
async function syncWorkspaceFromCatalog(): Promise<{
  synced: boolean;
  filesCount?: number;
  warning?: string;
}> {
  const catalogWorkspace = path.join(DEFAULT_CATALOG_PATH, 'workspace');
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? '/workspace';
  
  try {
    await fs.access(catalogWorkspace);
  } catch (err) {
    // No workspace/ in catalog repo — that's OK, use default workspace
    console.log('[catalog] No workspace/ directory in catalog repo, using default');
    return { synced: false, warning: 'No workspace/ in catalog repo' };
  }
  
  try {
    // Ensure workspace root exists
    await fs.mkdir(workspaceRoot, { recursive: true });
    
    // Copy files from catalog/workspace to /workspace
    const files = await listFilesRecursive(catalogWorkspace);
    let copied = 0;
    
    for (const file of files) {
      const srcPath = path.join(catalogWorkspace, file);
      const destPath = path.join(workspaceRoot, file);
      
      try {
        // Check if destination exists and is newer
        const [srcStat, destStat] = await Promise.all([
          fs.stat(srcPath),
          fs.stat(destPath).catch(() => null as any)
        ]);
        
        // Copy if dest doesn't exist or src is newer
        if (!destStat || srcStat.mtime > destStat.mtime) {
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await fs.copyFile(srcPath, destPath);
          copied++;
        }
      } catch (err) {
        console.warn('[catalog] Failed to copy', file, ':', (err as Error).message);
      }
    }
    
    console.log(`[catalog] Workspace synced from catalog (${copied} files updated)`);
    return { synced: true, filesCount: copied };
  } catch (err) {
    console.error('[catalog] Workspace sync failed:', (err as Error).message);
    return { synced: false, warning: `Workspace sync failed: ${(err as Error).message}` };
  }
}

/**
 * Recursively list all files in a directory.
 */
async function listFilesRecursive(dir: string): Promise<string[]> {
  const result: string[] = [];
  
  async function walk(current: string, relativePath: string = '') {
    const entries = await fs.readdir(current, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      
      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (entry.isFile()) {
        result.push(relPath);
      }
    }
  }
  
  await walk(dir);
  return result;
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

/**
 * Discover Prime modules from catalog/modules directory.
 * Returns module IDs and their configuration.
 */
export async function discoverPrimeModulesFromCatalog(): Promise<{
  modules: Array<{
    templateId: string;
    version: string;
    stage: string;
    order: number;
  }>;
  errors: string[];
}> {
  const modules: Array<{
    templateId: string;
    version: string;
    stage: string;
    order: number;
  }> = [];
  const errors: string[] = [];
  
  try {
    await fs.access(DEFAULT_MODULES_PATH);
  } catch (err) {
    console.log('[catalog] No modules/ directory found, using built-in modules');
    return { modules: [], errors: [] };
  }
  
  const { modules: moduleTemplates, errors: parseErrors } = await readLocalModuleTemplates(DEFAULT_MODULES_PATH);
  
  if (parseErrors.length > 0) {
    for (const err of parseErrors) {
      errors.push(`[${err.field}] ${err.detail}`);
    }
  }
  
  for (const mod of moduleTemplates) {
    modules.push({
      templateId: mod.templateId,
      version: mod.version,
      stage: mod.manifest.stage,
      order: mod.manifest.order,
    });
  }
  
  if (modules.length > 0) {
    console.log(`[catalog] Discovered ${modules.length} Prime modules:`);
    for (const mod of modules.sort((a, b) => a.stage.localeCompare(b.stage))) {
      console.log(`  - ${mod.templateId}@${mod.version} (${mod.stage}, order=${mod.order})`);
    }
  } else if (errors.length === 0) {
    console.log('[catalog] No Prime modules found in catalog/modules/');
  }
  
  return { modules, errors };
}

// Re-export for use in startup
import { readLocalModuleTemplates } from './source.js';
