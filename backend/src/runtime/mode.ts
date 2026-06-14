// Runtime-mode determination, rollout validation, and rollback signaling (spec 025 US3).
//
// Spec 025 makes launcher-managed isolated runtimes the default execution path for
// managed local OpenCode agents. Operators need a clear, observable way to (a) see which
// runtime mode is active, (b) validate that a rollout to launcher mode is actually safe,
// and (c) roll back to the legacy backend-local path with a recorded reason.
//
// The backend remains the source of truth for agent records and worktrees; this module only
// reports/derives the mode and emits rollout/rollback events. It never mutates agents.

import type pg from 'pg'
import { insertRuntimeEvent } from '../runtime.js'
import { RuntimeEventTypes } from '../runtime-event-types.js'
import { createLauncherClient } from './launcher-client.js'

export type RuntimeMode = 'launcher-managed' | 'backend-local'

export interface RuntimeModeStatus {
  mode: RuntimeMode
  launcherEnabled: boolean
  launcherUrl: string
  adapter: string
  // Rollout readiness: whether launcher mode can be safely served right now.
  rolloutReady: boolean
  launcherReachable: boolean
  notes: string[]
}

export function resolveRuntimeMode(env: NodeJS.ProcessEnv = process.env): RuntimeMode {
  // LAUNCHER_ENABLED=1 (or EGRESS_SANDBOX=1, the isolation default) selects launcher mode.
  const enabled = env.LAUNCHER_ENABLED === '1' || env.EGRESS_SANDBOX === '1'
  return enabled ? 'launcher-managed' : 'backend-local'
}

/**
 * Evaluate the current runtime mode and whether a launcher-mode rollout is safe.
 * In launcher mode we require the launcher to be reachable and an auth secret to be set,
 * otherwise rollout is blocked and the operator should stay on / roll back to backend-local.
 */
export async function evaluateRuntimeMode(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RuntimeModeStatus> {
  const mode = resolveRuntimeMode(env)
  const launcherEnabled = mode === 'launcher-managed'
  const launcherUrl = env.LAUNCHER_URL ?? 'http://launcher:8787'
  const adapter = (env.LAUNCHER_ADAPTER ?? 'docker').toLowerCase()
  const notes: string[] = []

  if (!launcherEnabled) {
    return {
      mode,
      launcherEnabled,
      launcherUrl,
      adapter,
      rolloutReady: true, // backend-local is always serviceable
      launcherReachable: false,
      notes: ['Running in backend-local runtime mode (launcher disabled)'],
    }
  }

  let launcherReachable = false
  if (!env.LAUNCHER_AUTH_SECRET) {
    notes.push('LAUNCHER_AUTH_SECRET not configured — launcher requests will be rejected')
  }

  try {
    const client = createLauncherClient(launcherUrl, env.LAUNCHER_AUTH_SECRET)
    const health = await client.getHealth()
    launcherReachable = health.status === 'ok' && health.containerRuntimeReachable
    if (!launcherReachable) {
      notes.push(`Launcher health degraded: ${health.notes.join(', ') || 'unknown'}`)
    }
  } catch (err) {
    notes.push(`Launcher unreachable at ${launcherUrl}: ${err instanceof Error ? err.message : String(err)}`)
  }

  const rolloutReady = launcherReachable && !!env.LAUNCHER_AUTH_SECRET

  return { mode, launcherEnabled, launcherUrl, adapter, rolloutReady, launcherReachable, notes }
}

/**
 * Emit the active runtime mode at boot and a rollout-validated/blocked signal so operators
 * can confirm adoption (or see why launcher mode is not yet safe). Non-throwing: a logging
 * helper should never break boot.
 */
export async function announceRuntimeMode(pool: pg.Pool, env: NodeJS.ProcessEnv = process.env): Promise<RuntimeModeStatus> {
  const status = await evaluateRuntimeMode(env)
  try {
    await insertRuntimeEvent(pool, {
      event_type: RuntimeEventTypes.RUNTIME_MODE_ACTIVE,
      actor: 'runtime-mode',
      payload: { mode: status.mode, adapter: status.adapter },
    })

    if (status.mode === 'launcher-managed') {
      await insertRuntimeEvent(pool, {
        event_type: status.rolloutReady
          ? RuntimeEventTypes.RUNTIME_MODE_ROLLOUT_VALIDATED
          : RuntimeEventTypes.RUNTIME_MODE_ROLLOUT_BLOCKED,
        actor: 'runtime-mode',
        payload: { launcherReachable: status.launcherReachable, notes: status.notes },
      })
    }
  } catch (err) {
    console.error('[runtime-mode] failed to emit runtime-mode events:', err)
  }
  return status
}

/**
 * Record an explicit rollback from launcher-managed mode back to backend-local so the
 * transition is auditable (FR for SRE rollback documentation).
 */
export async function recordRuntimeModeRollback(
  pool: pg.Pool,
  reason: string,
): Promise<void> {
  await insertRuntimeEvent(pool, {
    event_type: RuntimeEventTypes.RUNTIME_MODE_ROLLBACK,
    actor: 'runtime-mode',
    payload: { to: 'backend-local', reason },
  })
}
