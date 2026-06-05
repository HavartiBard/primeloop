// useCanvasViewport.test.ts - Unit tests for canvas viewport hook

import { renderHook, act } from '@testing-library/react'
import { useCanvasViewport } from '../../src/hooks/useCanvasViewport'

describe('useCanvasViewport', () => {
  describe('panBy', () => {
    it('should pan by dx and dy', () => {
      const { result } = renderHook(() => useCanvasViewport())
      act(() => {
        result.current.panBy(50, 30)
      })
      expect(result.current.viewport.x).toBe(50)
      expect(result.current.viewport.y).toBe(30)
    })
  })

  describe('zoomBy', () => {
    it('should zoom by factor from center', () => {
      const { result } = renderHook(() => useCanvasViewport())
      act(() => {
        result.current.zoomBy(1.1, 100, 100)
      })
      expect(result.current.viewport.scale).toBeCloseTo(1.1)
    })

    it('should respect minScale', () => {
      const { result } = renderHook(() => useCanvasViewport({ minScale: 0.5 }))
      act(() => {
        result.current.zoomBy(0.4, 100, 100)
      })
      expect(result.current.viewport.scale).toBe(0.5)
    })

    it('should respect maxScale', () => {
      const { result } = renderHook(() => useCanvasViewport({ maxScale: 2.0 }))
      act(() => {
        result.current.zoomBy(3.0, 100, 100)
      })
      expect(result.current.viewport.scale).toBe(2.0)
    })
  })

  describe('reset', () => {
    it('should reset viewport to defaults', () => {
      const { result } = renderHook(() => useCanvasViewport())
      act(() => {
        result.current.panBy(100, 50)
        result.current.zoomBy(1.5, 100, 100)
        result.current.reset()
      })
      expect(result.current.viewport.x).toBe(0)
      expect(result.current.viewport.y).toBe(0)
      expect(result.current.viewport.scale).toBe(1)
    })
  })

  describe('dragHandlers', () => {
    it('should start drag on pointer down', () => {
      const { result } = renderHook(() => useCanvasViewport())
      const mockEvent = {
        button: 0,
        currentTarget: { setPointerCapture: vi.fn() } as any,
        clientX: 100,
        clientY: 50,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      }
      act(() => {
        result.current.dragHandlers.onPointerDown(mockEvent as any)
      })
    })

    it('should pan on pointer move after drag start', () => {
      const { result } = renderHook(() => useCanvasViewport())
      act(() => {
        result.current.dragHandlers.onPointerDown({
          button: 0,
          currentTarget: { setPointerCapture: vi.fn() } as any,
          clientX: 100,
          clientY: 50,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as any)
      })
      act(() => {
        result.current.dragHandlers.onPointerMove({
          clientX: 120,
          clientY: 60,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as any)
      })
      expect(result.current.viewport.x).toBe(20)
      expect(result.current.viewport.y).toBe(10)
    })

    it('should end drag on pointer up', () => {
      const { result } = renderHook(() => useCanvasViewport())
      act(() => {
        result.current.dragHandlers.onPointerDown({
          button: 0,
          currentTarget: { setPointerCapture: vi.fn() } as any,
          clientX: 100,
          clientY: 50,
          preventDefault: vi.fn(),
          stopPropagation: vi.fn(),
        } as any)
      })
      act(() => {
        result.current.dragHandlers.onPointerUp()
      })
    })
  })

  describe('wheelHandler', () => {
    it('should zoom on wheel event', () => {
      const { result } = renderHook(() => useCanvasViewport())
      const mockEvent = {
        currentTarget: {
          getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0 })),
        } as any,
        clientX: 100,
        clientY: 100,
        deltaY: -100,
        preventDefault: vi.fn(),
      }
      act(() => {
        result.current.wheelHandler.onWheel(mockEvent as any)
      })
      expect(result.current.viewport.scale).toBeCloseTo(1.1)
    })
  })

  describe('touchHandlers', () => {
    it('should start pinch on touch start with 2 fingers', () => {
      const { result } = renderHook(() => useCanvasViewport())
      const mockEvent = {
        touches: [
          { clientX: 0, clientY: 0 },
          { clientX: 100, clientY: 0 },
        ],
      }
      act(() => {
        result.current.touchHandlers.onTouchStart(mockEvent as any)
      })
    })

    it('should zoom on touch move with 2 fingers', () => {
      const { result } = renderHook(() => useCanvasViewport())
      act(() => {
        result.current.touchHandlers.onTouchStart({
          touches: [
            { clientX: 0, clientY: 0 },
            { clientX: 100, clientY: 0 },
          ],
        } as any)
      })
      const mockEvent = {
        touches: [
          { clientX: 0, clientY: 0 },
          { clientX: 200, clientY: 0 },
        ],
        currentTarget: {
          getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0 })),
        } as any,
      }
      act(() => {
        result.current.touchHandlers.onTouchMove(mockEvent as any)
      })
      expect(result.current.viewport.scale).toBeCloseTo(2.0)
    })

    it('should end pinch on touch end', () => {
      const { result } = renderHook(() => useCanvasViewport())
      act(() => {
        result.current.touchHandlers.onTouchStart({
          touches: [
            { clientX: 0, clientY: 0 },
            { clientX: 100, clientY: 0 },
          ],
        } as any)
      })
      act(() => {
        result.current.touchHandlers.onTouchEnd()
      })
    })
  })
})
