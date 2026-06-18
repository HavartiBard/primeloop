// Workspace module: learning.pattern-detect
//
// Analyzes Prime session patterns to extract lessons and detect failure patterns.
// Identifies recurring issues, successful strategies, and areas for improvement.
//
// Capabilities:
// - Detect recurring error patterns across sessions
// - Identify successful module configurations
// - Extract lessons from completed sessions
// - Suggest improvements based on historical data
//
// Configuration:
//   LEARNING_MIN_SESSIONS_FOR_PATTERN - Minimum sessions before pattern detection (default: 10)
//   LEARNING_PATTERN_WINDOW_DAYS - Lookback window for pattern analysis (default: 7)
//   LEARNING_AUTO_CREATE_LESSON - Automatically create lesson work items (default: false)
//
// To enable:
//   1. Set LEARNING_ENABLED=1 in .env
//   2. Configure optional parameters above
//   3. Restart backend

import type { PrimeModule, PrimeLoopState, PrimeModuleDeps, PrimeModuleResult } from '../../../src/prime-agent/modules/types.js';

interface PatternCache {
  initialized: boolean;
  sessionCount: number;
  errorPatterns: Map<string, number>;
  successPatterns: Map<string, number>;
  lastAnalysis: string | null;
}

const patternCache: PatternCache = {
  initialized: false,
  sessionCount: 0,
  errorPatterns: new Map(),
  successPatterns: new Map(),
  lastAnalysis: null,
};

interface LessonData {
  title: string;
  description: string;
  pattern: string;
  occurrences: number;
  severity: 'low' | 'medium' | 'high';
  suggestedFix?: string;
}

export const LEARNING_PATTERN_DETECT_MODULE: PrimeModule = {
  id: 'learning.pattern-detect',
  stage: 'learning',
  version: '1.0.0-workspace',
  requires_active: false,
  order: 800, // Run before observer stage
  
  async run(state: PrimeLoopState, deps: PrimeModuleDeps): Promise<PrimeModuleResult> {
    // Initialize cache on first run
    if (!patternCache.initialized) {
      await initializePatternCache(deps.pool);
      patternCache.initialized = true;
    }

    const lessons: LessonData[] = [];

    // Analyze session for patterns
    const sessionLessons = analyzeSessionForPatterns(state);
    lessons.push(...sessionLessons);

    // Update pattern cache
    updatePatternCache(state);

    // Check for recurring patterns that need attention
    const criticalPatterns = checkCriticalPatterns();
    
    // Create lessons for critical patterns if configured
    if (process.env.LEARNING_AUTO_CREATE_LESSON === 'true') {
      for (const pattern of criticalPatterns) {
        await createLessonWorkItem(deps.pool, pattern);
      }
    }

    // Add diagnostics
    const diagnostics: string[] = [];
    diagnostics.push(`analyzed ${state.moduleRuns.length} module runs`);
    diagnostics.push(`detected ${lessons.length} lessons`);
    diagnostics.push(`error patterns: ${patternCache.errorPatterns.size}, success patterns: ${patternCache.successPatterns.size}`);

    if (lessons.length > 0) {
      for (const lesson of lessons) {
        state.diagnostics.push(`[learning] ${lesson.title}: ${lesson.description}`);
      }
    }

    return { 
      detail: `detected ${lessons.length} lessons, ${criticalPatterns.length} critical patterns` 
    };
  },
};

/**
 * Initialize pattern cache by loading historical session data.
 */
async function initializePatternCache(pool: any): Promise<void> {
  try {
    // Get recent session count
    const { rows: [countRow] } = await pool.query(
      `SELECT COUNT(*)::int as count FROM prime_agent_sessions 
       WHERE started_at > NOW() - INTERVAL '7 days'`
    );
    patternCache.sessionCount = countRow?.count ?? 0;

    // Load recent error patterns from runtime events
    const { rows: errorRows } = await pool.query(
      `SELECT payload->>'error_signature' as signature, COUNT(*)::int as count
       FROM runtime_events
       WHERE event_type LIKE '%failure%' 
         AND created_at > NOW() - INTERVAL '7 days'
       GROUP BY payload->>'error_signature'
       ORDER BY count DESC
       LIMIT 20`
    );

    for (const row of errorRows) {
      if (row.signature) {
        patternCache.errorPatterns.set(row.signature, row.count);
      }
    }

    console.log(`[learning] Initialized with ${patternCache.sessionCount} recent sessions, ${patternCache.errorPatterns.size} error patterns`);
  } catch (err) {
    console.warn('[learning] Failed to initialize pattern cache:', (err as Error).message);
  }
}

/**
 * Analyze current session for lessons and patterns.
 */
