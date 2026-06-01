// useCanvasLayout.test.ts - Unit tests for canvas layout hook

import { renderHook, act, waitFor } from '@testing-library/react'
import * as api from '../../src/api'
import { useCanvasLayout } from '../../src/hooks/useCanvasLayout'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../src/api')

describe('useCanvasLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should load positions on mount', async () => {
    ;(api.fetchCanvasLayout as any).mockResolvedValue({
      'card-1': { x: 100, y: 200 },
    })
    const { result } = renderHook(() => useCanvasLayout())
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.positions['card-1']).toEqual({ x: 100, y: 200 })
    expect(api.fetchCanvasLayout).toHaveBeenCalled()
  })

  it('should handle fetch error gracefully', async () => {
    ;(api.fetchCanvasLayout as any).mockRejectedValue(new Error('Network error'))
    const { result } = renderHook(() => useCanvasLayout())
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.positions).toEqual({})
  })

  it('should update position with optimistic update', () => {
    const { result } = renderHook(() => useCanvasLayout())
    act(() => {
      result.current.updatePosition('card-1', 150, 250)
    })
    expect(result.current.positions['card-1']).toEqual({ x: 150, y: 250 })
  })

  it('should debounce save calls', async () => {
    ;(api.saveCanvasLayout as any).mockResolvedValue({ ok: true })
    const { result } = renderHook(() => useCanvasLayout())
    act(() => {
      result.current.updatePosition('card-1', 100, 100)
      result.current.updatePosition('card-2', 200, 200)
    })
    expect(api.saveCanvasLayout).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(api.saveCanvasLayout).toHaveBeenCalledWith({
      'card-1': { x: 100, y: 100 },
      'card-2': { x: 200, y: 200 },
    })
  })

  it('should not block UI on save failure', async () => {
    ;(api.fetchCanvasLayout as any).mockResolvedValue({})
    ;(api.saveCanvasLayout as any).mockRejectedValue(new Error('Save failed'))
    const { result } = renderHook(() => useCanvasLayout())
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(() => {
      act(() => {
        result.current.updatePosition('card-1', 100, 100)
      })
    }).not.toThrow()
  })
})
