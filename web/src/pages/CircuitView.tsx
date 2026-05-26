import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircuitCanvasControls } from '../components/agentCanvas/CircuitCanvasControls'
import { BottomActionToolbar } from '../components/agentCanvas/BottomActionToolbar'
import { NewGoalModal } from '../components/agentCanvas/NewGoalModal'
import { ToolbarActionComposer } from '../components/agentCanvas/ToolbarActionComposer'
import { useCanvasViewport } from '../hooks/useCanvasViewport'
import { useCanvasLayout } from '../hooks/useCanvasLayout'
import {
  fetchRuntimeWorkItems,
  fetchThreads,
} from '../api'
import type { RuntimeThread, RuntimeWorkItem, ToolbarDraftAction, ToolbarActionType } from '../types'

// ─── Layout constants ─────────────────────────────────────────────────────────

const CANVAS_W   = 2400
const CANVAS_H   = 1600
const CARD_W     = 280
const CARD_H_COL = 96   // collapsed height
const CARD_GAP_X = 40
const CARD_GAP_Y = 40
const GRID_START_X = 60
const GRID_START_Y = 60
const CARDS_PER_ROW = 5
const SNAP = 24

// ─── Room state helpers ───────────────────────────────────────────────────────

type RoomState = 'active' | 'approval' | 'idle' | 'closed'

function roomState(thread: RuntimeThread, workItems: RuntimeWorkItem[]): RoomState {
  if (thread.status === 'closed') return 'closed'
  const items = workItems.filter(wi => wi.thread_id === thread.id)
  if (items.some(wi => wi.status === 'blocked')) return 'approval'
  if (items.some(wi => wi.status === 'active'))  return 'active'
  return 'idle'
}

function stateBorderColor(state: RoomState): string {
  if (state === 'active')   return 'var(--s-ok-bd)'
  if (state === 'approval') return 'var(--s-att-bd)'
  if (state === 'closed')   return 'var(--border-soft)'
  return 'var(--border-soft)'
}

function stateGlow(state: RoomState): string {
  if (state === 'active')   return '0 0 0 2px rgba(34,197,94,0.14),  0 4px 16px rgba(0,0,0,0.10)'
  if (state === 'approval') return '0 0 0 3px rgba(217,119,6,0.20),  0 4px 16px rgba(0,0,0,0.12)'
  return '0 2px 8px rgba(0,0,0,0.07)'
}

function stateChipStyle(state: RoomState): CSSProperties {
  if (state === 'active')   return { color: 'var(--s-ok-tx)',  background: 'var(--s-ok-bg)',  border: '1px solid var(--s-ok-bd)'  }
  if (state === 'approval') return { color: 'var(--s-att-tx)', background: 'var(--s-att-bg)', border: '1px solid var(--s-att-bd)' }
  return { color: 'var(--muted)', background: 'var(--panel-subtle)', border: '1px solid var(--border-soft)' }
}

function stateLabel(state: RoomState): string {
  if (state === 'active')   return 'active'
  if (state === 'approval') return 'awaiting'
  if (state === 'closed')   return 'closed'
  return 'idle'
}

function stateDotColor(state: RoomState): string {
  if (state === 'active')   return '#22c55e'
  if (state === 'approval') return '#d97706'
  if (state === 'closed')   return '#6b7280'
  return '#6b7280'
}

function stateDotPulse(state: RoomState): string {
  if (state === 'active')   return 'sd-run-pulse'
  if (state === 'approval') return 'sd-att-pulse'
  return ''
}

// ─── Grid layout ──────────────────────────────────────────────────────────────

function gridPosition(index: number): { x: number; y: number } {
  const col = index % CARDS_PER_ROW
  const row = Math.floor(index / CARDS_PER_ROW)
  return {
    x: GRID_START_X + col * (CARD_W + CARD_GAP_X),
    y: GRID_START_Y + row * (CARD_H_COL + CARD_GAP_Y),
  }
}

