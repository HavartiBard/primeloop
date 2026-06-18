// Workspace override: context.fleet-state
//
// This is an example custom implementation of the context.fleet-state module.
// It overrides the built-in module to add custom context enrichment.
//
// To use this override:
// 1. Ensure workspace/modules/context/fleet-state.ts exists
// 2. Restart the backend or trigger workspace sync
// 3. The workspace implementation will be used instead of the built-in

import type { PrimeModule, PrimeLoopState, PrimeModuleDeps, PrimeModuleResult } from '../../../src/prime-agent/modules/types.js';
import { assemblePrimeContext } from '../../../src/prime-agent/context.js';
import type { AgentHarness } from '../../../src/fleet-executor/harness.js';

export const CONTEXT_FLEET_STATE_MODULE: PrimeModule = {
  id: 'context.fleet-state',
  stage: 'context',
  version: '1.0.0-workspace',
  requires_active: true,
  order: 100,
  
  async run(state: PrimeLoopState, deps: PrimeModuleDeps): Promise<PrimeModuleResult> {
    // Call the built-in context assembly
    state.context = await assemblePrimeContext(
      { pool: deps.pool, getHarness: deps.getHarness },
      state.event,
    );

    // CUSTOM ENRICHMENT: Add workspace-specific context
    if (state.context) {
      const dispatchableCount = state.context.runtimeTruth?.dispatchableAgents.length ?? 0;
      
      // Log additional diagnostic info
      console.log(`[context.fleet-state] Workspace enrichment: ${state.context.fleet.agents.length} agents, ${dispatchableCount} dispatchable`);
      
      // Example: Add custom metadata based on workspace configuration
      const workspaceConfig = await loadWorkspaceConfig(deps.pool);
      if (workspaceConfig) {
        state.diagnostics.push(`Workspace config loaded: ${JSON.stringify(workspaceConfig)}`);
      }
    }

    const dispatchableCount = state.context.runtimeTruth?.dispatchableAgents.length ?? 0;
    return { 
      detail: `assembled ${state.context.fleet.agents.length} agents, ${dispatchableCount} dispatchable [WORKSPACE OVERRIDE]` 
    };
  },
};

async function loadWorkspaceConfig(pool: any): Promise<Record<string, unknown> | null> {
  // Example: Load workspace-specific configuration from database
  try {
    const { rows } = await pool.query(
      `SELECT config FROM workspace_config WHERE key = 'context_enrichment' LIMIT 1`
    );
    return rows[0]?.config ?? null;
  } catch (err) {
    // Config table might not exist — that's OK
    return null;
  }
}

// Default export for module loader
export default CONTEXT_FLEET_STATE_MODULE;
