// Shadow Mode Comparison Utilities
//
// Compares module execution results between shadow and active modes to detect
// behavior changes before promoting modules from shadow to active.

import type pg from 'pg';
import { cloneDeep } from 'lodash';
import type { PrimeLoopState, PrimeModuleDeps, PrimeModuleResult } from './types.js';

/**
 * Comparison result between shadow and active module execution.
 */
export interface ShadowComparisonResult {
  moduleId: string;
  stage: string;
  version: string;
  comparison: 'identical' | 'differing' | 'error';
  differences: ModuleDifference[];
  riskLevel: 'low' | 'medium' | 'high';
  recommendation: 'promote' | 'review' | 'rollback';
  timestamp: string;
}

/**
 * A specific difference between shadow and active execution.
 */
export interface ModuleDifference {
  field: string;
  shadowValue: unknown;
  activeValue: unknown;
  severity: 'info' | 'warning' | 'error';
  description: string;
}

/**
 * Compare state between shadow and active modes.
 */
export function compareStates(
  shadowState: PrimeLoopState,
  activeState: PrimeLoopState
): ModuleDifference[] {
  const differences: ModuleDifference[] = [];

  // Compare actions (critical - side effects)
  if (shadowState.actions.length !== activeState.actions.length) {
    differences.push({
      field: 'actions.length',
      shadowValue: shadowState.actions.length,
      activeValue: activeState.actions.length,
      severity: 'error',
      description: `Action count differs: shadow=${shadowState.actions.length}, active=${activeState.actions.length}`,
    });
  }

  // Compare action types
  const shadowActionTypes = shadowState.actions.map(a => a.action.type).sort().join(',');
  const activeActionTypes = activeState.actions.map(a => a.action.type).sort().join(',');
  
  if (shadowActionTypes !== activeActionTypes) {
    differences.push({
      field: 'actions.types',
      shadowValue: shadowActionTypes,
      activeValue: activeActionTypes,
      severity: 'error',
      description: `Action types differ:\n  Shadow: ${shadowActionTypes}\n  Active: ${activeActionTypes}`,
    });
  }

  // Compare diagnostics (informational)
  const shadowDiags = shadowState.diagnostics.sort().join('; ');
  const activeDiags = activeState.diagnostics.sort().join('; ');
  
  if (shadowDiags !== activeDiags) {
    differences.push({
      field: 'diagnostics',
      shadowValue: shadowDiags,
      activeValue: activeDiags,
      severity: 'info',
      description: `Diagnostics differ (informational only)`,
    });
  }

  // Compare budget changes
  if (shadowState.budget.llmCalls !== activeState.budget.llmCalls) {
    differences.push({
      field: 'budget.llmCalls',
      shadowValue: shadowState.budget.llmCalls,
      activeValue: activeState.budget.llmCalls,
      severity: 'warning',
      description: `LLM call count differs: shadow=${shadowState.budget.llmCalls}, active=${activeState.budget.llmCalls}`,
    });
  }

  if (shadowState.budget.actionsDispatched !== activeState.budget.actionsDispatched) {
    differences.push({
      field: 'budget.actionsDispatched',
      shadowValue: shadowState.budget.actionsDispatched,
      activeValue: activeState.budget.actionsDispatched,
      severity: 'error',
      description: `Actions dispatched differs: shadow=${shadowState.budget.actionsDispatched}, active=${activeState.budget.actionsDispatched}`,
    });
  }

  return differences;
}

/**
 * Determine risk level based on differences.
 */
export function determineRiskLevel(differences: ModuleDifference[]): 'low' | 'medium' | 'high' {
  const hasError = differences.some(d => d.severity === 'error');
  const hasWarning = differences.some(d => d.severity === 'warning');

  if (hasError) return 'high';
  if (hasWarning) return 'medium';
  return 'low';
}

/**
 * Determine promotion recommendation based on risk level.
 */
export function determineRecommendation(riskLevel: 'low' | 'medium' | 'high'): 'promote' | 'review' | 'rollback' {
  switch (riskLevel) {
    case 'low':
      return 'promote';
    case 'medium':
      return 'review';
    case 'high':
      return 'rollback';
  }
}

/**
 * Run a module in both shadow and active modes and compare results.
 */
