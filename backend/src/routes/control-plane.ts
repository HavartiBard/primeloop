import { Router } from 'express'
import type pg from 'pg'
import { createGoal, getGoal, listGoals, updateGoal, cancelGoal, transitionGoalStatus } from '../goals/service.js'
import { listWorkItems } from '../goals/work-item-service.js'
import type { GoalDetail, CreateGoalRequest, UpdateGoalRequest, Approval } from '../goals/types.js'
import type { PrimeQueue } from '../prime-agent/queue.js'
import { broadcastEvent } from '../ws/control-plane-events.js'
import { decideApproval } from '../approvals.js'
import { listRecoveryEvents } from '../recovery/service.js'
import { listLearningRecords } from '../learning/service.js'

export function createControlPlaneRouter({
  pool,
  primeQueue,
}: {
  pool: pg.Pool
  primeQueue?: PrimeQueue
}) {
  const router = Router()

  // GET /api/control-plane/goals — list all goals
  router.get('/goals', async (_req, res) => {
    try {
      const goals = await listGoals(pool)
      res.json(goals)
    } catch (err) {
      res.status(500).json({ error: 'internal error' })
    }
  })

  // POST /api/control-plane/goals — create a new goal
  router.post('/goals', async (req, res) => {
    const body = req.body as CreateGoalRequest | undefined
    if (!body?.title || !body.title.trim()) {
      return res.status(400).json({ error: 'title is required' })
    }
    if (!body?.intent || !body.intent.trim()) {
      return res.status(400).json({ error: 'intent is required' })
    }
    try {
      const goal = await createGoal(pool, {
        title: body.title,
        intent: body.intent,
        priority: body.priority,
      }).catch((e: unknown) => { console.error('[goals] step=createGoal', e); throw e })

      // Create goal-room thread in the same logical transaction
      const threadResult = await pool.query<{ id: string }>(
        `INSERT INTO threads (title, status, metadata)
         VALUES ($1, 'active', jsonb_build_object('kind', 'goal-room', 'goal_id', $2::text))
         RETURNING id`,
        [goal.title, goal.id],
      ).catch((e: unknown) => { console.error('[goals] step=thread-insert', e); throw e })
      const threadId = threadResult.rows[0]?.id ?? null

      if (threadId) {
        await pool.query(
          `INSERT INTO thread_messages (thread_id, role, sender, content, metadata)
           VALUES ($1, 'system', 'system', $2, '{}')`,
          [threadId, `Goal created: ${goal.title}`],
        ).catch((e: unknown) => { console.error('[goals] step=thread-message', e); throw e })
      }

      const queued = await transitionGoalStatus(pool, goal.id, 'queued')
        .catch((e: unknown) => { console.error('[goals] step=transition-queued', e); throw e })

      // Enqueue for Prime asynchronously — do not let queue errors fail the response
      if (primeQueue) {
        primeQueue.enqueue({
          type: 'goal.created',
          payload: {
            goal_id: goal.id,
            title: goal.title,
            intent: goal.intent,
            thread_id: threadId,
          },
        }).catch((err: unknown) => {
          console.error('[goals] prime queue enqueue failed:', err)
        })
      }

      // Broadcast goal.created WebSocket event
      broadcastEvent({
        type: 'goal.created',
        occurredAt: new Date().toISOString(),
        goalId: goal.id,
        payload: {
          id: goal.id,
          title: goal.title,
          status: queued.status,
          priority: goal.priority,
          thread_id: threadId,
        },
      })

      res.status(201).json({ ...queued, thread_id: threadId })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'internal error'
      return res.status(400).json({ error: message })
    }
  })

  // GET /api/control-plane/goals/:goalId — get goal detail with work items
  router.get('/goals/:goalId', async (req, res) => {
    try {
      const goal = await getGoal(pool, req.params.goalId)
      if (!goal) {
        return res.status(404).json({ error: `Goal not found: ${req.params.goalId}` })
      }
      const [workItems, approvals, recoveryEvents] = await Promise.all([
        listWorkItems(pool, goal.id),
        listGoalApprovals(pool, goal.id),
        listRecoveryEvents(pool, goal.id),
      ])
      const detail: GoalDetail = {
        id: goal.id,
        title: goal.title,
        status: goal.status,
        priority: goal.priority,
        currentSummary: goal.currentSummary,
        updatedAt: goal.updatedAt,
        intent: goal.intent,
        resultSummary: goal.resultSummary,
        riskSummary: goal.riskSummary,
        workItems,
        approvals,
        recoveryEvents: recoveryEvents as GoalDetail['recoveryEvents'],
      }
      res.json(detail)
    } catch (err) {
      res.status(500).json({ error: 'internal error' })
    }
  })

  // PATCH /api/control-plane/goals/:goalId — update a goal
  router.patch('/goals/:goalId', async (req, res) => {
    try {
      const body = req.body as UpdateGoalRequest | undefined
      const goal = await updateGoal(pool, req.params.goalId, body ?? {})
      res.json(goal)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'internal error'
      if (message.startsWith('Goal not found')) {
        return res.status(404).json({ error: message })
      }
      res.status(500).json({ error: message })
    }
  })

  // POST /api/control-plane/goals/:goalId/cancel — cancel a goal
  router.post('/goals/:goalId/cancel', async (req, res) => {
    try {
      const goal = await cancelGoal(pool, req.params.goalId)
      res.json(goal)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'internal error'
      if (message.startsWith('Goal not found')) {
        return res.status(404).json({ error: message })
      }
      res.status(400).json({ error: message })
    }
  })

  // GET /api/control-plane/goals/:goalId/work-items — list work items for a goal
  router.get('/goals/:goalId/work-items', async (req, res) => {
    try {
      const workItems = await listWorkItems(pool, req.params.goalId)
      res.json(workItems)
    } catch (err) {
      res.status(500).json({ error: 'internal error' })
    }
  })

  // GET /api/control-plane/goals/:goalId/approvals — list approvals for a goal
  router.get('/goals/:goalId/approvals', async (req, res) => {
    try {
      const approvals = await listGoalApprovals(pool, req.params.goalId)
      res.json({ approvals })
    } catch (_err) {
      res.status(500).json({ error: 'internal error' })
    }
  })

  // GET /api/control-plane/goals/:goalId/learning-records — list learning records for a goal
  router.get('/goals/:goalId/learning-records', async (req, res) => {
    try {
      const learningRecords = await listLearningRecords(pool, req.params.goalId)
      res.json({ learningRecords })
    } catch (_err) {
      res.status(500).json({ error: 'internal error' })
    }
  })

  // POST /api/control-plane/approvals/:approvalId/decision — resolve approval
  router.post('/approvals/:approvalId/decision', async (req, res) => {
    const decision = req.body?.decision
    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ error: 'decision must be approved or rejected' })
    }

    try {
      const record = await resolveApproval(pool, req.params.approvalId, decision)
      if (!record) {
        return res.status(404).json({ error: `Approval not found: ${req.params.approvalId}` })
      }
      broadcastEvent({
        type: 'approval.resolved',
        occurredAt: new Date().toISOString(),
        goalId: typeof record.goalId === 'string' ? record.goalId : undefined,
        payload: record,
      })
      res.json(record)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'internal error'
      res.status(500).json({ error: message })
    }
  })

  return router
}

