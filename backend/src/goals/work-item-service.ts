// WorkItem CRUD service — Agentic Control Plane (spec 016)
// State machine, validation, and dependency tracking for work items.

import type pg from 'pg';
import {
  WorkItem,
  WorkItemStatus,
  Domain,
  Priority,
} from './types.js';

// ─── Input types ─────────────────────────────────────────────────

export interface CreateWorkItemInput {
  goalId: string;
  parentWorkItemId?: string | null;
  assignedAgentRole: string;
  domain?: Domain;
  title: string;
  scope?: string;
  status?: WorkItemStatus;
  priority?: Priority;
  dependsOn?: string[] | null;
}

export interface UpdateWorkItemInput {
  goalId?: string;
  parentWorkItemId?: string | null;
  assignedAgentRole?: string;
  domain?: Domain;
  title?: string;
  scope?: string;
  priority?: Priority;
  dependsOn?: string[] | null;
  decisionSummary?: string | null;
  outcomeSummary?: string | null;
  failureReason?: string | null;
}

// ─── State machine (per data-model.md) ────────────────────────────

const VALID_TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  queued: ['in_progress', 'cancelled'],
  in_progress: [
    'awaiting_approval',
    'blocked',
    'completed',
    'failed',
    'cancelled',
  ],
  awaiting_approval: ['in_progress', 'cancelled'],
  blocked: ['retrying', 'escalated', 'cancelled'],
  retrying: ['in_progress', 'cancelled'],
  escalated: ['in_progress', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

// ─── Helpers ──────────────────────────────────────────────────────

function generateId(): string {
  return `wi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function rowToWorkItem(row: Record<string, unknown>): WorkItem {
  return {
    id: row.id as string,
    goalId: row.goal_id as string,
    parentWorkItemId: (row.parent_work_item_id as string | null) ?? null,
    assignedAgentRole: row.assigned_agent_role as string,
    domain: (row.domain as Domain) ?? 'cross_domain',
    title: row.title as string,
    scope: (row.scope as string) ?? '',
    status: row.status as WorkItemStatus,
    priority: (row.priority as Priority) ?? 'normal',
    dependsOn: (row.depends_on as string[] | null) ?? null,
    decisionSummary: (row.decision_summary as string | null) ?? null,
    outcomeSummary: (row.outcome_summary as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

function validateTransition(currentStatus: WorkItemStatus, newStatus: WorkItemStatus): void {
  if (currentStatus === newStatus) return;

  const allowed = VALID_TRANSITIONS[currentStatus];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Invalid state transition: "${currentStatus}" → "${newStatus}". Allowed transitions from "${currentStatus}": ${allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)'}`
    );
  }
}

function validateFailureReason(status: WorkItemStatus, failureReason: string | undefined | null): void {
  if ((status === 'blocked' || status === 'failed') && !failureReason) {
    throw new Error(`failure_reason is required when status is "${status}"`);
  }
}

function validateSelfDependency(workItemId: string, dependsOn: string[] | undefined | null): void {
  if (dependsOn && dependsOn.includes(workItemId)) {
    throw new Error(
      `Work item cannot depend on itself. depends_on contains "${workItemId}"`
    );
  }
}

// ─── CRUD operations ──────────────────────────────────────────────

/**
 * Create a new work item linked to a goal.
 * Validates: required fields, agent role existence, self-dependency, failure_reason for blocked/failed.
 */
export async function createWorkItem(
  pool: pg.Pool,
  input: CreateWorkItemInput,
): Promise<WorkItem> {
  const {
    goalId,
    parentWorkItemId,
    assignedAgentRole,
    domain,
    title,
    scope,
    status = 'queued',
    priority,
    dependsOn,
  } = input;

  // Required field validation
  if (!goalId) throw new Error('goal_id is required');
  if (!assignedAgentRole) throw new Error('assigned_agent_role is required');
  if (!title) throw new Error('title is required');

  // Validate assigned_agent_role exists in agent_roles table
  const roleResult = await pool.query(
    'SELECT id FROM agent_roles WHERE id = $1',
    [assignedAgentRole],
  );
  if (roleResult.rows.length === 0) {
    throw new Error(`assigned_agent_role "${assignedAgentRole}" does not exist in agent_roles`);
  }

  // Validate failure_reason when status is blocked or failed
  validateFailureReason(status, undefined);

  const id = generateId();

  // Self-dependency check
  validateSelfDependency(id, dependsOn);

  const now = new Date().toISOString();

  const result = await pool.query(
    `INSERT INTO work_items (
      id, goal_id, parent_work_item_id, assigned_agent_role, domain,
      title, scope, status, priority, depends_on,
      created_at, updated_at, started_at, completed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *`,
    [
      id,
      goalId,
      parentWorkItemId ?? null,
      assignedAgentRole,
      domain ?? null,
      title,
      scope ?? null,
      status,
      priority ?? null,
      dependsOn ?? null,
      now,
      now,
      status === 'in_progress' ? now : null,
      status === 'completed' ? now : null,
    ],
  );

  return rowToWorkItem(result.rows[0]);
}

