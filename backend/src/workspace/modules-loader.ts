// Workspace module loader
//
// Scans /workspace/modules/ for Prime module implementations and dynamically loads them.
// Workspace modules can override built-in modules by matching template_id.
//
// Directory structure:
//   workspace/modules/
//   ├── context/
//   │   └── fleet-state.ts      # Module implementation
//   ├── policy/
//   │   └── scope-required.ts
//   └── observer/
//       └── trace.ts

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

import type { PrimeModule, PrimeModuleStage, PrimeLoopState, PrimeModuleDeps, PrimeModuleResult } from '../prime-agent/modules/types.js';

/**
 * Workspace module loader result.
 */
export interface WorkspaceModuleLoadResult {
  modules: PrimeModule[];
  errors: string[];
  overridden: string[];
}

/**
 * Load Prime module implementations from workspace/modules/.
 * 
 * Scans for .ts and .js files in subdirectories matching stage names.
 * Expects each file to export a default PrimeModule or an object with
 * module: PrimeModule.
 */
export async function loadWorkspaceModules(
  workspacePath: string
): Promise<WorkspaceModuleLoadResult> {
  const modules: PrimeModule[] = [];
  const errors: string[] = [];
  const overridden: string[] = [];

  const modulesDir = path.join(workspacePath, 'modules');

  try {
    await fs.access(modulesDir);
  } catch (err) {
    // No workspace/modules directory — that's OK, use built-in modules
    return { modules: [], errors: [], overridden: [] };
  }

  const stages = ['trigger', 'debounce', 'context', 'decision', 'policy', 'action', 'feedback', 'learning', 'observer'];

  for (const stage of stages) {
    const stageDir = path.join(modulesDir, stage);

    try {
      await fs.access(stageDir);
    } catch (err) {
      // Stage directory doesn't exist — skip
      continue;
    }

    const files = await fs.readdir(stageDir);

    for (const file of files) {
      if (!file.endsWith('.ts') && !file.endsWith('.js')) {
        continue;
      }

      const filePath = path.join(stageDir, file);
      const moduleId = `${stage}.${path.basename(file, path.extname(file))}`;

      try {
        const moduleImpl = await loadModuleImplementation(filePath, stage);
        
        if (moduleImpl) {
          // Validate required fields
          if (!moduleImpl.id) {
            errors.push(`[${moduleId}] Missing required field: id`);
            continue;
          }
          if (!moduleImpl.order) {
            errors.push(`[${moduleId}] Missing required field: order`);
            continue;
          }

          modules.push(moduleImpl);
          
          // Track if this overrides a built-in module
          if (isBuiltInModuleId(moduleImpl.id)) {
            overridden.push(moduleImpl.id);
          }
        }
      } catch (err) {
        errors.push(`[${moduleId}] Failed to load: ${(err as Error).message}`);
      }
    }
  }

  if (modules.length > 0) {
    console.log(`[workspace] Loaded ${modules.length} workspace modules:`);
    for (const mod of modules.sort((a, b) => a.order - b.order)) {
      const override = overridden.includes(mod.id) ? ' (OVERRIDE)' : '';
      console.log(`  - ${mod.id}@${mod.version || '1.0.0'} (${mod.stage}, order=${mod.order})${override}`);
    }
  }

  return { modules, errors, overridden };
}

/**
 * Load a single module implementation from a file path.
 */
async function loadModuleImplementation(
  filePath: string,
  expectedStage: PrimeModuleStage
): Promise<PrimeModule | null> {
  try {
    // For TypeScript files in development, we need to compile them first
    // In production, these would be pre-compiled .js files
    let moduleExports: any;

    if (filePath.endsWith('.ts')) {
      // Try to use ts-node or esbuild for runtime compilation
      // This is a fallback for development — production should use compiled JS
      try {
        await import('ts-node/register');
        moduleExports = await import(filePath);
      } catch (err) {
        // ts-node not available, try direct import (might work with native TS support)
        moduleExports = await import(filePath + '?t=' + Date.now());
      }
    } else {
      // JavaScript file — use cache-busting for hot-reload during development
      moduleExports = await import(filePath + '?t=' + Date.now());
    }

    // Extract module from export (support both default and named exports)
    const impl = moduleExports.default || moduleExports.module;

    if (!impl) {
      throw new Error('Module file must export a default PrimeModule or { module: PrimeModule }');
    }

    // Validate stage matches directory name
    if (impl.stage !== expectedStage) {
      console.warn(`[workspace] Module ${impl.id} has stage ${impl.stage}, expected ${expectedStage}`);
    }

    return impl as PrimeModule;
  } catch (err) {
    throw new Error(`Failed to import module: ${(err as Error).message}`);
  }
}

/**
 * Check if a module ID matches one of the built-in modules.
 */
function isBuiltInModuleId(moduleId: string): boolean {
  const builtInIds = [
    'trigger.event-ingress',
    'debounce.pass-through',
    'context.fleet-state',
    'decision.llm-router',
    'policy.scope-required',
    'action.dispatch',
    'feedback.approval-continuation',
  ];
  return builtInIds.includes(moduleId);
}

/**
 * Merge workspace modules with built-in modules.
 * Workspace modules override built-in modules by template_id.
 */
export function mergeWorkspaceModules(
  builtInModules: PrimeModule[],
  workspaceModules: PrimeModule[]
): PrimeModule[] {
  const workspaceById = new Map(workspaceModules.map(m => [m.id, m]));

  const merged = builtInModules.map(builtIn => {
    const workspaceOverride = workspaceById.get(builtIn.id);
    if (workspaceOverride) {
      return workspaceOverride;
    }
    return builtIn;
  });

  // Add any workspace modules that don't override built-ins (new custom modules)
  for (const workspaceMod of workspaceModules) {
    if (!builtInModules.some(b => b.id === workspaceMod.id)) {
      merged.push(workspaceMod);
    }
  }

  return merged.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.stage !== b.stage) return a.stage.localeCompare(b.stage);
    return a.id.localeCompare(b.id);
  });
}

/**
 * Invalidate module cache for hot-reload support.
 * This should be called when workspace modules change.
 */
export function invalidateModuleCache(): void {
  // Clear Node.js require cache for module files
  const modulePattern = /\/workspace\/modules\/.*\.(ts|js)$/;
  Object.keys(require.cache).forEach(key => {
    if (modulePattern.test(key)) {
      delete require.cache[key];
    }
  });
}