async function hasAcpApprovalsTable(pool: pg.Pool): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'approvals' AND column_name = 'goal_id'
    ) AS exists`
  )
  return rows[0]?.exists === true
}

async function listGoalApprovals(pool: pg.Pool, goalId: string): Promise<Approval[]> {
  if (await hasAcpApprovalsTable(pool)) {
    const { rows } = await pool.query(
      `SELECT id, goal_id, work_item_id, requested_by_agent_role, action_summary,
              risk_summary, status, decision_notes, expires_at::text, resolved_at::text, created_at::text
       FROM approvals
       WHERE goal_id = $1
       ORDER BY created_at DESC`,
      [goalId],
    )
    return rows.map((row) => ({
      id: row.id,
      goalId: row.goal_id,
      workItemId: row.work_item_id,
      requestedByAgentRole: row.requested_by_agent_role,
      actionSummary: row.action_summary,
      riskSummary: row.risk_summary,
      status: row.status,
      decisionNotes: row.decision_notes,
      expiresAt: row.expires_at ?? '',
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
    }))
  }

  const { rows } = await pool.query(
    `SELECT a.approval_id, a.run_id, a.action, a.status, a.decided_at::text, a.created_at::text, wi.goal_id
     FROM approvals a
     LEFT JOIN work_items wi ON wi.id = a.run_id
     WHERE wi.goal_id = $1
     ORDER BY a.created_at DESC`,
    [goalId],
  )
  return rows.map((row) => ({
    id: row.approval_id,
    goalId: row.goal_id,
    workItemId: row.run_id,
    requestedByAgentRole: 'prime',
    actionSummary: row.action,
    riskSummary: null,
    status: row.status === 'denied' ? 'rejected' : row.status,
    decisionNotes: null,
    expiresAt: '',
    resolvedAt: row.decided_at,
    createdAt: row.created_at,
  }))
}

async function resolveApproval(
  pool: pg.Pool,
  approvalId: string,
  decision: 'approved' | 'rejected',
): Promise<Record<string, unknown> | null> {
  if (await hasAcpApprovalsTable(pool)) {
    const { rows } = await pool.query(
      `UPDATE approvals
       SET status = $2, resolved_at = now(), decision_notes = COALESCE(decision_notes, '')
       WHERE id = $1
       RETURNING id, goal_id, work_item_id, requested_by_agent_role, action_summary,
                 risk_summary, status, decision_notes, expires_at::text, resolved_at::text`,
      [approvalId, decision],
    )
    const row = rows[0]
    if (!row) return null

    if (row.goal_id) {
      await transitionGoalStatus(pool, row.goal_id, decision === 'approved' ? 'in_progress' : 'blocked').catch(() => undefined)
    }

    return {
      id: row.id,
      goalId: row.goal_id,
      workItemId: row.work_item_id,
      requestedByAgentRole: row.requested_by_agent_role,
      actionSummary: row.action_summary,
      riskSummary: row.risk_summary,
      status: row.status,
      decisionNotes: row.decision_notes,
      expiresAt: row.expires_at ?? '',
      resolvedAt: row.resolved_at,
    }
  }

  const legacy = await decideApproval(pool, approvalId, decision === 'approved' ? 'approved' : 'denied')
  if (!legacy) return null
  const { rows: wiRows } = await pool.query<{ goal_id: string | null }>(
    `SELECT goal_id FROM work_items WHERE id = $1 LIMIT 1`,
    [legacy.run_id],
  )
  const goalId = wiRows[0]?.goal_id ?? null
  if (goalId) {
    await transitionGoalStatus(pool, goalId, decision === 'approved' ? 'in_progress' : 'blocked').catch(() => undefined)
  }

  return {
    id: legacy.approval_id,
    goalId,
    workItemId: legacy.run_id,
    requestedByAgentRole: 'prime',
    actionSummary: legacy.action,
    riskSummary: null,
    status: legacy.status === 'denied' ? 'rejected' : legacy.status,
    decisionNotes: null,
    expiresAt: '',
    resolvedAt: legacy.decided_at,
  }
}
