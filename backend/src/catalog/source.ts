// Local source reader for Agent Catalog
//
// Reads YAML files from local directory, resolves { file: ... } references
// for systemPrompt/soul/persona into fully-resolved definitions.

import fs from 'fs/promises';
import path from 'path';
import * as yaml from 'yaml';

import type { CatalogTemplate, FailureReason, PrimeModuleTemplate, ModuleDependency } from './types.js';

/**
 * Read a local catalog source directory and parse all YAML files.
 * Returns parsed templates with file references resolved.
 */
export async function readLocalSource(
  sourcePath: string,
  subpath?: string
): Promise<{ templates: CatalogTemplate[]; errors: FailureReason[] }> {
  const templates: CatalogTemplate[] = [];
  const errors: FailureReason[] = [];
  
  const dirPath = subpath ? path.join(sourcePath, subpath) : sourcePath;
  
  try {
    const files = await fs.readdir(dirPath);
    
    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) {
        continue;
      }
      
      const filePath = path.join(dirPath, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      try {
        const parsed = yaml.parse(content);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          // Resolve file references
          const resolved = await resolveFileReferences(parsed as CatalogTemplate, dirPath, file);
          templates.push(resolved);
        } else {
          errors.push({
            code: 'INVALID_FIELD_TYPE',
            field: file,
            detail: 'YAML root must be an object'
          });
        }
      } catch (err) {
        errors.push({
          code: 'INVALID_FIELD_TYPE',
          field: file,
          detail: `YAML parse error: ${(err as Error).message}`
        });
      }
    }
  } catch (err) {
    errors.push({
      code: 'UNKNOWN_CAPABILITY_BUNDLE',
      detail: `Failed to read source directory: ${(err as Error).message}`
    });
  }
  
  return { templates, errors };
}

/**
 * Resolve { file: ... } references for systemPrompt/soul/persona.
 */
