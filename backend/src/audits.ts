import cron, { type ScheduledTask } from 'node-cron'
import type pg from 'pg'
import { listAuditLoops, recordAuditRun } from './runtime.js'

interface AuditSummaryRow {
  count: number
}

async function count(pool: pg.Pool, sql: string, values: unknown[] = []): Promise<number> {
  const { rows } = await pool.query<AuditSummaryRow>(sql, values)
  return rows[0]?.count ?? 0
}

export async function runAuditLoop(pool: pg.Pool, loopId: string): Promise<Record<string, unknown>> {
  const [
    blockedWork,
    activeWork,
    pendingApprovals,
    queuedDelegations,
    staleDelegations,
    staleWork,
  ] = await Promise.all([
    count(pool, `SELECT count(*)::int AS count FROM work_items WHERE status = 'blocked'`),
    count(pool, `SELECT count(*)::int AS count FROM work_items WHERE status = 'active'`),
    count(pool, `SELECT count(*)::int AS count FROM approvals WHERE status = 'pending'`),
    count(pool, `SELECT count(*)::int AS count FROM delegations WHERE status = 'queued'`),
    count(pool, `SELECT count(*)::int AS count FROM delegations WHERE status IN ('queued', 'running') AND updated_at < now() - interval '1 hour'`),
    count(pool, `SELECT count(*)::int AS count FROM work_items WHERE status IN ('active', 'blocked', 'approval') AND updated_at < now() - interval '1 day'`),
  ])

  const findings: string[] = []
  if (blockedWork > 0) findings.push(`${blockedWork} blocked work item(s) need attention`)
  if (pendingApprovals > 0) findings.push(`${pendingApprovals} approval request(s) are pending`)
  if (staleDelegations > 0) findings.push(`${staleDelegations} delegation(s) are stale`)
  if (staleWork > 0) findings.push(`${staleWork} work item(s) have not changed in over a day`)
  if (findings.length === 0) findings.push('No stale queues or blocked execution detected')

  const result = {
    checked_at: new Date().toISOString(),
    summary: {
      active_work: activeWork,
      blocked_work: blockedWork,
      pending_approvals: pendingApprovals,
      queued_delegations: queuedDelegations,
      stale_delegations: staleDelegations,
      stale_work: staleWork,
    },
    findings,
  }

  await recordAuditRun(pool, loopId, result)
  return result
}

export async function startAuditScheduler(pool: pg.Pool): Promise<ScheduledTask[]> {
  const loops = await listAuditLoops(pool)
  const tasks: ScheduledTask[] = []

  for (const loop of loops) {
    if (!loop.enabled || !cron.validate(loop.cadence_cron)) continue
    const task = cron.schedule(loop.cadence_cron, () => {
      runAuditLoop(pool, loop.id).catch((err) => {
        console.error(`[audit:${loop.name}] failed`, err)
      })
    })
    tasks.push(task)
  }

  return tasks
}
