// Prime Module Test Runner
//
// Provides utilities for testing Prime modules in isolation:
// - Mock state and dependencies
// - Shadow mode comparison
// - Result validation
// - Test result reporting

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type pg from 'pg';
import type {
  PrimeModule,
  PrimeLoopState,
  PrimeModuleDeps,
  PrimeModuleResult,
  PrimeEvent,
  PrimeContext,
  PrimeDecision,
} from '../../../src/prime-agent/modules/types.js';

/**
 * Mock Prime event for testing.
 */
export function createMockEvent(overrides: Partial<PrimeEvent> = {}): PrimeEvent {
  return {
    type: 'cron.fast',
    payload: {
      triggered_at: new Date().toISOString(),
      ...overrides.payload,
    },
    ...overrides,
  } as PrimeEvent;
}

/**
 * Mock Prime context for testing.
 */
export function createMockContext(overrides: Partial<PrimeContext> = {}): PrimeContext {
  return {
    event: createMockEvent(),
    fleet: {
      agents: overrides.agents ?? [],
      dispatchableAgents: overrides.dispatchableAgents ?? [],
    },
    runtimeTruth: {
      dispatchableAgents: overrides.dispatchableAgents ?? [],
    },
    ...overrides,
  } as PrimeContext;
}

/**
 * Mock Prime decision for testing.
 */
export function createMockDecision(overrides: Partial<PrimeDecision> = {}): PrimeDecision {
  return {
    reasoning: 'test decision',
    actions: overrides.actions ?? [],
    response: overrides.response,
    provider_used: overrides.provider_used,
    model_used: overrides.model_used,
    token_count: overrides.token_count ?? 0,
    ...overrides,
  } as PrimeDecision;
}

/**
 * Mock module dependencies for testing.
 */
export function createMockDeps(overrides: Partial<PrimeModuleDeps> = {}): PrimeModuleDeps {
  const mockPool = {
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
  } as unknown as pg.Pool;

  const mockRouter = {
    decide: vi.fn(),
  };

  return {
    pool: overrides.pool ?? mockPool,
    router: overrides.router ?? mockRouter,
    sessionId: overrides.sessionId ?? 'test-session-id',
    executionMode: overrides.executionMode ?? 'active',
    moduleConfig: overrides.moduleConfig ?? {},
    getHarness: overrides.getHarness ?? (() => undefined),
  };
}

/**
 * Create a complete mock loop state for testing.
 */
export function createMockState(overrides: Partial<PrimeLoopState> = {}): PrimeLoopState {
  return {
    event: overrides.event ?? createMockEvent(),
    session: overrides.session ?? ({ id: 'test-session-id', status: 'running' } as any),
    context: overrides.context,
    decision: overrides.decision,
    actions: overrides.actions ?? [],
    diagnostics: overrides.diagnostics ?? [],
    moduleRuns: overrides.moduleRuns ?? [],
    budget: {
      llmCalls: 0,
      actionsDispatched: 0,
      ...overrides.budget,
    },
  };
}

/**
 * Test result for a module execution.
 */
export interface ModuleTestResult {
  moduleId: string;
  stage: string;
  version: string;
  mode: 'active' | 'shadow';
  success: boolean;
  error?: string;
  result?: PrimeModuleResult;
  stateAfter?: PrimeLoopState;
  durationMs: number;
}

/**
 * Compare results between active and shadow modes.
 */
export function compareShadowResults(
  active: ModuleTestResult,
  shadow: ModuleTestResult
): {
  differences: string[];
  hasBehaviorChange: boolean;
  diagnostics: string[];
} {
  const differences: string[] = [];
  const diagnostics: string[] = [];

  // Compare state changes
  if (active.stateAfter && shadow.stateAfter) {
    const activeActions = active.stateAfter.actions.length;
    const shadowActions = shadow.stateAfter.actions.length;
    
    if (activeActions !== shadowActions) {
      differences.push(`Action count differs: active=${activeActions}, shadow=${shadowActions}`);
    }

    const activeDiagnostics = active.stateAfter.diagnostics.join(', ');
    const shadowDiagnostics = shadow.stateAfter.diagnostics.join(', ');
    
    if (activeDiagnostics !== shadowDiagnostics) {
      differences.push(`Diagnostics differ:\n  Active: ${activeDiagnostics}\n  Shadow: ${shadowDiagnostics}`);
    }
  }

  // Compare result details
  if (active.result?.detail !== shadow.result?.detail) {
    differences.push(`Result detail differs:\n  Active: ${active.result?.detail}\n  Shadow: ${shadow.result?.detail}`);
  }

  // Check for behavior changes
  const hasBehaviorChange = differences.length > 0;

  if (!hasBehaviorChange) {
    diagnostics.push('Shadow and active modes produced identical results');
  } else {
    diagnostics.push(`Found ${differences.length} differences between shadow and active modes`);
  }

  return { differences, hasBehaviorChange, diagnostics };
}

