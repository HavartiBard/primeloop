// ─────────────────────────────────────────────────────────────────────────────
// Canvas Viewport Hook (spec 017)
// Pan and zoom state for circuit canvas
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef } from 'react'
import type { CanvasViewport } from '../types'

export interface UseCanvasViewportOptions {
  initialViewport?: Partial<CanvasViewport>
  minScale?: number
  maxScale?: number
  zoomStep?: number
}

export interface UseCanvasViewportResult {
  viewport: CanvasViewport
  setViewport: (viewport: Partial<CanvasViewport>) => void
  panBy: (dx: number, dy: number) => void
  zoomBy: (factor: number, centerX?: number, centerY?: number) => void
  reset: () => void
  fitToView: () => void
  zoomIn: () => void
  zoomOut: () => void
  setSelectedNodeId: (nodeId?: string) => void
  getTransformStyle: () => string
  /** Spread onto the canvas container div for pointer-drag pan */
  dragHandlers: {
    onPointerDown: (e: React.PointerEvent) => void
    onPointerMove: (e: React.PointerEvent) => void
    onPointerUp: (e: React.PointerEvent) => void
  }
  /** Spread onto the canvas container div for scroll-wheel zoom */
  wheelHandler: {
    onWheel: (e: React.WheelEvent) => void
  }
  /** Spread onto the canvas container div for two-finger pinch zoom */
  touchHandlers: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
  }
}

/**
 * Hook to manage pan and zoom for circuit canvas
 */
export function useCanvasViewport(
  options: UseCanvasViewportOptions = {},
): UseCanvasViewportResult {
  const {
    initialViewport = { x: 0, y: 0, scale: 1 },
    minScale = 0.5,
    maxScale = 2.0,
    zoomStep = 0.1,
  } = options

  const [viewport, setViewportState] = useState<CanvasViewport>({
    x: initialViewport.x ?? 0,
    y: initialViewport.y ?? 0,
    scale: initialViewport.scale ?? 1,
    selectedNodeId: initialViewport.selectedNodeId,
  })

  const viewportRef = useRef(viewport)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const pinchRef = useRef<number | null>(null)

  // Keep ref in sync
  viewportRef.current = viewport

  const setViewport = useCallback(
    (updates: Partial<CanvasViewport> | ((prev: CanvasViewport) => Partial<CanvasViewport>)) => {
      setViewportState((prev: CanvasViewport) => {
        const nextUpdates = typeof updates === 'function' ? updates(prev) : updates
        const next = { ...prev, ...nextUpdates }
        viewportRef.current = next
        return next
      })
    },
    [],
  )

  const panBy = useCallback(
    (dx: number, dy: number) => {
      setViewport((prev: CanvasViewport) => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy,
      }))
    },
    [],
  )

  const zoomBy = useCallback(
    (factor: number, centerX?: number, centerY?: number) => {
      setViewport((prev: CanvasViewport) => {
        const newScale = Math.min(maxScale, Math.max(minScale, prev.scale * factor))

        // Adjust position to zoom toward center point
        let newX = prev.x
        let newY = prev.y

        if (centerX !== undefined && centerY !== undefined) {
          // Convert screen coordinates to world coordinates before and after zoom
          const worldXBefore = (centerX - prev.x) / prev.scale
          const worldYBefore = (centerY - prev.y) / prev.scale

          newX = centerX - worldXBefore * newScale
          newY = centerY - worldYBefore * newScale
        }

        return {
          ...prev,
          scale: newScale,
          x: newX,
          y: newY,
        }
      })
    },
    [minScale, maxScale],
  )

  const reset = useCallback(() => {
    setViewport({ x: 0, y: 0, scale: 1 })
  }, [])

  const fitToView = useCallback(() => {
    // This will be called with canvas dimensions and node positions
    // Implementation depends on the actual use case
    setViewport({ x: 0, y: 0, scale: 1 })
  }, [])

  const zoomIn = useCallback(() => {
    zoomBy(1 + zoomStep)
  }, [zoomBy, zoomStep])

  const zoomOut = useCallback(() => {
    zoomBy(1 - zoomStep)
  }, [zoomBy, zoomStep])

  const setSelectedNodeId = useCallback(
    (nodeId?: string) => {
      setViewport((prev: CanvasViewport) => ({
        ...prev,
        selectedNodeId: nodeId,
      }))
    },
    [],
  )

  const getTransformStyle = useCallback(() => {
    return `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`
  }, [viewport])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragRef.current = { x: e.clientX, y: e.clientY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    panBy(e.clientX - dragRef.current.x, e.clientY - dragRef.current.y)
    dragRef.current = { x: e.clientX, y: e.clientY }
  }, [panBy])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
  }, [])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    zoomBy(e.deltaY < 0 ? 1.1 : 0.9, cx, cy)
  }, [zoomBy])

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchRef.current = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      )
    }
  }, [])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current !== null) {
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY,
      )
      const factor = dist / pinchRef.current
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      zoomBy(factor, cx - rect.left, cy - rect.top)
      pinchRef.current = dist
    }
  }, [zoomBy])

  const onTouchEnd = useCallback(() => {
    pinchRef.current = null
  }, [])

  return {
    viewport,
    setViewport,
    panBy,
    zoomBy,
    reset,
    fitToView,
    zoomIn,
    zoomOut,
    setSelectedNodeId,
    getTransformStyle,
    dragHandlers: { onPointerDown, onPointerMove, onPointerUp },
    wheelHandler: { onWheel },
    touchHandlers: { onTouchStart, onTouchMove, onTouchEnd },
  }
}

/**
 * Hook for managing keyboard navigation for canvas
 */
export function useCanvasKeyboardNavigation(
  onPan: (dx: number, dy: number) => void,
  onZoom: (factor: number) => void,
): {
  handleKeyDown: (e: React.KeyboardEvent) => void
} {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const panStep = 50

      switch (e.key) {
        case 'ArrowUp':
          onPan(0, panStep)
          e.preventDefault()
          break
        case 'ArrowDown':
          onPan(0, -panStep)
          e.preventDefault()
          break
        case 'ArrowLeft':
          onPan(panStep, 0)
          e.preventDefault()
          break
        case 'ArrowRight':
          onPan(-panStep, 0)
          e.preventDefault()
          break
        case '+':
        case '=':
          onZoom(1.1)
          e.preventDefault()
          break
        case '-':
        case '_':
          onZoom(0.9)
          e.preventDefault()
          break
        case '0':
          // Reset (handled by separate callback)
          break
        case 'f':
        case 'F':
          // Fit to view (handled by separate callback)
          break
      }
    },
    [onPan, onZoom],
  )

  return { handleKeyDown }
}
