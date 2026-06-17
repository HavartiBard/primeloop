// Workspace Git sync service
//
// Periodically commits and pushes workspace changes to the catalog Git repo.
// This ensures operator-authored skills, prompts, and policies are backed up.
//
// Agent-created files (memory/decisions.md, etc.) are excluded from auto-commit
// via .gitignore patterns.

import fs from 'fs/promises';
import path from 'path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const CATALOG_PATH = process.env.CATALOG_REPO_PATH ?? '/app/backend/catalog';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? '/workspace';
const GIT_TOKEN = process.env.CATALOG_GIT_TOKEN;

/**
 * Sync workspace changes to Git catalog repo.
 * 
 * Flow:
 * 1. Check if catalog/ has a workspace/ subdirectory (Git-backed mode)
 * 2. If yes, sync /workspace → catalog/workspace/
 * 3. Commit and push any changes to Git
 * 4. Skip agent-created files (memory/decisions.md, etc.) via .gitignore
 */
export async function syncWorkspaceToGit(): Promise<{
  success: boolean;
  message: string;
  changes?: {
    added: number;
    modified: number;
    deleted: number;
  };
}> {
  try {
    // Check if catalog has workspace/ subdirectory
    const catalogWorkspace = path.join(CATALOG_PATH, 'workspace');
    
    try {
      await fs.access(catalogWorkspace);
    } catch (err) {
      return {
        success: false,
        message: 'No workspace/ directory in catalog repo — not syncing',
      };
    }
    
    // Check if /workspace has changes compared to catalog/workspace
    const changes = await detectWorkspaceChanges(catalogWorkspace);
    
    if (changes.added === 0 && changes.modified === 0 && changes.deleted === 0) {
      return {
        success: true,
        message: 'No workspace changes to sync',
        changes,
      };
    }
    
    // Copy changed files from /workspace → catalog/workspace
    await copyWorkspaceToCatalog(catalogWorkspace, changes);
    
    // Commit and push
    const commitResult = await commitAndPushCatalog(changes);
    
    return {
      success: commitResult.success,
      message: commitResult.message,
      changes,
    };
  } catch (err) {
    return {
      success: false,
      message: `Sync failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Detect changes in /workspace compared to catalog/workspace.
 */
async function detectWorkspaceChanges(catalogWorkspace: string): Promise<{
  added: number;
  modified: number;
  deleted: number;
}> {
  const changes = { added: 0, modified: 0, deleted: 0 };
  
  try {
    // List files in /workspace (excluding .gitignore patterns)
    const workspaceFiles = await listGitIgnoredFiles(WORKSPACE_ROOT);
    const catalogFiles = await listGitIgnoredFiles(catalogWorkspace);
    
    const workspaceSet = new Set(workspaceFiles);
    const catalogSet = new Set(catalogFiles);
    
    // New files (in /workspace but not in catalog)
    for (const file of workspaceFiles) {
      if (!catalogSet.has(file)) {
        changes.added++;
      }
    }
    
    // Modified files (different mtime or size)
    for (const file of workspaceFiles) {
      if (catalogSet.has(file)) {
        try {
          const [workspaceStat, catalogStat] = await Promise.all([
            fs.stat(path.join(WORKSPACE_ROOT, file)),
            fs.stat(path.join(catalogWorkspace, file)),
          ]);
          
          if (workspaceStat.mtime > catalogStat.mtime || workspaceStat.size !== catalogStat.size) {
            changes.modified++;
          }
        } catch (err) {
          // File access error — skip
        }
      }
    }
    
    // Deleted files (in catalog but not in /workspace) - usually not synced back
    // We don't count deletions since workspace is the source of truth
    
  } catch (err) {
    console.error('[workspace-sync] Failed to detect changes:', (err as Error).message);
  }
  
  return changes;
}

/**
 * List files excluding .gitignore patterns.
 */
async function listGitIgnoredFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  
  // Try git ls-files first (respects .gitignore)
  try {
    const { stdout } = await execFile('git', ['ls-files'], { cwd: dir });
    return stdout.split('\n').filter(Boolean);
  } catch (err) {
    // Not a git repo or git not available — list all files
    return listAllFiles(dir);
  }
}

/**
 * List all files recursively (no .gitignore).
 */
async function listAllFiles(dir: string, relativePath: string = ''): Promise<string[]> {
  const result: string[] = [];
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip .git directories
      if (entry.name === '.git') continue;
      
      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      
      if (entry.isDirectory()) {
        result.push(...await listAllFiles(fullPath, relPath));
      } else if (entry.isFile()) {
        result.push(relPath);
      }
    }
  } catch (err) {
    // Directory access error — skip
  }
  
  return result;
}

/**
 * Copy changed files from /workspace to catalog/workspace.
 */
async function copyWorkspaceToCatalog(
  catalogWorkspace: string,
  changes: { added: number; modified: number; deleted: number }
): Promise<void> {
  // For now, just copy all workspace files to catalog (idempotent)
  // A more sophisticated version would only copy changed files
  
  const workspaceFiles = await listAllFiles(WORKSPACE_ROOT);
  
  for (const file of workspaceFiles) {
    // Skip agent-created runtime files
    if (isAgentRuntimeFile(file)) continue;
    
    const srcPath = path.join(WORKSPACE_ROOT, file);
    const destPath = path.join(catalogWorkspace, file);
    
    try {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);
    } catch (err) {
      console.warn('[workspace-sync] Failed to copy', file, ':', (err as Error).message);
    }
  }
}

/**
 * Check if a file is agent-created runtime data (should not be committed).
 */
function isAgentRuntimeFile(file: string): boolean {
  const runtimePatterns = [
    'memory/decisions.md',
    'memory/preferences.md',
    'config/routing.yaml',
    'config/providers.yaml',
  ];
  
  return runtimePatterns.some(pattern => file.startsWith(pattern));
}

/**
 * Commit and push catalog changes to Git.
 */
async function commitAndPushCatalog(changes: {
  added: number;
  modified: number;
  deleted: number;
}): Promise<{ success: boolean; message: string }> {
  try {
    const totalChanges = changes.added + changes.modified + changes.deleted;
    
    if (totalChanges === 0) {
      return { success: true, message: 'No changes to commit' };
    }
    
    // Configure git user
    await execFile('git', ['config', 'user.email', 'primeloop@system.local'], { cwd: CATALOG_PATH });
    await execFile('git', ['config', 'user.name', 'PrimeLoop Auto-Sync'], { cwd: CATALOG_PATH });
    
    // Add changes
    await execFile('git', ['add', '-A'], { cwd: CATALOG_PATH });
    
    // Check for actual changes
    const { stdout: status } = await execFile('git', ['status', '--porcelain'], { cwd: CATALOG_PATH });
    
    if (!status.trim()) {
      return { success: true, message: 'No staged changes' };
    }
    
    // Commit
    const summary = [
      changes.added > 0 && `${changes.added} added`,
      changes.modified > 0 && `${changes.modified} modified`,
      changes.deleted > 0 && `${changes.deleted} deleted`,
    ].filter(Boolean).join(', ');
    
    await execFile('git', ['commit', '-m', `workspace: sync changes (${summary})`], { cwd: CATALOG_PATH });
    
    // Push with auth token
    const gitUrl = process.env.CATALOG_GIT_URL!;
    const authUrl = GIT_TOKEN ? injectTokenIntoUrl(gitUrl, GIT_TOKEN) : gitUrl;
    
    await execFile('git', ['push', authUrl], { cwd: CATALOG_PATH });
    
    console.log(`[workspace-sync] Committed and pushed ${summary}`);
    return { success: true, message: `Synced ${summary} to Git` };
    
  } catch (err) {
    console.error('[workspace-sync] Commit/push failed:', (err as Error).message);
    return { success: false, message: `Commit/push failed: ${(err as Error).message}` };
  }
}

/**
 * Inject PAT token into HTTPS URL for authentication.
 */
function injectTokenIntoUrl(url: string, token: string): string {
  if (url.startsWith('https://')) {
    return url.replace('https://', `https://${token}@`);
  }
  throw new Error('Git SSH URLs not supported. Use HTTPS with CATALOG_GIT_TOKEN.');
}

/**
 * Start periodic workspace sync scheduler.
 */
export function startWorkspaceSyncScheduler(intervalSeconds: number): void {
  if (intervalSeconds <= 0) {
    console.log('[workspace-sync] Auto-sync disabled (interval=0)');
    return;
  }
  
  console.log(`[workspace-sync] Starting auto-sync every ${intervalSeconds}s`);
  
  // Run immediately first
  void syncWorkspaceToGit();
  
  // Then periodically
  setInterval(() => {
    void syncWorkspaceToGit();
  }, intervalSeconds * 1000);
}
