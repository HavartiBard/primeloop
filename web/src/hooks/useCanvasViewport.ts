// ─────────────────────────────────────────────────────────────────────────────
// Canvas Viewport Hook (spec 017)
// Pan and zoom state for circuit canvas
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef } from 'react'
import type { CanvasViewport } from '../types'

/**
 * Options for the canvas viewport hook
 */
export interface UseCanvasViewportOptions {
  /** Initial viewport state */
  initialViewport?: Partial<CanvasViewport>
  /** Minimum zoom level */
  minScale?: number
  /** Maximum zoom level */
  maxScale?: number
  /** Zoom step factor */
  zoomStep?: number
}

/**
 * Result from the canvas viewport hook
 */
export interface UseCanvasViewportResult {
  /** Current viewport state */
  viewport: CanvasViewport
  /** Update viewport */
  setViewport: (viewport: Partial<CanvasViewport>) => void
  /** Pan by offset */
  panBy: (dx: number, dy: number) => void
  /** Zoom by factor */
  zoomBy: (factor: number, centerX?: number, centerY?: number) => void
  /** Reset viewport to defaults */
  reset: () => void
  /** Fit to view */
  fitToView: () => void
  /** Zoom in */
  zoomIn: () => void
  /** Zoom out */
  zoomOut: () => void
  /** Set selected node ID */
  setSelectedNodeId: (nodeId?: string) => void
  /** Get transform style string */
  getTransformStyle: () => string
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