export async function runShadowComparison(
  module: {
    id: string;
    stage: string;
    version: string;
    run: (state: PrimeLoopState, deps: PrimeModuleDeps) => Promise<PrimeModuleResult | void>;
  },
  initialState: PrimeLoopState,
  deps: PrimeModuleDeps
): Promise<ShadowComparisonResult> {
  const timestamp = new Date().toISOString();

  try {
    // Clone initial state for shadow run
    const shadowState = cloneDeep(initialState);
    const activeState = cloneDeep(initialState);

    // Run in shadow mode
    const shadowDeps: PrimeModuleDeps = { ...deps, executionMode: 'shadow' };
    await module.run(shadowState, shadowDeps);

    // Run in active mode
    const activeDeps: PrimeModuleDeps = { ...deps, executionMode: 'active' };
    await module.run(activeState, activeDeps);

    // Compare results
    const differences = compareStates(shadowState, activeState);
    const riskLevel = determineRiskLevel(differences);
    const recommendation = determineRecommendation(riskLevel);

    return {
      moduleId: module.id,
      stage: module.stage,
      version: module.version,
      comparison: differences.length === 0 ? 'identical' : 'differing',
      differences,
      riskLevel,
      recommendation,
      timestamp,
    };
  } catch (error) {
    return {
      moduleId: module.id,
      stage: module.stage,
      version: module.version,
      comparison: 'error',
      differences: [{
        field: 'execution',
        shadowValue: 'success',
        activeValue: `error: ${error instanceof Error ? error.message : String(error)}`,
        severity: 'error',
        description: 'Module execution failed',
      }],
      riskLevel: 'high',
      recommendation: 'rollback',
      timestamp,
    };
  }
}

/**
 * Store comparison result in database for audit trail.
 */
export async function storeShadowComparison(
  pool: pg.Pool,
  sessionId: string,
  comparison: ShadowComparisonResult
): Promise<void> {
  await pool.query(
    `INSERT INTO prime_agent_module_shadow_comparisons (
       session_id, module_id, stage, version, comparison, 
       differences, risk_level, recommendation, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      sessionId,
      comparison.moduleId,
      comparison.stage,
      comparison.version,
      comparison.comparison,
      JSON.stringify(comparison.differences),
      comparison.riskLevel,
      comparison.recommendation,
      comparison.timestamp,
    ]
  );
}

/**
 * Get recent shadow comparisons for a module.
 */
export async function getModuleShadowComparisons(
  pool: pg.Pool,
  moduleId: string,
  limit = 10
): Promise<ShadowComparisonResult[]> {
  const { rows } = await pool.query<{
    stage: string;
    version: string;
    comparison: 'identical' | 'differing' | 'error';
    differences: ModuleDifference[];
    risk_level: 'low' | 'medium' | 'high';
    recommendation: 'promote' | 'review' | 'rollback';
    created_at: string;
  }>(
    `SELECT stage, version, comparison, differences, risk_level, recommendation, created_at::text
     FROM prime_agent_module_shadow_comparisons
     WHERE module_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [moduleId, limit]
  );

  return rows.map(row => ({
    moduleId,
    stage: row.stage,
    version: row.version,
    comparison: row.comparison,
    differences: Array.isArray(row.differences) ? row.differences : [],
    riskLevel: row.risk_level,
    recommendation: row.recommendation,
    timestamp: row.created_at,
  }));
}

/**
 * Check if a module is safe to promote from shadow to active.
 */
export async function canPromoteModule(
  pool: pg.Pool,
  moduleId: string,
  requiredComparisons = 5
): Promise<{
  canPromote: boolean;
  reasons: string[];
  lastComparison?: ShadowComparisonResult;
}> {
  const comparisons = await getModuleShadowComparisons(pool, moduleId, requiredComparisons);

  if (comparisons.length < requiredComparisons) {
    return {
      canPromote: false,
      reasons: [`Need at least ${requiredComparisons} shadow comparisons, found ${comparisons.length}`],
    };
  }

  const reasons: string[] = [];
  let hasHighRisk = false;
  let hasErrors = false;

  for (const comp of comparisons) {
    if (comp.riskLevel === 'high') {
      hasHighRisk = true;
      reasons.push(`High risk in comparison at ${comp.timestamp}`);
    }
    if (comp.comparison === 'error') {
      hasErrors = true;
      reasons.push(`Execution error in comparison at ${comp.timestamp}`);
    }
  }

  if (hasErrors) {
    return {
      canPromote: false,
      reasons: ['Module has execution errors in shadow mode'],
      lastComparison: comparisons[0],
    };
  }

  if (hasHighRisk) {
    return {
      canPromote: false,
      reasons: ['Module shows high-risk behavior differences'],
      lastComparison: comparisons[0],
    };
  }

  const allIdentical = comparisons.every(c => c.comparison === 'identical');
  
  if (allIdentical) {
    return {
      canPromote: true,
      reasons: ['All shadow comparisons produced identical results to active mode'],
      lastComparison: comparisons[0],
    };
  }

  // Check if differences are only informational
  const hasOnlyInfoDiffs = comparisons.every(c => 
    c.differences.every(d => d.severity === 'info')
  );

  if (hasOnlyInfoDiffs) {
    return {
      canPromote: true,
      reasons: ['Differences are only informational (no side effects)'],
      lastComparison: comparisons[0],
    };
  }

  return {
    canPromote: false,
    reasons: ['Module shows behavior differences requiring review'],
    lastComparison: comparisons[0],
  };
}
