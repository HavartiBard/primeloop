import type { RegistryAgent } from '../registry.js'
import { GenericHttpAdapter } from './generic-http.js'
import type { AgentAdapter } from './types.js'

export function createAgentAdapter(
  agent: RegistryAgent,
  fetchFn: typeof globalThis.fetch = fetch
): AgentAdapter {
  switch (agent.runtime_family) {
    case 'hermes':
    case 'openclaw':
    case 'opencode':
    case 'codex-app-server':
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