function analyzeSessionForPatterns(state: PrimeLoopState): LessonData[] {
  const lessons: LessonData[] = [];

  // Check for module failures
  const failedModules = state.moduleRuns.filter(m => m.status === 'failed');
  if (failedModules.length > 0) {
    for (const mod of failedModules) {
      lessons.push({
        title: `Module failure: ${mod.id}`,
        description: mod.detail || 'Module execution failed',
        pattern: `module_failure:${mod.id}`,
        occurrences: 1,
        severity: 'high',
        suggestedFix: `Review ${mod.id} configuration and dependencies`,
      });
    }
  }

  // Check for repeated retries (indicates instability)
  const retriedModules = state.moduleRuns.filter(m => 
    m.detail?.includes('retry') || m.detail?.includes('repeated')
  );
  if (retriedModules.length > 0) {
    lessons.push({
      title: 'Module instability detected',
      description: `${retriedModules.length} modules required retries`,
      pattern: 'module_instability',
      occurrences: retriedModules.length,
      severity: 'medium',
      suggestedFix: 'Review module error handling and retry logic',
    });
  }

  // Check for high LLM token usage
  if (state.budget.llmCalls > 5) {
    lessons.push({
      title: 'High LLM call count',
      description: `${state.budget.llmCalls} LLM calls in single session`,
      pattern: 'high_llm_usage',
      occurrences: state.budget.llmCalls,
      severity: 'low',
      suggestedFix: 'Review decision logic for unnecessary LLM calls',
    });
  }

  // Check for no-op actions (indicates potential blocking)
  const noopActions = state.moduleRuns.filter(m => 
    m.detail?.includes('no_op') || m.detail?.includes('blocked')
  );
  if (noopActions.length > 0 && state.moduleRuns.length > 3) {
    lessons.push({
      title: 'Multiple no-op actions',
      description: `${noopActions.length} modules produced no-op results`,
      pattern: 'excessive_noop',
      occurrences: noopActions.length,
      severity: 'medium',
      suggestedFix: 'Review module policies and scope requirements',
    });
  }

  // Check for successful patterns
  if (failedModules.length === 0 && state.budget.actionsDispatched > 0) {
    lessons.push({
      title: 'Successful session',
      description: `Completed with ${state.budget.actionsDispatched} actions, no failures`,
      pattern: 'successful_session',
      occurrences: 1,
      severity: 'low',
    });
  }

  return lessons;
}

/**
 * Update pattern cache with current session data.
 */
function updatePatternCache(state: PrimeLoopState): void {
  // Update error patterns
  for (const mod of state.moduleRuns) {
    if (mod.status === 'failed' && mod.detail) {
      const signature = `module_failure:${mod.id}`;
      patternCache.errorPatterns.set(signature, (patternCache.errorPatterns.get(signature) ?? 0) + 1);
    }
  }

  // Update success patterns
  if (!state.moduleRuns.some(m => m.status === 'failed')) {
    const signature = `successful_session:${state.event.type}`;
    patternCache.successPatterns.set(signature, (patternCache.successPatterns.get(signature) ?? 0) + 1);
  }

  patternCache.sessionCount++;
  patternCache.lastAnalysis = new Date().toISOString();
}

/**
 * Check for critical patterns that exceed thresholds.
 */
function checkCriticalPatterns(): LessonData[] {
  const critical: LessonData[] = [];
  const minOccurrences = 3; // Threshold for recurring patterns

  // Check error patterns
  for (const [pattern, count] of patternCache.errorPatterns.entries()) {
    if (count >= minOccurrences) {
      const [, moduleId] = pattern.split(':');
      critical.push({
        title: `Recurring module failure: ${moduleId}`,
        description: `Failed ${count} times in the last 7 days`,
        pattern,
        occurrences: count,
        severity: 'high',
        suggestedFix: `Investigate and fix ${moduleId} module`,
      });
    }
  }

  return critical;
}

/**
 * Create a lesson work item for critical patterns.
 */
async function createLessonWorkItem(pool: any, lesson: LessonData): Promise<void> {
  try {
    // Check if similar lesson already exists
    const { rows: existing } = await pool.query(
      `SELECT id FROM work_items 
       WHERE metadata->>'lesson_pattern' = $1 
         AND status IN ('active', 'pending')
       LIMIT 1`,
      [lesson.pattern]
    );

    if (existing.length > 0) {
      return; // Lesson already exists
    }

    // Create work item
    await pool.query(
      `INSERT INTO work_items (
         title, description, status, lane, owner_label, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        lesson.title,
        `${lesson.description}\n\n**Pattern**: ${lesson.pattern}\n**Occurrences**: ${lesson.occurrences}\n**Suggested Fix**: ${lesson.suggestedFix || 'TBD'}`,
        'active',
        'learning',
        'Prime',
        JSON.stringify({
          lesson_pattern: lesson.pattern,
          severity: lesson.severity,
          occurrences: lesson.occurrences,
          created_from: 'learning.pattern-detect',
        }),
      ]
    );

    console.log(`[learning] Created lesson work item for pattern: ${lesson.pattern}`);
  } catch (err) {
    console.warn('[learning] Failed to create lesson work item:', (err as Error).message);
  }
}

/**
 * Get pattern analysis summary.
 */
export async function getPatternAnalysis(pool: any): Promise<{
  sessionCount: number;
  errorPatterns: Array<{ pattern: string; count: number }>;
  successPatterns: Array<{ pattern: string; count: number }>;
  recommendations: string[];
}> {
  const errorPatterns = Array.from(patternCache.errorPatterns.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);

  const successPatterns = Array.from(patternCache.successPatterns.entries())
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count);

  const recommendations: string[] = [];

  // Generate recommendations based on patterns
  if (errorPatterns.length > 0 && errorPatterns[0].count >= 5) {
    recommendations.push(`High priority: Fix ${errorPatterns[0].pattern} (${errorPatterns[0].count} occurrences)`);
  }

  if (successPatterns.length === 0 && patternCache.sessionCount > 10) {
    recommendations.push('No successful sessions in recent history - investigate module configuration');
  }

  return {
    sessionCount: patternCache.sessionCount,
    errorPatterns,
    successPatterns,
    recommendations,
  };
}

// Default export for module loader
export default LEARNING_PATTERN_DETECT_MODULE;