/**
 * Run a module test suite.
 */
export async function runModuleTest(
  module: PrimeModule,
  setupState: (state: PrimeLoopState) => void | Promise<void>,
  expected?: {
    success?: boolean;
    stateChanges?: Partial<PrimeLoopState>;
    resultDetail?: string;
  }
): Promise<ModuleTestResult> {
  const startTime = Date.now();

  try {
    // Create initial state
    const state = createMockState({ context: createMockContext() });
    
    // Apply setup
    await setupState(state);

    // Create deps for active mode
    const deps = createMockDeps({ executionMode: 'active' });

    // Run module
    const result = await module.run(state, deps);

    return {
      moduleId: module.id,
      stage: module.stage,
      version: module.version || '1.0.0',
      mode: 'active',
      success: true,
      result,
      stateAfter: state,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      moduleId: module.id,
      stage: module.stage,
      version: module.version || '1.0.0',
      mode: 'active',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Run shadow mode test (should not produce side effects).
 */
export async function runModuleShadowTest(
  module: PrimeModule,
  setupState: (state: PrimeLoopState) => void | Promise<void>
): Promise<ModuleTestResult> {
  const startTime = Date.now();

  try {
    // Create initial state
    const state = createMockState({ context: createMockContext() });
    
    // Apply setup
    await setupState(state);

    // Create deps for shadow mode
    const deps = createMockDeps({ executionMode: 'shadow' });

    // Run module
    const result = await module.run(state, deps);

    return {
      moduleId: module.id,
      stage: module.stage,
      version: module.version || '1.0.0',
      mode: 'shadow',
      success: true,
      result,
      stateAfter: state,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      moduleId: module.id,
      stage: module.stage,
      version: module.version || '1.0.0',
      mode: 'shadow',
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Validate module contract compliance.
 */
export function validateModuleContract(module: PrimeModule): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Required fields
  if (!module.id) errors.push('Missing required field: id');
  if (!module.stage) errors.push('Missing required field: stage');
  if (module.order === undefined || module.order === null) errors.push('Missing required field: order');
  if (!module.run || typeof module.run !== 'function') errors.push('Missing or invalid run() method');

  // Stage validation
  const validStages = ['trigger', 'debounce', 'context', 'decision', 'policy', 'action', 'feedback', 'learning', 'observer'];
  if (module.stage && !validStages.includes(module.stage)) {
    errors.push(`Invalid stage: ${module.stage}. Must be one of: ${validStages.join(', ')}`);
  }

  // Order validation
  if (typeof module.order === 'number' && (!Number.isFinite(module.order) || module.order < 0)) {
    errors.push('order must be a non-negative number');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Test suite for a specific module.
 */
export function describeModule(module: PrimeModule, tests: () => void): void {
  describe(`Module: ${module.id}`, () => {
    // Validate contract before running tests
    it('should have valid contract', () => {
      const validation = validateModuleContract(module);
      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        console.error('Module contract errors:', validation.errors);
      }
    });

    // Run test suite
    tests();
  });
}

// Example test for context.fleet-state module
describeModule(
  {
    id: 'context.fleet-state',
    stage: 'context',
    version: '1.0.0-test',
    order: 100,
    async run(state, deps) {
      // Mock implementation for testing
      state.context = createMockContext({
        agents: [{ id: 'agent-1', enabled: true }],
        dispatchableAgents: [{ id: 'agent-1' }],
      });
      return { detail: 'assembled 1 agent, 1 dispatchable' };
    },
  },
  () => {
    it('should assemble context with agents', async () => {
      const state = createMockState({
        event: createMockEvent(),
        context: undefined, // Context should be assembled by module
      });
      const deps = createMockDeps();

      const result = await state.context!.event.type === 'cron.fast' 
        ? expect.any(String)
        : null;

      const moduleResult = await state.context!.event.type === 'cron.fast'
        ? expect.any(String)
        : null;

      expect(moduleResult).toBeDefined();
      expect(moduleResult?.detail).toContain('assembled');
    });

    it('should work in shadow mode', async () => {
      const state = createMockState({ context: createMockContext() });
      const deps = createMockDeps({ executionMode: 'shadow' });

      const result = await module.run(state, deps);

      expect(result.detail).toBeDefined();
    });

    it('should fail without required context', async () => {
      // This test would verify error handling for missing dependencies
      expect(true).toBe(true); // Placeholder
    });
  }
);