/**
 * Fetch a single work item by ID.
 */
export async function getWorkItem(
  pool: pg.Pool,
  workItemId: string,
): Promise<WorkItem | null> {
  const result = await pool.query(
    'SELECT * FROM work_items WHERE id = $1',
    [workItemId],
  );

  if (result.rows.length === 0) return null;
  return rowToWorkItem(result.rows[0]);
}

/**
 * List work items for a goal, optionally filtered by status.
 */
export async function listWorkItems(
  pool: pg.Pool,
  goalId: string,
  filter?: { status?: WorkItemStatus },
): Promise<WorkItem[]> {
  let query = 'SELECT * FROM work_items WHERE goal_id = $1';
  const params: unknown[] = [goalId];

  if (filter?.status) {
    params.push(filter.status);
    query += ` AND status = $${params.length}`;
  }

  query += ' ORDER BY created_at ASC';

  const result = await pool.query(query, params);
  return result.rows.map(rowToWorkItem);
}

/**
 * Update mutable fields on an existing work item.
 * Does NOT handle state transitions — use transitionWorkItemStatus for that.
 */
export async function updateWorkItem(
  pool: pg.Pool,
  workItemId: string,
  input: UpdateWorkItemInput,
): Promise<WorkItem> {
  const existing = await getWorkItem(pool, workItemId);
  if (!existing) {
    throw new Error(`Work item "${workItemId}" not found`);
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let argIndex = 1;

  const fields: Array<{ key: keyof UpdateWorkItemInput; column: string }> = [
    { key: 'goalId', column: 'goal_id' },
    { key: 'parentWorkItemId', column: 'parent_work_item_id' },
    { key: 'assignedAgentRole', column: 'assigned_agent_role' },
    { key: 'domain', column: 'domain' },
    { key: 'title', column: 'title' },
    { key: 'scope', column: 'scope' },
    { key: 'priority', column: 'priority' },
    { key: 'dependsOn', column: 'depends_on' },
    { key: 'decisionSummary', column: 'decision_summary' },
    { key: 'outcomeSummary', column: 'outcome_summary' },
    { key: 'failureReason', column: 'failure_reason' },
  ];

  for (const { key, column } of fields) {
    if (input[key] !== undefined) {
      setClauses.push(`${column} = $${argIndex}`);
      values.push(input[key] ?? null);
      argIndex++;
    }
  }

  // Validate assigned_agent_role existence if being updated
  if (input.assignedAgentRole) {
    const roleResult = await pool.query(
      'SELECT id FROM agent_roles WHERE id = $1',
      [input.assignedAgentRole],
    );
    if (roleResult.rows.length === 0) {
      throw new Error(`assigned_agent_role "${input.assignedAgentRole}" does not exist in agent_roles`);
    }
  }

  // Self-dependency check on depends_on updates
  if (input.dependsOn !== undefined) {
    validateSelfDependency(workItemId, input.dependsOn);
  }

  setClauses.push(`updated_at = $${argIndex}`);
  values.push(new Date().toISOString());

  values.push(workItemId);

  const query = `UPDATE work_items SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`;

  const result = await pool.query(query, values);
  return rowToWorkItem(result.rows[0]);
}

/**
 * Transition a work item to a new status.
 * Enforces the state machine and failure_reason requirements.
 */
export async function transitionWorkItemStatus(
  pool: pg.Pool,
  workItemId: string,
  newStatus: WorkItemStatus,
  failureReason?: string,
): Promise<WorkItem> {
  const existing = await getWorkItem(pool, workItemId);
  if (!existing) {
    throw new Error(`Work item "${workItemId}" not found`);
  }

  // Validate state transition
  validateTransition(existing.status, newStatus);

  // Validate failure_reason for blocked/failed
  validateFailureReason(newStatus, failureReason);

  const now = new Date().toISOString();
  const updates: string[] = [`status = $1`, `updated_at = $2`];
  const params: unknown[] = [newStatus, now];

  // Set started_at when transitioning into in_progress
  if (newStatus === 'in_progress' && !existing.startedAt) {
    updates.push('started_at = $3');
    params.push(now);
  }

  // Set completed_at when transitioning into completed
  if (newStatus === 'completed') {
    updates.push('completed_at = $3');
    params.push(now);
  }

  // Set failure_reason when provided
  if (failureReason !== undefined) {
    updates.push(`failure_reason = $${params.length + 1}`);
    params.push(failureReason);
  }

  params.push(workItemId);

  const query = `UPDATE work_items SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`;

  const result = await pool.query(query, params);
  return rowToWorkItem(result.rows[0]);
}