function snapToGrid(v: number): number {
  return Math.round(v / SNAP) * SNAP
}

// ─── Room Card ────────────────────────────────────────────────────────────────

interface RoomCardProps {
  thread: RuntimeThread
  workItems: RuntimeWorkItem[]
  x: number
  y: number
  onNavigate?: () => void
  onPositionChange?: (id: string, x: number, y: number) => void
}

function RoomCard({ thread, workItems, x, y, onNavigate, onPositionChange }: RoomCardProps) {
  const [expanded, setExpanded] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; nodeX: number; nodeY: number } | null>(null)
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const displayX = localPos?.x ?? x
  const displayY = localPos?.y ?? y

  const state = roomState(thread, workItems)
  const items = workItems.filter(wi => wi.thread_id === thread.id)
  const isWelcome = thread.metadata?.kind === 'welcome'
  const isGoalRoom = thread.metadata?.kind === 'goal-room'

  const lastActivity = items.length > 0
    ? `${items.length} work item${items.length === 1 ? '' : 's'}`
    : isWelcome
      ? 'Create your first goal to get started'
      : 'Prime evaluating…'

  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation()
    dragRef.current = { startX: e.clientX, startY: e.clientY, nodeX: displayX, nodeY: displayY }
    setIsDragging(false)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      setIsDragging(true)
      setLocalPos({
        x: snapToGrid(dragRef.current.nodeX + dx),
        y: snapToGrid(dragRef.current.nodeY + dy),
      })
    }
  }

  function handlePointerUp() {
    if (!dragRef.current) return
    if (localPos && isDragging) {
      onPositionChange?.(`thread-${thread.id}`, localPos.x, localPos.y)
    }
    dragRef.current = null
    setIsDragging(false)
  }

  function handleClick(e: React.MouseEvent) {
    if (isDragging) return
    e.stopPropagation()
  }

  const dotColor = stateDotColor(state)
  const dotPulse = stateDotPulse(state)

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      style={{
        position: 'absolute',
        left: displayX,
        top: displayY,
        width: CARD_W,
        background: 'var(--panel)',
        border: `1.5px solid ${stateBorderColor(state)}`,
        borderRadius: 8,
        boxShadow: stateGlow(state),
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        transition: isDragging ? 'none' : 'box-shadow 0.15s',
        overflow: 'hidden',
      }}
      className="circuit-node"
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px 8px',
          borderBottom: expanded ? '1px solid var(--border-soft)' : 'none',
        }}
      >
        {/* Drag handle */}
        <svg width="10" height="14" viewBox="0 0 10 14" style={{ flexShrink: 0, opacity: 0.35 }}>
          <circle cx="2.5" cy="2.5" r="1.5" fill="currentColor"/>
          <circle cx="7.5" cy="2.5" r="1.5" fill="currentColor"/>
          <circle cx="2.5" cy="7" r="1.5" fill="currentColor"/>
          <circle cx="7.5" cy="7" r="1.5" fill="currentColor"/>
          <circle cx="2.5" cy="11.5" r="1.5" fill="currentColor"/>
          <circle cx="7.5" cy="11.5" r="1.5" fill="currentColor"/>
        </svg>

        {/* Status dot */}
        <span
          className={dotPulse}
          style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0, boxShadow: `0 0 5px ${dotColor}99` }}
        />

        {/* Title */}
        <span style={{
          flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {thread.title}
        </span>

        {/* Status chip */}
        <span style={{
          fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase',
          letterSpacing: '0.06em', padding: '2px 6px', borderRadius: 4, flexShrink: 0,
          ...stateChipStyle(state),
        }}>
          {stateLabel(state)}
        </span>

        {/* Expand toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
            color: 'var(--muted)', fontSize: 12, lineHeight: 1, flexShrink: 0,
            display: 'flex', alignItems: 'center',
          }}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▲' : '▼'}
        </button>

        {/* Navigate button */}
        {onNavigate && !isWelcome && (
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate() }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
              color: 'var(--muted)', fontSize: 13, lineHeight: 1, flexShrink: 0,
              display: 'flex', alignItems: 'center',
            }}
            title="Open room"
          >
            →
          </button>
        )}
      </div>

      {/* Body — collapsed preview */}
      {!expanded && (
        <div style={{ padding: '8px 12px 10px' }}>
          {/* Kind badge */}
          {(isWelcome || isGoalRoom) && (
            <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {isWelcome ? 'Welcome' : 'Goal Room'}
            </div>
          )}
          {/* Last activity preview */}
          <div style={{
            fontSize: 11, color: 'var(--muted)', lineHeight: 1.4,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {lastActivity}
          </div>

          {/* Footer: participant count */}
          {items.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.45 }}>
                <circle cx="5" cy="3.5" r="2" fill="currentColor"/>
                <path d="M1,9.5 C1,7.5 9,7.5 9,9.5" stroke="currentColor" strokeWidth="1" fill="none"/>
              </svg>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--muted)' }}>
                Prime{items.length > 0 ? ' + team' : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Body — expanded */}
      {expanded && (
        <div style={{ padding: '10px 12px 12px' }}>
          {/* Work item list */}
          {items.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>
              {isWelcome ? 'Use the + Goal button below to start your first goal.' : 'No work items yet.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {items.slice(0, 5).map(wi => (
                <div key={wi.id} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{
                    fontSize: 8, fontFamily: 'monospace', textTransform: 'uppercase',
                    padding: '1px 4px', borderRadius: 3,
                    ...(wi.status === 'active'  ? { color: 'var(--s-ok-tx)',  background: 'var(--s-ok-bg)',  border: '1px solid var(--s-ok-bd)'  } :
                        wi.status === 'blocked' ? { color: 'var(--s-blk-tx)', background: 'var(--s-blk-bg)', border: '1px solid var(--s-blk-bd)' } :
                                                  { color: 'var(--muted)', background: 'var(--panel-subtle)', border: '1px solid var(--border-soft)' }),
                  }}>
                    {wi.status}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {wi.title}
                  </span>
                </div>
              ))}
              {items.length > 5 && (
                <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
                  +{items.length - 5} more
                </div>
              )}
            </div>
          )}

          {/* Navigate link */}
          {onNavigate && !isWelcome && (
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate() }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                marginTop: 10, width: '100%', padding: '5px 0',
                background: 'var(--panel-subtle)', border: '1px solid var(--border-soft)',
                borderRadius: 5, cursor: 'pointer', fontSize: 11, color: 'var(--muted)',
              }}
            >
              Open room →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Background grid ──────────────────────────────────────────────────────────

