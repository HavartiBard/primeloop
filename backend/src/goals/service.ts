// Goals CRUD service — Agentic Control Plane (spec 016)
// Implements full Goal lifecycle with state transition enforcement.

import pg from 'pg';
import { Goal, GoalStatus } from './types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface CreateGoalInput {
  title: string;
  intent: string;
  domainSummary?: string;
  priority?: 'low' | 'normal' | 'high';
  requestedBy?: string;
}

export interface UpdateGoalInput {
  title?: string;
  intent?: string;
  priority?: 'low' | 'normal' | 'high';
  domainSummary?: string;
  currentSummary?: string;
  resultSummary?: string | null;
  riskSummary?: string | null;
  requestedBy?: string;
}

// ─── State Machine ──────────────────────────────────────────────
// Valid transitions per data-model.md. "Any active state" includes draft.
const VALID_TRANSITIONS: Record<GoalStatus, GoalStatus[]> = {
  draft: ['queued', 'cancelled'],
  queued: ['in_progress', 'cancelled'],
  in_progress: ['awaiting_approval', 'blocked', 'completed', 'failed', 'cancelled'],
  awaiting_approval: ['in_progress', 'cancelled'],
  blocked: ['in_progress', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

// ─── Helpers ────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function rowToGoal(row: Record<string, unknown>): Goal {
  return {
    id: String(row.id),
    title: String(row.title),
    intent: String(row.intent),
    domainSummary: row.domain_summary ? String(row.domain_summary) : '',
    status: row.status as GoalStatus,
    priority: (row.priority as 'low' | 'normal' | 'high') || 'normal',
    requestedBy: row.requested_by ? String(row.requested_by) : '',
    ownedByAgentRole: String(row.owned_by_agent_role),
    currentSummary: row.current_summary ? String(row.current_summary) : '',
    resultSummary: row.result_summary ? String(row.result_summary) : null,
    riskSummary: row.risk_summary ? String(row.risk_summary) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.completed_at ? String(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? String(row.cancelled_at) : null,
  };
}

async function getGoalRaw(pool: pg.Pool, goalId: string): Promise<Goal | null> {
  const { rows } = await pool.query(
    'SELECT * FROM goals WHERE id = $1',
    [goalId],
  );
  return rows.length > 0 ? rowToGoal(rows[0]) : null;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Create a new goal.
 * - title and intent are required.
 * - Defaults: status='draft', owned_by_agent_role='prime', priority='normal'.
 */
export async function createGoal(
  pool: pg.Pool,
  input: CreateGoalInput,
): Promise<Goal> {
  if (!input.title || !input.title.trim()) {
    throw new Error('title is required');
  }
  if (!input.intent || !input.intent.trim()) {
    throw new Error('intent is required');
  }

  const id = generateId('goal');
  const { rows } = await pool.query(
    `INSERT INTO goals (
      id, title, intent, domain_summary, priority, requested_by,
      owned_by_agent_role, status, current_summary
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', '')
    RETURNING *`,
    [
      id,
      input.title.trim(),
      input.intent.trim(),
      input.domainSummary || null,
      input.priority || 'normal',
      input.requestedBy || null,
      'prime',
    ],
  );
  return rowToGoal(rows[0]);
}

/**
 * Fetch a single goal by id. Returns null if not found.
 */
export async function getGoal(
  pool: pg.Pool,
  goalId: string,
): Promise<Goal | null> {
  return getGoalRaw(pool, goalId);
}

/**
 * List goals, optionally filtered by status. Ordered by created_at DESC.
 */
export async function listGoals(
  pool: pg.Pool,
  filter?: { status?: GoalStatus },
): Promise<Goal[]> {
  if (filter?.status) {
    const { rows } = await pool.query(
      'SELECT * FROM goals WHERE status = $1 ORDER BY created_at DESC',
      [filter.status],
    );
    return rows.map(rowToGoal);
  }
  const { rows } = await pool.query(
    'SELECT * FROM goals ORDER BY created_at DESC',
  );
  return rows.map(rowToGoal);
}

/**
 * Update mutable goal fields. Only provided fields are changed.
 */
export async function updateGoal(
  pool: pg.Pool,
  goalId: string,
  input: UpdateGoalInput,
): Promise<Goal> {
  const existing = await getGoalRaw(pool, goalId);
  if (!existing) {
    throw new Error(`Goal not found: ${goalId}`);
  }

  const fieldMap: Array<{ key: keyof UpdateGoalInput; column: string }> = [
    { key: 'title', column: 'title' },
    { key: 'intent', column: 'intent' },
    { key: 'priority', column: 'priority' },
    { key: 'domainSummary', column: 'domain_summary' },
    { key: 'currentSummary', column: 'current_summary' },
    { key: 'resultSummary', column: 'result_summary' },
    { key: 'riskSummary', column: 'risk_summary' },
    { key: 'requestedBy', column: 'requested_by' },
  ];

  const columns: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const { key, column } of fieldMap) {
    if (key in input && input[key] !== undefined) {
      columns.push(`${column} = $${paramIndex}`);
      values.push(input[key]);
      paramIndex++;
    }
  }

  if (columns.length === 0) {
    return existing;
  }

  columns.push('updated_at = now()');
  values.push(goalId);

  const { rows } = await pool.query(
    `UPDATE goals SET ${columns.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  return rowToGoal(rows[0]);
}

/**
 * Cancel a goal. Validates the transition to 'cancelled' state.
 */
export async function cancelGoal(
  pool: pg.Pool,
  goalId: string,
): Promise<Goal> {
  return transitionGoalStatus(pool, goalId, 'cancelled');
}

/**
 * Transition a goal to a new status, enforcing the state machine.
 * Sets started_at / completed_at / cancelled_at timestamps as appropriate.
 * Throws if the goal is not found or the transition is invalid.
 */
export async function transitionGoalStatus(
  pool: pg.Pool,
  goalId: string,
  newStatus: GoalStatus,
): Promise<Goal> {
  const goal = await getGoalRaw(pool, goalId);
  if (!goal) {
    throw new Error(`Goal not found: ${goalId}`);
  }

  const currentStatus = goal.status;
  if (currentStatus === newStatus) {
    return goal;
  }

  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid state transition: '${currentStatus}' → '${newStatus}'. Allowed from '${currentStatus}': ${allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)'}`,
    );
  }

  const setClauses: string[] = ['status = $1', 'updated_at = now()'];
  const values: unknown[] = [newStatus];
  let paramIndex = 2;

  // Set started_at on first transition into in_progress (from draft or queued)
  if (newStatus === 'in_progress' && !goal.startedAt) {
    setClauses.push('started_at = now()');
  }

  // Set completed_at when transitioning to completed
  if (newStatus === 'completed') {
    setClauses.push('completed_at = now()');
  }

  // Set cancelled_at when transitioning to cancelled
  if (newStatus === 'cancelled') {
    setClauses.push('cancelled_at = now()');
  }

  values.push(goalId);
  paramIndex++;

  const { rows } = await pool.query(
    `UPDATE goals SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  return rowToGoal(rows[0]);
}
