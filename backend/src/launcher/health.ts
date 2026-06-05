import { createLauncherRuntimeAdapter } from './adapters.js'

export interface HealthStatus {
  status: 'ok' | 'degraded'
  launcherVersion: string
  containerRuntimeReachable: boolean
  notes: string[]
  adapter: string
}

export async function checkLauncherHealth(): Promise<HealthStatus> {
  const adapter = createLauncherRuntimeAdapter()
  const notes: string[] = []
  let status: 'ok' | 'degraded' = 'ok'

  const health = await adapter.healthCheck()
  if (!health.reachable) {
    status = 'degraded'
    notes.push(...health.notes)
  }

  if (!process.env.LAUNCHER_AUTH_SECRET) {
    status = 'degraded'
    notes.push('LAUNCHER_AUTH_SECRET not configured')
  }

  return {
    status,
    launcherVersion: process.env.LAUNCHER_VERSION || '1.0.0',
    containerRuntimeReachable: health.reachable,
    notes,
    adapter: adapter.kind,
  }
}

export async function checkContainerRuntimeHealth(): Promise<boolean> {
  const adapter = createLauncherRuntimeAdapter()
  const health = await adapter.healthCheck()
  return health.reachable
}

let healthInterval: NodeJS.Timeout | null = null

/**
 * Start a background service that periodically checks launcher health
 * and logs warnings if the launcher becomes unreachable.
 */
export function startLauncherHealthService(launcherUrl: string): void {
  console.log(`[launcher-health] Starting health check for ${launcherUrl}`)

  // Check immediately on start
  void checkAndLogHealth()

  // Then check every 30 seconds
  healthInterval = setInterval(checkAndLogHealth, 30_000)
}

async function checkAndLogHealth(): Promise<void> {
  try {
    const health = await checkLauncherHealth()
    if (health.status === 'degraded') {
      console.warn(`[launcher-health] Degraded: ${health.notes.join(', ')}`)
    } else {
      console.debug(`[launcher-health] OK (${health.adapter})`)
    }
  } catch (error) {
    console.error(`[launcher-health] Health check failed: ${error}`)
  }
}

/**
 * Stop the health check service (for cleanup)
 */
export function stopLauncherHealthService(): void {
  if (healthInterval) {
    clearInterval(healthInterval)
    healthInterval = null
  }
}
