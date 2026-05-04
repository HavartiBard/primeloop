import type pg from 'pg'
import type { RegistryAgent } from './registry.js'
import { startHermesPolling } from './agents/raclette.js'

const activeIntegrations = new Map<string, NodeJS.Timeout>()

export interface DispatchDeps {
  pool: pg.Pool
  broadcast: (event: any) => void
}

export function startIntegration(agent: RegistryAgent, deps: DispatchDeps): void {
  if (activeIntegrations.has(agent.id)) return
  if (!agent.enabled) return

  if (agent.type === 'hermes') {
    const apiUrl = agent.config?.api_url as string | undefined
    if (!apiUrl) return
    const interval = startHermesPolling({
      agentName: agent.name,
      apiUrl,
      pool: deps.pool,
      broadcast: deps.broadcast,
    })
    activeIntegrations.set(agent.id, interval)
  }
  // langgraph: webhook-based, no polling needed
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
