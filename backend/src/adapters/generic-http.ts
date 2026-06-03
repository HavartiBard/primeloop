import type { RegistryAgent } from '../registry.js'
import type {
  AgentAdapter,
  AgentCapabilities,
  AgentHealth,
  AgentMessageRequest,
  AgentRuntimeEvent,
  AgentTaskRequest,
  AgentTaskState,
} from './types.js'

function endpointFor(agent: RegistryAgent): string | null {
  const configured = agent.endpoint ?? agent.config?.['api_url']
  return typeof configured === 'string' && configured.length > 0 ? configured.replace(/\/$/, '') : null
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return await res.json() as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * @deprecated Legacy generic HTTP adapter. Remove when no agent depends on this path.
 * @see https://github.com/.../specs/022-acp-adapter
 */
export class GenericHttpAdapter implements AgentAdapter {
  constructor(private readonly fetchFn: typeof globalThis.fetch = fetch) {}

  async discover(agent: RegistryAgent): Promise<AgentCapabilities> {
    const endpoint = endpointFor(agent)
    if (!endpoint) {
      return this.fallbackCapabilities(agent)
    }

    for (const path of ['/.well-known/agent-card.json', '/capabilities']) {
      try {
        const res = await this.fetchFn(`${endpoint}${path}`)
        if (!res.ok) continue
        const body = await parseJson(res)
        const capabilities = Array.isArray(body['capabilities'])
          ? body['capabilities'].filter((value): value is string => typeof value === 'string')
          : agent.capabilities
        return {
          name: typeof body['name'] === 'string' ? body['name'] : agent.name,
          runtime_family: agent.runtime_family,
          execution_mode: agent.execution_mode,
          capabilities,
          protocol: typeof body['protocol'] === 'string' ? body['protocol'] : 'generic-http',
          metadata: body,
        }
      } catch {
        // Try the next discovery path before falling back to registry metadata.
      }
    }

    return this.fallbackCapabilities(agent)
  }

  async health(agent: RegistryAgent): Promise<AgentHealth> {
    const endpoint = endpointFor(agent)
    if (!endpoint) return { healthy: false, status: 'missing-endpoint' }

    try {
      const res = await this.fetchFn(`${endpoint}/health`)
      const details = await parseJson(res)
      return {
        healthy: res.ok,
        status: res.ok ? 'ok' : `http-${res.status}`,
        details,
      }
    } catch (err) {
      return {
        healthy: false,
        status: 'unreachable',
        details: { error: (err as Error).message },
      }
    }
  }

  async *startTask(agent: RegistryAgent, request: AgentTaskRequest): AsyncIterable<AgentRuntimeEvent> {
    const endpoint = endpointFor(agent)
    if (!endpoint) {
      yield { type: 'task.failed', payload: { error: 'agent endpoint is not configured' } }
      return
    }

    const res = await this.fetchFn(`${endpoint}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    const payload = await parseJson(res)
    yield { type: res.ok ? 'task.started' : 'task.failed', payload }
  }

  async *sendMessage(agent: RegistryAgent, request: AgentMessageRequest): AsyncIterable<AgentRuntimeEvent> {
    const endpoint = endpointFor(agent)
    if (!endpoint) {
      yield { type: 'message.failed', payload: { error: 'agent endpoint is not configured' } }
      return
    }

    const res = await this.fetchFn(`${endpoint}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    const payload = await parseJson(res)
    yield { type: res.ok ? 'message.sent' : 'message.failed', payload }
  }

  async getTask(agent: RegistryAgent, taskId: string): Promise<AgentTaskState> {
    const endpoint = endpointFor(agent)
    if (!endpoint) return { id: taskId, status: 'missing-endpoint' }

    const res = await this.fetchFn(`${endpoint}/tasks/${taskId}`)
    const payload = await parseJson(res)
    return {
      id: taskId,
      status: typeof payload['status'] === 'string' ? payload['status'] : (res.ok ? 'unknown' : 'failed'),
      result: payload,
    }
  }

  async cancelTask(agent: RegistryAgent, taskId: string): Promise<void> {
    const endpoint = endpointFor(agent)
    if (!endpoint) return

    await this.fetchFn(`${endpoint}/tasks/${taskId}/cancel`, { method: 'POST' })
  }

  private fallbackCapabilities(agent: RegistryAgent): AgentCapabilities {
    return {
      name: agent.name,
      runtime_family: agent.runtime_family,
      execution_mode: agent.execution_mode,
      capabilities: agent.capabilities,
      protocol: 'registry',
    }
  }
}
