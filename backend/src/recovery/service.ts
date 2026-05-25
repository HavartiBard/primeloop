import type pg from 'pg'
import type {
  CreateRecoveryEventInput,
  RecoveryAction,
  RecoveryEvent,
  RecoveryResultStatus,
  RecoverySeverity,
} from './types.js'

interface RecoverySignal {
  goalId: string
  workItemId?: string
  detectedCondition: string
  severity?: RecoverySeverity
}

function generateId(): string {
  return `re_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function rowToRecoveryEvent(row: Record<string, unknown>): RecoveryEvent {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    workItemId: row.work_item_id ? String(row.work_item_id) : undefined,
    detectedCondition: String(row.detected_condition),
    detectedAt: String(row.detected_at),
    severity: row.severity as RecoverySeverity | undefined,
    selectedAction: row.selected_action as RecoveryAction,
    actionReason: row.action_reason ? String(row.action_reason) : undefined,
    resultStatus: row.result_status as RecoveryResultStatus,
    resultSummary: row.result_summary ? String(row.result_summary) : undefined,
    createdAt: String(row.created_at),
  }
}

export function selectRecoveryAction(signal: RecoverySignal): {
  selectedAction: RecoveryAction
  actionReason: string
  resultStatus: RecoveryResultStatus
  resultSummary: string
} {
  if (signal.severity === 'critical') {
    return {
      selectedAction: 'escalate',
      actionReason: 'Critical severity requires escalation.',
      resultStatus: 'escalated',
      resultSummary: 'Escalated to operator for immediate attention.',
    }
  }
  if (signal.detectedCondition.toLowerCase().includes('approval')) {
    return {
      selectedAction: 'request_approval',
      actionReason: 'Condition indicates approval gate.',
      resultStatus: 'ongoing',
      resultSummary: 'Awaiting operator decision before proceeding.',
    }
  }
  return {
    selectedAction: 'retry',
    actionReason: 'Default first recovery action is retry.',
    resultStatus: 'ongoing',
    resultSummary: 'Retry planned after failed/blocked work item.',
  }
}

export async function createRecoveryEvent(pool: pg.Pool, input: CreateRecoveryEventInput): Promise<RecoveryEvent> {
  const id = generateId()
  const { rows } = await pool.query(
    `INSERT INTO recovery_events (
      id, goal_id, work_item_id, detected_condition, detected_at, severity,
      selected_action, action_reason, result_status, result_summary
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING id, goal_id, work_item_id, detected_condition, detected_at::text, severity,
              selected_action, action_reason, result_status, result_summary, created_at::text`,
    [
      id,
      input.goalId,
      input.workItemId ?? null,
      input.detectedCondition,
      input.detectedAt,
      input.severity ?? null,
      input.selectedAction,
      input.actionReason ?? null,
      input.resultStatus,
      input.resultSummary ?? null,
    ],
  )
  return rowToRecoveryEvent(rows[0])
}

export async function listRecoveryEvents(pool: pg.Pool, goalId: string): Promise<RecoveryEvent[]> {
  const { rows } = await pool.query(
    `SELECT id, goal_id, work_item_id, detected_condition, detected_at::text, severity,
            selected_action, action_reason, result_status, result_summary, created_at::text
     FROM recovery_events
     WHERE goal_id = $1
     ORDER BY created_at DESC`,
    [goalId],
  )
  return rows.map((row) => rowToRecoveryEvent(row as Record<string, unknown>))
}
