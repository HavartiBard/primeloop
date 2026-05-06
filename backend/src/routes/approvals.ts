import { Router } from 'express'
import type pg from 'pg'
import { decideApproval, getApproval, listPendingApprovals } from '../approvals.js'
import { runDelegation } from '../delegation-runner.js'
import { insertRuntimeEvent, updateDelegation, updateWorkItem } from '../runtime.js'

export function createApprovalsRouter({ pool }: { pool: pg.Pool }) {
  const router = Router()

  router.get('/pending', async (_req, res) => {
    try {
      res.json(await listPendingApprovals(pool))
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/:id/approve', async (req, res) => {
    try {
      const approval = await decideApproval(pool, req.params.id, 'approved')
      if (!approval) return res.status(404).json({ error: 'approval not found' })

      let resume: unknown = null
      try {
        resume = await runDelegation(pool, approval.run_id)
      } catch (err) {
        if ((err as Error).message !== 'delegation not found') throw err
      }

      await insertRuntimeEvent(pool, {
        event_type: 'approval.approved',
        actor: 'james',
        delegation_id: approval.run_id,
        payload: { approval_id: approval.approval_id, action: approval.action },
      })
      res.json({ approval, resume })
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.post('/:id/deny', async (req, res) => {
    try {
      const approval = await decideApproval(pool, req.params.id, 'denied')
      if (!approval) return res.status(404).json({ error: 'approval not found' })

      const delegation = await updateDelegation(pool, approval.run_id, {
        status: 'blocked',
        result: { denied: true, approval_id: approval.approval_id },
      })
      if (delegation?.work_item_id) {
        await updateWorkItem(pool, delegation.work_item_id, {
          status: 'blocked',
          blocked_by: 'approval-denied',
        })
      }
      await insertRuntimeEvent(pool, {
        event_type: 'approval.denied',
        actor: 'james',
        work_item_id: delegation?.work_item_id,
        delegation_id: approval.run_id,
        payload: { approval_id: approval.approval_id, action: approval.action },
      })
      res.json({ approval, delegation })
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const approval = await getApproval(pool, req.params.id)
      if (!approval) return res.status(404).json({ error: 'approval not found' })
      res.json(approval)
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  return router
}