async function resolveFileReferences(
  template: CatalogTemplate,
  dirPath: string,
  sourceFile: string
): Promise<CatalogTemplate> {
  const resolved = { ...template };
  
  // Resolve systemPrompt from file if specified
  if (template.systemPromptFile) {
    const filePath = path.resolve(dirPath, template.systemPromptFile);
    try {
      resolved.systemPrompt = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read systemPrompt file ${filePath}: ${(err as Error).message}`);
    }
  } else if (typeof template.systemPrompt === 'string') {
    resolved.systemPrompt = template.systemPrompt;
  } else {
    resolved.systemPrompt = '';
  }
  
  // Resolve soul from file if specified
  if (template.soulFile) {
    const filePath = path.resolve(dirPath, template.soulFile);
    try {
      resolved.soul = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read soul file ${filePath}: ${(err as Error).message}`);
    }
  } else if (typeof template.soul === 'string') {
    resolved.soul = template.soul;
  } else {
    resolved.soul = '';
  }
  
  // Resolve persona from file if specified
  if (template.personaFile) {
    const filePath = path.resolve(dirPath, template.personaFile);
    try {
      resolved.persona = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read persona file ${filePath}: ${(err as Error).message}`);
    }
  } else if (typeof template.persona === 'string') {
    resolved.persona = template.persona;
  } else {
    resolved.persona = '';
  }
  
  return resolved;
}

/**
 * Read a single template file for validation.
 */
export async function readTemplateFile(filePath: string): Promise<{ template: CatalogTemplate; yamlContent: string }> {
  const content = await fs.readFile(filePath, 'utf-8');
  const parsed = yaml.parse(content);
  
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('YAML root must be an object');
  }
  
  const template = parsed as CatalogTemplate;
  
  // Resolve file references
  const resolved = await resolveFileReferences(
    template,
    path.dirname(filePath),
    path.basename(filePath)
  );
  
  return { template: resolved, yamlContent: content };
}

/**
 * Read Prime module templates from a local directory.
 * Supports multiple versions per template ID via versioned YAML files.
 * File naming convention: <templateId>@<version>.yaml (e.g., context.fleet-state@1.0.0.yaml)
 */
export async function readLocalModuleTemplates(
  modulesPath: string
): Promise<{ modules: PrimeModuleTemplate[]; errors: FailureReason[] }> {
  const modules: PrimeModuleTemplate[] = [];
  const errors: FailureReason[] = [];
  
  try {
    const files = await fs.readdir(modulesPath);
    
    for (const file of files) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) {
        continue;
      }
      
      const filePath = path.join(modulesPath, file);
      const content = await fs.readFile(filePath, 'utf-8');
      
      try {
        const parsed = yaml.parse(content);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          // Validate required fields
          const moduleTemplate = parsed as PrimeModuleTemplate;
          if (!moduleTemplate.templateId) {
            errors.push({
              code: 'MISSING_REQUIRED_FIELD',
              field: file,
              detail: 'Missing required field: templateId'
            });
            continue;
          }
          if (!moduleTemplate.version) {
            errors.push({
              code: 'MISSING_REQUIRED_FIELD',
              field: file,
              detail: 'Missing required field: version'
            });
            continue;
          }
          if (!moduleTemplate.manifest?.stage) {
            errors.push({
              code: 'MISSING_REQUIRED_FIELD',
              field: file,
              detail: 'Missing required field: manifest.stage'
            });
            continue;
          }
          
          // Parse dependencies from YAML array
          if (Array.isArray(moduleTemplate.dependencies)) {
            const parsedDeps: ModuleDependency[] = [];
            for (const dep of moduleTemplate.dependencies as unknown[]) {
              if (typeof dep === 'string') {
                const match = dep.match(/^([a-zA-Z0-9._-]+)@(.+)$/);
                if (match && match.length >= 3) {
                  parsedDeps.push({
                    templateId: match[1],
                    versionRange: match[2]
                  });
                }
              }
            }
            moduleTemplate.dependencies = parsedDeps;
          } else {
            moduleTemplate.dependencies = [];
          }
          
          modules.push(moduleTemplate);
        } else {
          errors.push({
            code: 'INVALID_FIELD_TYPE',
            field: file,
            detail: 'YAML root must be an object'
          });
        }
      } catch (err) {
        errors.push({
          code: 'INVALID_FIELD_TYPE',
          field: file,
          detail: `YAML parse error: ${(err as Error).message}`
        });
      }
    }
  } catch (err) {
    errors.push({
      code: 'UNKNOWN_CAPABILITY_BUNDLE',
      detail: `Failed to read modules directory: ${(err as Error).message}`
    });
  }
  
  return { modules, errors };
}

// Git source reader for Agent Catalog
//
// Reads YAML files from Git repository, resolves commit SHAs and file references.

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Git source configuration for remote catalog sources.
 */
export interface GitSourceConfig {
  url: string;
  ref?: string; // branch, tag, or commit SHA
  subpath?: string;
  sshKeyPath?: string;
}

/**
 * Read templates from a Git repository at a specific ref.
 * Returns parsed templates with file references resolved and commit SHA.
 */
export async function readGitSource(
  config: GitSourceConfig
): Promise<{ templates: CatalogTemplate[]; errors: FailureReason[]; commitSha?: string }> {
  const { url, ref = 'main', subpath } = config;
  const templates: CatalogTemplate[] = [];
  const errors: FailureReason[] = [];
  
  // Clone or fetch the repository
  const cloneDir = await createTempClone(url, ref);
  
  try {
    // Get commit SHA
    const { stdout: shaStdout } = await execAsync('git rev-parse HEAD', { cwd: cloneDir });
    const commitSha = shaStdout.trim();
    
    // Read templates from subpath
    const dirPath = subpath ? path.join(cloneDir, subpath) : cloneDir;
    
    try {
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) {
          continue;
        }
        
        const filePath = path.join(dirPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        
        try {
          const parsed = yaml.parse(content);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            // Resolve file references
            const resolved = await resolveFileReferences(
              parsed as CatalogTemplate,
              dirPath,
              file
            );
            templates.push(resolved);
          } else {
            errors.push({
              code: 'INVALID_FIELD_TYPE',
              field: file,
              detail: 'YAML root must be an object'
            });
          }
        } catch (err) {
          errors.push({
            code: 'INVALID_FIELD_TYPE',
            field: file,
            detail: `YAML parse error: ${(err as Error).message}`
          });
        }
      }
    } catch (err) {
      errors.push({
        code: 'UNKNOWN_CAPABILITY_BUNDLE',
        detail: `Failed to read Git source directory: ${(err as Error).message}`
      });
    }
    
    return { templates, errors, commitSha };
  } finally {
    // Clean up temp clone
    await fs.rm(cloneDir, { recursive: true, force: true });
  }
}

/**
 * Create a temporary clone of a Git repository at the specified ref.
 */
async function createTempClone(url: string, ref: string): Promise<string> {
  const tempDir = path.join('/tmp', `catalog-git-${Date.now()}-${Math.random().toString(36).substring(7)}`);
  
  try {
    // Clone the repository
    await execAsync(`git clone --depth 1 --branch ${ref} ${url} ${tempDir}`);
    return tempDir;
  } catch (err) {
    // Try cloning without branch if ref is a commit SHA
    try {
      await execAsync(`git clone --depth 1 ${url} ${tempDir}`);
      await execAsync(`git checkout ${ref}`, { cwd: tempDir });
      return tempDir;
    } catch (checkoutErr) {
      await fs.rm(tempDir, { recursive: true, force: true });
      throw new Error(`Failed to clone Git repository: ${(err as Error).message}`);
    }
  }
}

/**
 * Get the latest commit SHA from a Git repository.
 */
export async function getGitCommitSha(url: string, ref: string = 'main'): Promise<string> {
  const tempDir = path.join('/tmp', `catalog-sha-${Date.now()}-${Math.random().toString(36).substring(7)}`);

  try {
    await execAsync(`git clone --depth 1 --branch ${ref} ${url} ${tempDir}`);
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: tempDir });
    return stdout.trim();
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

// ─── Local-repo Git support ───────────────────────────────────────────────────
// Uses git commands in-place against a repo on the local filesystem.
// Preferred for tests and for catalog sources that point at a local git repo.

/**
 * Resolve a branch/tag ref to an immutable commit SHA in a local git repo.
 * If `ref` is already a 40-char SHA it is returned as-is.
 */
export async function resolveRefToSha(repoPath: string, ref: string): Promise<string> {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref;
  const { stdout } = await execAsync(`git rev-parse "${ref}"`, { cwd: repoPath });
  return stdout.trim();
}

/**
 * Read all YAML templates from a local git repo at a specific commit SHA.
 * Uses `git show <sha>:<path>` so no working-tree modification occurs.
 * Returns parsed+resolved templates plus the concrete SHA used.
 */
export async function readGitSourceLocal(
  repoPath: string,
  ref: string,
  subpath?: string,
): Promise<{ templates: CatalogTemplate[]; errors: FailureReason[]; commitSha: string }> {
  const commitSha = await resolveRefToSha(repoPath, ref);
  const templates: CatalogTemplate[] = [];
  const errors: FailureReason[] = [];

  // List YAML files in the catalog directory at this commit
  const treePath = subpath ? subpath.replace(/\/$/, '') : '.';
  let lsOutput: string;
  try {
    const { stdout } = await execAsync(
      `git ls-tree --name-only "${commitSha}" "${treePath}/"`,
      { cwd: repoPath },
    );
    lsOutput = stdout;
  } catch {
    // Subpath may not exist at this commit — treat as empty
    return { templates, errors, commitSha };
  }

  const files = lsOutput
    .split('\n')
    .map(f => f.trim())
    .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));

  for (const filePath of files) {
    const gitPath = treePath === '.' ? filePath : `${treePath}/${path.basename(filePath)}`;
    let content: string;
    try {
      const { stdout } = await execAsync(
        `git show "${commitSha}:${gitPath}"`,
        { cwd: repoPath },
      );
      content = stdout;
    } catch (err) {
      errors.push({ code: 'INVALID_FIELD_TYPE', field: filePath, detail: `git show failed: ${(err as Error).message}` });
      continue;
    }

    try {
      const parsed = yaml.parse(content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // File references (systemPromptFile etc.) are resolved relative to the
        // commit tree — read them via git show as well
        const resolved = await resolveGitFileReferences(parsed as CatalogTemplate, repoPath, commitSha, treePath);
        templates.push(resolved);
      } else {
        errors.push({ code: 'INVALID_FIELD_TYPE', field: filePath, detail: 'YAML root must be an object' });
      }
    } catch (err) {
      errors.push({ code: 'INVALID_FIELD_TYPE', field: filePath, detail: `YAML parse error: ${(err as Error).message}` });
    }
  }

  return { templates, errors, commitSha };
}

/**
 * Resolve { file: ... } references within a template by reading them from git
 * at the given commit, keeping the operation reproducible and working-tree-free.
 */
async function resolveGitFileReferences(
  template: CatalogTemplate,
  repoPath: string,
  commitSha: string,
  treePath: string,
): Promise<CatalogTemplate> {
  const resolved = { ...template } as any;

  const refs: Array<[string, string]> = [
    ['systemPromptFile', 'systemPrompt'],
    ['soulFile', 'soul'],
    ['personaFile', 'persona'],
  ];

  for (const [fileField, targetField] of refs) {
    const filePath = resolved[fileField];
    if (typeof filePath === 'string' && !resolved[targetField]) {
      const gitPath = filePath.startsWith('./') ? `${treePath}/${filePath.slice(2)}` : filePath;
      try {
        const { stdout } = await execAsync(`git show "${commitSha}:${gitPath}"`, { cwd: repoPath });
        resolved[targetField] = stdout;
      } catch {
        // Leave unresolved — validator will catch if required
      }
    }
  }

  return resolved as CatalogTemplate;
}
