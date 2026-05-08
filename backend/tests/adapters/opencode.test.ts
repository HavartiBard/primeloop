import { describe, expect, it, vi } from 'vitest'
import { OpenCodeAdapter } from '../../src/adapters/opencode.js'
import type { RegistryAgent } from '../../src/registry.js'

const agent: RegistryAgent = {
  id: 'agent-1',
  name: 'codex-local',
  type: 'codex-thread',
  runtime_family: 'codex-app-server',
  execution_mode: 'local',
  endpoint: 'http://127.0.0.1:4200',
  capabilities: ['implementation'],
  config: {},
  enabled: true,
  created_at: new Date(0).toISOString(),
}

function sseResponse(events: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(new TextEncoder().encode(event))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

describe('OpenCodeAdapter', () => {
  it('creates a session, posts a message, and streams SSE events', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'sess-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
      .mockResolvedValueOnce(sseResponse([
        'event: message.part.delta\ndata: {"delta":"hello"}\n\n',
        'event: session.status\ndata: {"status":"complete"}\n\n',
      ]))

    const adapter = new OpenCodeAdapter(fetchFn as any)
    const events: string[] = []

    for await (const event of adapter.startTask(agent, {
      capability: 'implementation',
      input: { content: 'Patch the bug' },
      delegation_id: 'del-1',
      work_item_id: 'work-1',
    })) {
      events.push(event.type)
    }

    expect(fetchFn).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:4200/session', expect.objectContaining({ method: 'POST' }))
    expect(fetchFn).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:4200/session/sess-1/message', expect.objectContaining({ method: 'POST' }))
    expect(fetchFn).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:4200/event?session_id=sess-1', expect.objectContaining({
      headers: { Accept: 'text/event-stream' },
    }))
    expect(events).toEqual(['task.started', 'message.sent', 'message.part.delta', 'task.completed'])
  })

  it('turns session error events into task.failed', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ session_id: 'sess-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ accepted: true }), { status: 200 }))
      .mockResolvedValueOnce(sseResponse([
        'event: session.status\ndata: {"status":"error","message":"boom"}\n\n',
      ]))

    const adapter = new OpenCodeAdapter(fetchFn as any)
    const results: Array<{ type: string; payload: Record<string, unknown> }> = []

    for await (const event of adapter.startTask(agent, {
      capability: 'implementation',
      input: { content: 'Fail fast' },
    })) {
      results.push(event)
    }

    expect(results.at(-1)?.type).toBe('task.failed')
    expect(results.at(-1)?.payload.status).toBe('error')
  })

  it('fails cleanly when the endpoint is missing', async () => {
    const adapter = new OpenCodeAdapter(vi.fn() as any)
    const events: string[] = []

    for await (const event of adapter.startTask({ ...agent, endpoint: undefined }, {
      capability: 'implementation',
      input: {},
    })) {
      events.push(event.type)
    }

    expect(events).toEqual(['task.failed'])
  })
})