const GRID_BG: CSSProperties = {
  backgroundImage: [
    'linear-gradient(var(--canvas-grid-major) 1px, transparent 1px)',
    'linear-gradient(90deg, var(--canvas-grid-major) 1px, transparent 1px)',
    'linear-gradient(var(--canvas-grid-minor) 1px, transparent 1px)',
    'linear-gradient(90deg, var(--canvas-grid-minor) 1px, transparent 1px)',
  ].join(', '),
  backgroundSize: '80px 80px, 80px 80px, 16px 16px, 16px 16px',
  backgroundColor: 'var(--bg)',
}

// ─── Main component ───────────────────────────────────────────────────────────

interface CircuitViewProps {
  onNavigate?: (href: string) => void
}

export function CircuitView({ onNavigate }: CircuitViewProps) {
  const viewportHook = useCanvasViewport()
  const { dragHandlers, touchHandlers } = viewportHook
  const { positions, updatePosition } = useCanvasLayout()
  const queryClient = useQueryClient()
  const canvasRef = useRef<HTMLDivElement>(null)

  // Non-passive wheel listener so preventDefault() works (React's synthetic onWheel is passive)
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      viewportHook.zoomBy(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [viewportHook.zoomBy])

  const [toolbarDrafts, setToolbarDrafts] = useState<Record<string, ToolbarDraftAction>>({})
  const [showGoalModal, setShowGoalModal] = useState(false)
  const [composerDraft, setComposerDraft] = useState<ToolbarDraftAction | null>(null)

  const handleOpenDraft = useCallback((actionType: ToolbarActionType) => {
    if (actionType === 'create_goal') {
      setShowGoalModal(true)
      return
    }
    const draft: ToolbarDraftAction = {
      id: `draft-${Date.now()}`,
      actionType,
      status: 'draft',
      originContext: {},
      requiredInputs: {},
    }
    setComposerDraft(draft)
  }, [])

  const handleCancelDraft = useCallback((draftId: string) => {
    setToolbarDrafts((prev) => {
      const next = { ...prev }
      delete next[draftId]
      return next
    })
    setComposerDraft(null)
  }, [])

  const { data: threads = [] } = useQuery({
    queryKey: ['threads'],
    queryFn: fetchThreads,
    refetchInterval: 15_000,
  })

  const { data: workItems = [] } = useQuery({
    queryKey: ['runtime-work-items'],
    queryFn: () => fetchRuntimeWorkItems(),
    refetchInterval: 15_000,
  })

  // Assign grid positions to threads that don't have a persisted position
  const cardPositions = useMemo(() => {
    const result: Record<string, { x: number; y: number }> = {}
    threads.forEach((thread, i) => {
      const id = `thread-${thread.id}`
      result[id] = positions[id] ?? gridPosition(i)
    })
    return result
  }, [threads, positions])

  return (
    <div
      ref={canvasRef}
      style={{ ...GRID_BG, flex: 1, overflow: 'hidden', position: 'relative', touchAction: 'none' }}
      tabIndex={0}
      {...dragHandlers}
      {...touchHandlers}
    >
      {/* Canvas controls */}
      <div
        className="absolute top-4 right-4 z-50"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <CircuitCanvasControls viewport={viewportHook} compact />
      </div>

      {/* Scrollable canvas world */}
      <div
        style={{
          position: 'relative',
          width: CANVAS_W,
          height: CANVAS_H,
          transform: viewportHook.getTransformStyle(),
          transformOrigin: '0 0',
        }}
      >
        {threads.map((thread) => {
          const id = `thread-${thread.id}`
          const pos = cardPositions[id]
          return (
            <RoomCard
              key={thread.id}
              thread={thread}
              workItems={workItems}
              x={pos.x}
              y={pos.y}
              onNavigate={onNavigate ? () => onNavigate('/') : undefined}
              onPositionChange={updatePosition}
            />
          )
        })}

        {threads.length === 0 && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center', color: 'var(--muted)', fontSize: 13,
          }}>
            <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.3 }}>◎</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Canvas is empty</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Use the toolbar below to create your first goal</div>
          </div>
        )}
      </div>

      {/* Bottom action toolbar */}
      <div
        style={{ position: 'absolute', bottom: '1rem', left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <BottomActionToolbar
          drafts={toolbarDrafts}
          onOpenDraft={handleOpenDraft}
          onCancelDraft={handleCancelDraft}
          compact
          contained
        />
      </div>

      {showGoalModal && (
        <NewGoalModal
          onClose={() => setShowGoalModal(false)}
          onCreated={() => {
            setShowGoalModal(false)
            queryClient.invalidateQueries({ queryKey: ['threads'] })
            queryClient.invalidateQueries({ queryKey: ['runtime-work-items'] })
          }}
        />
      )}

      <ToolbarActionComposer
        draft={composerDraft}
        isOpen={composerDraft !== null}
        onClose={() => setComposerDraft(null)}
        onUpdateDraft={(updates) => setComposerDraft((prev) => prev ? { ...prev, ...updates } : null)}
        onSubmit={() => setComposerDraft(null)}
      />
    </div>
  )
}
