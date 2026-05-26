// ─────────────────────────────────────────────────────────────────────────────
// Circuit Canvas Controls (spec 017)
// Zoom in/out/reset/fit controls for circuit canvas
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import type { UseCanvasViewportResult } from '../../hooks/useCanvasViewport'
import { getCanvasControlLabel, getCanvasKeyboardHelp } from '../../lib/accessibilityText'

/**
 * Props for CircuitCanvasControls
 */
export interface CircuitCanvasControlsProps {
  /** Viewport hook result */
  viewport: UseCanvasViewportResult
  /** Show zoom level indicator */
  showZoomLevel?: boolean
  /** Compact layout */
  compact?: boolean
}

/**
 * Circuit Canvas Controls Component
 */
export function CircuitCanvasControls({
  viewport,
  showZoomLevel = true,
  compact = false,
}: CircuitCanvasControlsProps) {
  const { zoomIn, zoomOut, reset, fitToView, viewport: vp } = viewport

  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg border bg-[var(--panel)] shadow-sm transition-all
        ${compact ? 'p-1' : 'p-2'}`
      }
      role="group"
      aria-label="Canvas controls"
      aria-describedby="canvas-keyboard-help"
    >
      {/* Zoom out */}
      <ControlButton
        label={getCanvasControlLabel('zoomOut')}
        onClick={zoomOut}
        disabled={vp.scale <= 0.5}
        compact={compact}
      >
        −
      </ControlButton>

      {/* Zoom level */}
      {showZoomLevel && (
        <span className={`font-mono text-[10px] text-[var(--muted)] select-none ${compact ? 'px-2' : 'px-3'}`}>
          {Math.round(vp.scale * 100)}%
        </span>
      )}

      {/* Zoom in */}
      <ControlButton
        label={getCanvasControlLabel('zoomIn')}
        onClick={zoomIn}
        disabled={vp.scale >= 2.0}
        compact={compact}
      >
        +
      </ControlButton>

      {/* Divider */}
      {!compact && <div className="w-px h-4 bg-[var(--border-soft)]" />}

      {/* Reset */}
      <ControlButton
        label={getCanvasControlLabel('reset')}
        onClick={reset}
        compact={compact}
      >
        ↺
      </ControlButton>

      {/* Fit */}
      <ControlButton
        label={getCanvasControlLabel('fit')}
        onClick={fitToView}
        compact={compact}
      >
        F
      </ControlButton>
    </div>
  )
}

/**
 * Individual control button
 */
function ControlButton({
  label,
  onClick,
  disabled = false,
  compact = false,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center rounded transition-all
        ${compact ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-sm'}
        ${disabled
          ? 'text-[var(--muted)] cursor-not-allowed'
          : 'bg-[var(--panel-subtle)] hover:bg-[var(--panel)] text-[var(--text)] active:scale-95 focus:outline-none focus:ring-2 focus:ring-[var(--sel-bd)]'
        }
      `}
      aria-label={label}
    >
      {children}
    </button>
  )
}

/**
 * Keyboard help component
 */
export function CanvasKeyboardHelp() {
  return (
    <div
      id="canvas-keyboard-help"
      className="text-[10px] text-[var(--muted)] mt-2"
      aria-live="polite"
    >
      {getCanvasKeyboardHelp()}
    </div>
  )
}
