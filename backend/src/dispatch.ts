import type pg from 'pg'
import type { RegistryAgent } from './registry.js'

const activeIntegrations = new Map<string, NodeJS.Timeout>()

export interface DispatchDeps {
  pool: pg.Pool
  broadcast: (event: any) => void
}

export function startIntegration(agent: RegistryAgent, deps: DispatchDeps): void {
  if (activeIntegrations.has(agent.id)) return
  if (!agent.enabled) return


  // codex-thread: stub, no-op
  // generic: no-op
}

export function stopIntegration(agentId: string): void {
  const timer = activeIntegrations.get(agentId)
  if (timer) {
    clearInterval(timer)
    activeIntegrations.delete(agentId)
  }
}
