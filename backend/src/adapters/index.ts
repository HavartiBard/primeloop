import type { RegistryAgent } from '../registry.js'
import { GenericHttpAdapter } from './generic-http.js'
import { OpenCodeAdapter } from './opencode.js'
import type { AgentAdapter } from './types.js'

export function createAgentAdapter(
  agent: RegistryAgent,
  fetchFn: typeof globalThis.fetch = fetch
): AgentAdapter {
  switch (agent.runtime_family) {
    case 'acp':
      // ACP agents are handled by AcpHarness in process-manager.ts, not via HTTP shims.
      throw new Error(`ACP agents should not use createAgentAdapter. Use AcpHarness instead.`)
    // @deprecated Legacy cases. Remove when no agent depends on this path.
    // @see https://github.com/.../specs/022-acp-adapter
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
