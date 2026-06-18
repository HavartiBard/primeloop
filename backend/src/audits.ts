import cron, { type ScheduledTask } from 'node-cron'
import type pg from 'pg'
import { listAuditLoops, recordAuditRun, insertRuntimeEvent, updateWorkItem } from './runtime.js'

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

/**
 * Reclassify stale investigation work items that have no in-flight delegation.
 * Moves work-item state reconciliation out of the Prime event loop and into
 * a scheduled audit/sweeper for better integrity and scalability.
 */
export async function reconcileWorkItemStates(pool: pg.Pool): Promise<{
  reclassified: number
  details: Array<{ id: string; previous_status: string; new_status: string; reason: string }>
}> {
  const { rows } = await pool.query<{
    id: string
    blocked_reason: string | null
    routing_outcome: string | null
    metadata: Record<string, unknown> | null
  }>(`
    SELECT wi.id,
           COALESCE(evt.payload->>'reason', wi.blocked_by, 'no-investigation-route') AS blocked_reason,
           COALESCE(evt.payload->>'routing_outcome', wi.metadata->>'routing_outcome') AS routing_outcome,
           wi.metadata
      FROM work_items wi
      LEFT JOIN LATERAL (
        SELECT payload
          FROM runtime_events re
         WHERE re.work_item_id = wi.id
           AND re.event_type IN ('prime.failure.investigation_needed', 'prime.blocker.investigation_needed')
         ORDER BY re.created_at DESC
         LIMIT 1
      ) evt ON true
     WHERE wi.status = 'active'
       AND wi.metadata->>'action_type' IN ('hard_failure_investigation', 'prime_blocker_investigation')
       AND evt.payload IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM delegations d
          WHERE d.work_item_id = wi.id
            AND d.status IN ('queued', 'running', 'pending')
       )
  `)

  const details: Array<{ id: string; previous_status: string; new_status: string; reason: string }> = []

  for (const row of rows) {
    await updateWorkItem(pool, row.id, {
      status: 'blocked',
      blocked_by: row.blocked_reason ?? 'no-investigation-route',
      metadata: {
        ...(row.metadata ?? {}),
        investigation_status: 'blocked',
        routing_outcome: row.routing_outcome ?? (row.metadata?.['routing_outcome'] as string | undefined) ?? 'blocked_runtime_unavailable',
      },
    })

    await insertRuntimeEvent(pool, {
      event_type: 'work.reclassified',
      actor: 'Prime',
      work_item_id: row.id,
      payload: {
        previous_status: 'active',
        status: 'blocked',
        reason: row.blocked_reason ?? 'no-investigation-route',
      },
    })

    details.push({
      id: row.id,
      previous_status: 'active',
      new_status: 'blocked',
      reason: row.blocked_reason ?? 'no-investigation-route',
    })
  }

  return { reclassified: details.length, details }
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
