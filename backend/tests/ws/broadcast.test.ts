import { describe, it, expect, vi } from 'vitest'
import { createBroadcaster } from '../../src/ws/broadcast.js'
import type { AgentEvent } from '../../src/events/types.js'

describe('WebSocket broadcaster', () => {
  it('sends event as JSON to all ready clients', () => {
    const { broadcast, addClient } = createBroadcaster()
    const send1 = vi.fn()
    const send2 = vi.fn()
    addClient({ readyState: 1, send: send1, on: vi.fn() } as never)
    addClient({ readyState: 1, send: send2, on: vi.fn() } as never)

    const event: AgentEvent = {
      id: 'x', agent: 'langgraph', type: 'run.started',
      payload: { run_id: 'abc' }, created_at: new Date().toISOString(),
    }
    broadcast(event)

    expect(send1).toHaveBeenCalledWith(JSON.stringify(event))
    expect(send2).toHaveBeenCalledWith(JSON.stringify(event))
  })

  it('skips clients that are not in OPEN state', () => {
    const { broadcast, addClient } = createBroadcaster()
    const send = vi.fn()
    addClient({ readyState: 3, send, on: vi.fn() } as never)

    broadcast({ id: 'x', agent: 'langgraph', type: 'run.started', payload: {}, created_at: '' })
    expect(send).not.toHaveBeenCalled()
  })

  it('removes closed clients automatically', () => {
    const { broadcast, addClient, clientCount } = createBroadcaster()
    addClient({ readyState: 3, send: vi.fn(), on: vi.fn() } as never)
    broadcast({ id: 'x', agent: 'langgraph', type: 'run.started', payload: {}, created_at: '' })
    expect(clientCount()).toBe(0)
  })

  it('removes client on close event', () => {
    const { addClient, clientCount } = createBroadcaster()
    let closeHandler: () => void = () => {}
    const ws = {
      readyState: 1,
      send: vi.fn(),
      on: vi.fn((event: string, fn: () => void) => { if (event === 'close') closeHandler = fn }),
    }
    addClient(ws as never)
    expect(clientCount()).toBe(1)
    closeHandler()
    expect(clientCount()).toBe(0)
  })
})
