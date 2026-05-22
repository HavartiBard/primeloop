import type pg from 'pg'

export interface Approval {
  approval_id: string
  run_id: string
  action: string
  status: 'pending' | 'approved' | 'denied'
  created_at: string
  decided_at?: string
  title?: string
  description?: string
}

export async function listPendingApprovals(pool: pg.Pool): Promise<Approval[]> {
  const { rows } = await pool.query(
    `SELECT a.approval_id, a.run_id, a.action, a.status, a.created_at::text, a.decided_at::text,
            wi.title, wi.description
     FROM approvals a
     LEFT JOIN work_items wi ON wi.id = a.run_id
     WHERE a.status = 'pending'
     ORDER BY a.created_at ASC`
  )
  return rows
}

export async function getApproval(pool: pg.Pool, approvalId: string): Promise<Approval | null> {
  const { rows } = await pool.query(
    `SELECT approval_id, run_id, action, status, created_at::text, decided_at::text
     FROM approvals
     WHERE approval_id = $1`,
    [approvalId]
  )
  return rows[0] ?? null
}

export async function getApprovalForRun(pool: pg.Pool, runId: string): Promise<Approval | null> {
  const { rows } = await pool.query(
    `SELECT approval_id, run_id, action, status, created_at::text, decided_at::text
     FROM approvals
     WHERE run_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [runId]
  )
  return rows[0] ?? null
}

export async function ensurePendingApproval(
  pool: pg.Pool,
  data: { approval_id: string; run_id: string; action: string }
): Promise<Approval> {
  const { rows } = await pool.query(
    `INSERT INTO approvals (approval_id, run_id, action, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (approval_id) DO UPDATE
       SET action = EXCLUDED.action
     RETURNING approval_id, run_id, action, status, created_at::text, decided_at::text`,
    [data.approval_id, data.run_id, data.action]
  )
  return rows[0]
}

export async function decideApproval(
  pool: pg.Pool,
  approvalId: string,
  decision: 'approved' | 'denied'
): Promise<Approval | null> {
  const { rows } = await pool.query(
    `UPDATE approvals
     SET status = $2, decided_at = now()
     WHERE approval_id = $1
     RETURNING approval_id, run_id, action, status, created_at::text, decided_at::text`,
    [approvalId, decision]
  )
  return rows[0] ?? null
}
