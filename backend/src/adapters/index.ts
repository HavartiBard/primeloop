import type { RegistryAgent } from '../registry.js'
import { GenericHttpAdapter } from './generic-http.js'
import { OpenCodeAdapter } from './opencode.js'
import type { AgentAdapter } from './types.js'

export function createAgentAdapter(
  agent: RegistryAgent,
  fetchFn: typeof globalThis.fetch = fetch
): AgentAdapter {
  switch (agent.runtime_family) {
    case 'opencode':
    case 'codex-app-server':
      return new OpenCodeAdapter(fetchFn)
    case 'hermes':
    case 'openclaw':
    case 'custom':
    case 'generic-http':
    default:
      return new GenericHttpAdapter(fetchFn)
  }
}

export type {
  AgentAdapter,
  AgentCapabilities,
  AgentHealth,
  AgentMessageRequest,
  AgentRuntimeEvent,
  AgentTaskRequest,
  AgentTaskState,
} from './types.js'
