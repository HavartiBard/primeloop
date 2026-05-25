import type pg from 'pg'
import type { CreateLearningRecordInput, LearningRecord } from './types.js'

function generateId(): string {
  return `lr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function rowToLearningRecord(row: Record<string, unknown>): LearningRecord {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    workItemId: row.work_item_id ? String(row.work_item_id) : undefined,
    category: row.category as LearningRecord['category'],
    signalType: row.signal_type as LearningRecord['signalType'],
    observation: String(row.observation),
    recommendation: row.recommendation ? String(row.recommendation) : undefined,
    confidence: row.confidence as LearningRecord['confidence'],
    appliesToDomains: (row.applies_to_domains as string[] | null) ?? undefined,
    createdAt: String(row.created_at),
  }
}

export async function createLearningRecord(pool: pg.Pool, input: CreateLearningRecordInput): Promise<LearningRecord> {
  const id = generateId()
  const { rows } = await pool.query(
    `INSERT INTO learning_records (
      id, goal_id, work_item_id, category, signal_type,
      observation, recommendation, confidence, applies_to_domains
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING id, goal_id, work_item_id, category, signal_type,
              observation, recommendation, confidence, applies_to_domains, created_at::text`,
    [
      id,
      input.goalId,
      input.workItemId ?? null,
      input.category,
      input.signalType,
      input.observation,
      input.recommendation ?? null,
      input.confidence ?? null,
      input.appliesToDomains ?? null,
    ],
  )
  return rowToLearningRecord(rows[0])
}

export async function listLearningRecords(pool: pg.Pool, goalId: string): Promise<LearningRecord[]> {
  const { rows } = await pool.query(
    `SELECT id, goal_id, work_item_id, category, signal_type,
            observation, recommendation, confidence, applies_to_domains, created_at::text
     FROM learning_records
     WHERE goal_id = $1
     ORDER BY created_at DESC`,
    [goalId],
  )
  return rows.map((row) => rowToLearningRecord(row as Record<string, unknown>))
}
