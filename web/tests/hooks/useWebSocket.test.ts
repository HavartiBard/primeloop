import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWebSocket } from '../../src/hooks/useWebSocket'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  close = vi.fn()
  constructor(public url: string) { MockWebSocket.instances.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  receive(data: object) { this.onmessage?.({ data: JSON.stringify(data) }) }
}

beforeEach(() => { MockWebSocket.instances = []; vi.stubGlobal('WebSocket', MockWebSocket) })
afterEach(() => { vi.unstubAllGlobals() })

describe('useWebSocket', () => {
  it('starts with empty events array', () => {
    const { result } = renderHook(() => useWebSocket('/ws'))
    expect(result.current.events).toEqual([])
  })

  it('appends received events', () => {
    const { result } = renderHook(() => useWebSocket('/ws'))
    act(() => { MockWebSocket.instances[0].open() })
    act(() => {
      MockWebSocket.instances[0].receive({ id: '1', agent: 'langgraph', type: 'run.started', payload: {}, created_at: '' })
    })
    expect(result.current.events).toHaveLength(1)
    expect(result.current.events[0].type).toBe('run.started')
  })

  it('newest events are first', () => {
    const { result } = renderHook(() => useWebSocket('/ws'))
    act(() => { MockWebSocket.instances[0].open() })
    act(() => {
      MockWebSocket.instances[0].receive({ id: '1', type: 'run.started', agent: 'langgraph', payload: {}, created_at: 'a' })
      MockWebSocket.instances[0].receive({ id: '2', type: 'run.completed', agent: 'langgraph', payload: {}, created_at: 'b' })
    })
    expect(result.current.events[0].id).toBe('2')
  })
})
