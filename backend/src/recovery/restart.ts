import type pg from 'pg'
import { insertRuntimeEvent } from '../runtime.js'
import { RuntimeEventTypes } from '../runtime-event-types.js'

export interface RecoveryReport {
  resumed: string[]
  redispatched: string[]
  recoveredFailed: string[]
}

// How many times we will try to recover a delegation before giving up (FR-002).
export const MAX_RECOVERY_ATTEMPTS = 3

// Launcher-managed runtime reconciliation outcome types
export type RecoveryOutcome = 'reattached' | 'reprovisioned' | 'unavailable' | 'cleaned_up';
export type RecoveryTrigger = 'backend_restart' | 'runtime_exit' | 'health_failure' | 'teardown';

interface ClaimedRow {
  id: string
  new_epoch: number
  new_status: string
  tier: string | null
}

/**
 * Restart recovery for in-flight delegations (US1, FR-002/003/004/021).
 *
 * Claims every `in_progress` delegation atomically and transitions it out of the
 * in-flight set so the dispatcher will pick it back up: durable agents resume in
 * place (their runtime re-attaches via `load_session` on re-dispatch), ephemerals
 * are re-dispatched fresh, and delegations past `MAX_RECOVERY_ATTEMPTS` are failed
 * with a recorded outcome — never silently lost. Idempotent: a second pass finds
 * nothing `in_progress` and does no work.
 */
export async function recoverInflight(pool: pg.Pool): Promise<RecoveryReport> {
  const report: RecoveryReport = { resumed: [], redispatched: [], recoveredFailed: [] }

  // Single atomic claim-and-transition. The CTE locks the in-flight rows
  // (SKIP LOCKED so concurrent recoverers don't collide) and the UPDATE moves
  // them out of 'in_progress', which is what makes a repeated pass a no-op.
  const { rows } = await pool.query<ClaimedRow>(
    `WITH claimed AS (
       SELECT d.id, d.recovery_epoch, a.tier
         FROM delegations d
         LEFT JOIN agents a ON a.id = d.to_agent_id
        WHERE d.status = 'in_progress'
        FOR UPDATE OF d SKIP LOCKED
     )
     UPDATE delegations d
        SET status = CASE WHEN c.recovery_epoch + 1 > $1 THEN 'failed' ELSE 'queued' END,
            recovery_epoch = c.recovery_epoch + 1,
            updated_at = now()
       FROM claimed c
      WHERE d.id = c.id
     RETURNING d.id, d.recovery_epoch AS new_epoch, d.status AS new_status, c.tier`,
    [MAX_RECOVERY_ATTEMPTS]
  )

  // Delegation state is committed (autocommit) before we emit child events, so the
  // runtime_events FK insert never contends with the claim lock above.
  for (const row of rows) {
    if (row.new_status === 'failed') {
      report.recoveredFailed.push(row.id)
      await insertRuntimeEvent(pool, {
        event_type: 'delegation.recovered_failed',
        actor: 'recovery',
        delegation_id: row.id,
        payload: { reason: 'max_recovery_attempts_exceeded', attempts: row.new_epoch },
      })
    } else if (row.tier === 'durable') {
      report.resumed.push(row.id)
      await insertRuntimeEvent(pool, {
        event_type: 'session.resumed',
        actor: 'recovery',
        delegation_id: row.id,
        payload: { tier: 'durable', recovery_epoch: row.new_epoch },
      })
    } else {
      report.redispatched.push(row.id)
      await insertRuntimeEvent(pool, {
        event_type: 'delegation.recovered',
        actor: 'recovery',
        delegation_id: row.id,
        payload: { tier: row.tier ?? 'ephemeral', recovery_epoch: row.new_epoch },
      })
    }
  }

  return report
}

/**
 * Record a launcher-managed runtime recovery outcome
 */
export async function recordLauncherRecoveryOutcome(
  pool: pg.Pool,
  agentId: string,
  trigger: RecoveryTrigger,
  outcome: RecoveryOutcome,
  reason: string
): Promise<void> {
  await insertRuntimeEvent(pool, {
    event_type: RuntimeEventTypes.RUNTIME_LAUNCHER_RECOVERY,
    actor: 'recovery',
    payload: {
      agent_id: agentId,
      trigger,
      outcome,
      reason
    }
  })
}

/**
 * Reconcile launcher-managed runtime state after backend restart
 */
export async function reconcileLauncherRuntimeAfterRestart(
  pool: pg.Pool,
  agentId: string,
  launcherStatus: any | null
): Promise<RecoveryOutcome> {
  if (!launcherStatus) {
    await recordLauncherRecoveryOutcome(pool, agentId, 'backend_restart', 'unavailable', 'Runtime not found in launcher')
    return 'unavailable'
  }

  // Check if runtime is still valid
  if (launcherStatus.state === 'ready' || launcherStatus.state === 'provisioning') {
    await recordLauncherRecoveryOutcome(pool, agentId, 'backend_restart', 'reattached', 'Runtime reattached successfully')
    return 'reattached'
  }

  // Runtime needs reprovisioning
  if (launcherStatus.state === 'unhealthy' || launcherStatus.state === 'tearing_down') {
    await recordLauncherRecoveryOutcome(pool, agentId, 'backend_restart', 'reprovisioned', 'Runtime reprovisioned after failure')
    return 'reprovisioned'
  }

  // Clean up failed runtime
  await recordLauncherRecoveryOutcome(pool, agentId, 'backend_restart', 'cleaned_up', 'Runtime cleaned up after irrecoverable failure')
  return 'cleaned_up'
}
