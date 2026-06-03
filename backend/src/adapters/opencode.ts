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

function buildPrompt(request: AgentTaskRequest): string {
  const input = request.input ?? {}
  const content = typeof input['content'] === 'string' ? input['content'] : ''
  const context = typeof input['context'] === 'string' ? input['context'] : ''
  const title = typeof input['title'] === 'string' ? input['title'] : ''
  const pieces = [
    title ? `Task: ${title}` : '',
    request.capability ? `Capability: ${request.capability}` : '',
    context ? `Context:\n${context}` : '',
    content || JSON.stringify(input, null, 2),
  ].filter(Boolean)
  return pieces.join('\n\n')
}

function extractSessionId(payload: Record<string, unknown>): string | null {
  const sessionId = payload['id'] ?? payload['session_id']
  return typeof sessionId === 'string' ? sessionId : null
}

function decodeChunk(chunk: Uint8Array): string {
  return new TextDecoder().decode(chunk)
}

function normalizeSseEvent(rawEvent: string): { event?: string; data?: string } | null {
  const lines = rawEvent.split('\n').map((line) => line.trimEnd())
  let eventName: string | undefined
  const dataLines: string[] = []
  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (!eventName && dataLines.length === 0) return null
  return {
    event: eventName,
    data: dataLines.join('\n'),
  }
}

function mapOpenCodeEvent(sessionId: string, payload: Record<string, unknown>, fallbackType?: string): AgentRuntimeEvent {
  const type = typeof payload['type'] === 'string'
    ? payload['type']
    : typeof payload['event'] === 'string'
      ? payload['event']
      : fallbackType ?? 'unknown'

  if (type === 'message.part.delta') {
    return { type, payload: { session_id: sessionId, ...payload } }
  }
  if (type === 'permission.asked') {
    return { type, payload: { session_id: sessionId, ...payload } }
  }

  const status = payload['status']
  if (type === 'session.status' && status === 'complete') {
    return { type: 'task.completed', payload: { session_id: sessionId, ...payload } }
  }
  if (type === 'session.status' && status === 'error') {
    return { type: 'task.failed', payload: { session_id: sessionId, ...payload } }
  }
  if (type === 'error' || type === 'task.failed') {
    return { type: 'task.failed', payload: { session_id: sessionId, ...payload } }
  }

  return { type, payload: { session_id: sessionId, ...payload } }
}

async function* streamSse(
  res: Response,
  sessionId: string,
): AsyncIterable<AgentRuntimeEvent> {
  if (!res.body) return
  const reader = res.body.getReader()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decodeChunk(value)

    while (true) {
      const boundary = buffer.indexOf('\n\n')
      if (boundary === -1) break
      const rawEvent = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const parsed = normalizeSseEvent(rawEvent)
      if (!parsed?.data) continue

      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(parsed.data) as Record<string, unknown>
      } catch {
        payload = { raw: parsed.data }
      }
      yield mapOpenCodeEvent(sessionId, payload, parsed.event)
    }
  }

  if (buffer.trim()) {
    const parsed = normalizeSseEvent(buffer)
    if (parsed?.data) {
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(parsed.data) as Record<string, unknown>
      } catch {
        payload = { raw: parsed.data }
      }
      yield mapOpenCodeEvent(sessionId, payload, parsed.event)
    }
  }
}

/**
 * @deprecated Legacy OpenCode adapter. Remove when no agent depends on this path.
 * @see https://github.com/.../specs/022-acp-adapter
 */
export class OpenCodeAdapter implements AgentAdapter {
  constructor(private readonly fetchFn: typeof globalThis.fetch = fetch) {}

  async discover(agent: RegistryAgent): Promise<AgentCapabilities> {
    const endpoint = endpointFor(agent)
    if (!endpoint) {
      return {
        name: agent.name,
        runtime_family: agent.runtime_family,
        execution_mode: agent.execution_mode,
        capabilities: agent.capabilities,
        protocol: 'registry',
      }
    }

    try {
      const res = await this.fetchFn(`${endpoint}/health`)
      const metadata = await parseJson(res)
      return {
        name: typeof metadata['name'] === 'string' ? metadata['name'] : agent.name,
        runtime_family: agent.runtime_family,
        execution_mode: agent.execution_mode,
        capabilities: agent.capabilities,
        protocol: 'opencode',
        metadata,
      }
    } catch {
      return {
        name: agent.name,
        runtime_family: agent.runtime_family,
        execution_mode: agent.execution_mode,
        capabilities: agent.capabilities,
        protocol: 'registry',
      }
    }
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

    const createRes = await this.fetchFn(`${endpoint}/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        delegation_id: request.delegation_id,
        work_item_id: request.work_item_id,
        capability: request.capability,
      }),
    })
    const created = await parseJson(createRes)
    const sessionId = extractSessionId(created)
    if (!createRes.ok || !sessionId) {
      yield { type: 'task.failed', payload: { error: 'failed to create session', response: created } }
      return
    }
    yield { type: 'task.started', payload: { session_id: sessionId, ...created } }

    const messageRes = await this.fetchFn(`${endpoint}/session/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: buildPrompt(request),
        metadata: {
          delegation_id: request.delegation_id,
          work_item_id: request.work_item_id,
          capability: request.capability,
        },
      }),
    })
    const messagePayload = await parseJson(messageRes)
    if (!messageRes.ok) {
      yield { type: 'task.failed', payload: { session_id: sessionId, error: 'failed to send message', response: messagePayload } }
      return
    }
    yield { type: 'message.sent', payload: { session_id: sessionId, ...messagePayload } }

    const eventRes = await this.fetchFn(`${endpoint}/event?session_id=${encodeURIComponent(sessionId)}`, {
      headers: { Accept: 'text/event-stream' },
    })
    if (!eventRes.ok) {
      const payload = await parseJson(eventRes)
      yield { type: 'task.failed', payload: { session_id: sessionId, error: 'failed to subscribe to events', response: payload } }
      return
    }

    for await (const event of streamSse(eventRes, sessionId)) {
      yield event
    }
  }

  async *sendMessage(agent: RegistryAgent, request: AgentMessageRequest): AsyncIterable<AgentRuntimeEvent> {
    const endpoint = endpointFor(agent)
    if (!endpoint) {
      yield { type: 'message.failed', payload: { error: 'agent endpoint is not configured' } }
      return
    }

    if (!request.thread_id) {
      yield { type: 'message.failed', payload: { error: 'thread_id is required for opencode messages' } }
      return
    }

    const res = await this.fetchFn(`${endpoint}/session/${request.thread_id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: request.content,
        metadata: request.metadata ?? {},
      }),
    })
    const payload = await parseJson(res)
    yield { type: res.ok ? 'message.sent' : 'message.failed', payload }
  }

  async getTask(agent: RegistryAgent, taskId: string): Promise<AgentTaskState> {
    const endpoint = endpointFor(agent)
    if (!endpoint) return { id: taskId, status: 'missing-endpoint' }

    const res = await this.fetchFn(`${endpoint}/session/${taskId}`)
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

    await this.fetchFn(`${endpoint}/session/${taskId}/cancel`, { method: 'POST' })
  }
}
