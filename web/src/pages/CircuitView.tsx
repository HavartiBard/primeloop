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
  fetchAgentRegistry,
  fetchAgents,
  fetchRuntimeAuditLoops,
  fetchRuntimeDelegations,
  fetchRuntimeOverview,
  fetchRuntimeWorkItems,
  fetchThreads,
} from '../api'
import type { RegistryAgent, RuntimeAuditLoop, RuntimeDelegation, RuntimeThread, RuntimeWorkItem, ToolbarDraftAction, ToolbarActionType } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeType  = 'agent' | 'room' | 'work' | 'audit' | 'system'
type NodeState = 'active' | 'running' | 'blocked' | 'approval' | 'neutral' | 'system'
type EdgeStyle = 'coord' | 'part' | 'owns' | 'queued' | 'audit'

interface Chip { label: string; variant?: 'ok' | 'run' | 'blk' | 'att' | 'neu' }

interface NodeDef {
  id: string
  type: NodeType
  state: NodeState
  x: number
  y: number
  title: string
  summary: string
  chips: Chip[]
  wide?: boolean
}

interface EdgeDef {
  from: string
  to: string
  style: EdgeStyle
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const CANVAS_W = 1296
const CANVAS_H = 768
const NODE_W   = 176
const ROOM_W   = 192
const NODE_H   = 96
const ROW_Y    = [48, 192, 336, 480, 624] as const

// ─── Layout helpers ───────────────────────────────────────────────────────────

function rowPositions(count: number, nodeWidth = NODE_W): number[] {
  if (count === 0) return []
  const spacing = CANVAS_W / (count + 1)
  return Array.from({ length: count }, (_, i) => Math.round((i + 1) * spacing - nodeWidth / 2))
}

function routeEdge(x1: number, y1: number, x2: number, y2: number, c = 8): string {
  const midY = Math.round((y1 + y2) / 2)
  if (Math.abs(x2 - x1) < 2) return `M ${x1},${y1} V ${y2}`
  const dx = x2 > x1 ? c : -c
  if (Math.abs(x2 - x1) <= c * 2) {
    return `M ${x1},${y1} V ${midY - c} L ${x2},${midY + c} V ${y2}`
  }
  return [`M ${x1},${y1}`, `V ${midY - c}`, `L ${x1 + dx},${midY}`, `H ${x2 - dx}`, `L ${x2},${midY + c}`, `V ${y2}`].join(' ')
}

function nodePt(node: NodeDef, side: 'top' | 'bottom'): [number, number] {
  const w = node.wide ? ROOM_W : NODE_W
  return [node.x + Math.round(w / 2), side === 'top' ? node.y : node.y + NODE_H]
}

// ─── Graph builder ────────────────────────────────────────────────────────────

function buildGraph(
  primeName: string,
  agents: RegistryAgent[],
  threads: RuntimeThread[],
  workItems: RuntimeWorkItem[],
  delegations: RuntimeDelegation[],
  auditLoops: RuntimeAuditLoop[],
  healthMap: Map<string, boolean>,
): { nodes: Map<string, NodeDef>; edges: EdgeDef[] } {
  const nodes = new Map<string, NodeDef>()
  const edges: EdgeDef[] = []

  // Row 0 — Prime
  const activeCount  = workItems.filter(i => i.status === 'active').length
  const blockedCount = workItems.filter(i => i.status === 'blocked').length
  const primeChips: Chip[] = []
  if (activeCount)  primeChips.push({ label: `${activeCount} active`,  variant: 'ok'  })
  if (blockedCount) primeChips.push({ label: `${blockedCount} blocked`, variant: 'blk' })
  if (!primeChips.length) primeChips.push({ label: 'idle', variant: 'neu' })

  nodes.set('prime', {
    id: 'prime', type: 'agent', state: blockedCount > 0 ? 'blocked' : 'active',
    x: Math.round(CANVAS_W / 2 - NODE_W / 2), y: ROW_Y[0],
    title: primeName,
    summary: 'coordinator · delegate · approve',
    chips: primeChips,
  })

  // Row 1 — Agents
  const agentXs = rowPositions(agents.length)
  agents.forEach((agent, i) => {
    const healthy = healthMap.get(agent.name.toLowerCase())
    const state: NodeState = !agent.enabled ? 'neutral' : healthy === false ? 'blocked' : 'active'
    const agentItems = workItems.filter(wi => wi.owner_agent_id === agent.id)
    const chips: Chip[] = []
    const aActive  = agentItems.filter(it => it.status === 'active').length
    const aBlocked = agentItems.filter(it => it.status === 'blocked').length
    if (aActive)  chips.push({ label: `${aActive} active`,  variant: 'ok'  })
    if (aBlocked) chips.push({ label: `${aBlocked} blocked`, variant: 'blk' })
    if (!chips.length) chips.push({ label: agent.execution_mode || agent.type, variant: state === 'active' ? 'ok' : 'neu' })

    const id = `agent-${agent.id}`
    nodes.set(id, {
      id, type: 'agent', state,
      x: agentXs[i], y: ROW_Y[1],
      title: agent.name,
      summary: [agent.type, agent.runtime_family].filter(Boolean).join(' · '),
      chips,
    })
    edges.push({ from: 'prime', to: id, style: 'coord' })
  })

  // Row 2 — Threads / Rooms
  const threadXs = rowPositions(threads.length, ROOM_W)
  threads.forEach((thread, i) => {
    const items  = workItems.filter(wi => wi.thread_id === thread.id)
    const delegs = delegations.filter(d => d.work_item_id && items.some(it => it.id === d.work_item_id))
    const state: NodeState = thread.status === 'closed' ? 'neutral'
      : items.some(it => it.status === 'blocked')      ? 'blocked'
      : delegs.some(d => d.status === 'running')       ? 'running'
      : items.some(it => it.status === 'active')        ? 'active'
      : 'neutral'
    const tActive  = items.filter(it => it.status === 'active').length
    const tBlocked = items.filter(it => it.status === 'blocked').length
    const chips: Chip[] = []
    if (tActive)  chips.push({ label: `${tActive} active`,  variant: 'ok'  })
    if (tBlocked) chips.push({ label: `${tBlocked} blocked`, variant: 'blk' })
    if (!chips.length) chips.push({ label: `${items.length} items`, variant: 'neu' })

    const lanePart = items[0]?.lane ? ` · ${items[0].lane}` : ''
    const id = `thread-${thread.id}`
    nodes.set(id, {
      id, type: 'room', state,
      x: threadXs[i], y: ROW_Y[2],
      title: thread.title || 'Untitled',
      summary: `${items.length} item${items.length === 1 ? '' : 's'}${lanePart}`,
      chips,
      wide: true,
    })
    edges.push({ from: 'prime', to: id, style: 'coord' })

    agents.forEach(agent => {
      if (items.some(wi => wi.owner_agent_id === agent.id)) {
        edges.push({ from: `agent-${agent.id}`, to: id, style: 'part' })
      }
    })
  })

  // Row 3 — Work items
  const workXs = rowPositions(workItems.length)
  workItems.forEach((item, i) => {
    const state: NodeState = item.status === 'blocked' ? 'blocked'
      : item.status === 'active' ? 'active'
      : item.status === 'queued' ? 'running'
      : 'neutral'
    const chips: Chip[] = [{
      label: item.status,
      variant: state === 'active' ? 'ok' : state === 'blocked' ? 'blk' : state === 'running' ? 'run' : 'neu',
    }]
    if (item.priority && item.priority !== 'medium') chips.push({ label: item.priority })

    const id = `work-${item.id}`
    nodes.set(id, {
      id, type: 'work', state,
      x: workXs[i], y: ROW_Y[3],
      title: item.title,
      summary: [item.owner_label, item.lane].filter(Boolean).join(' · '),
      chips,
    })
    if (item.thread_id && nodes.has(`thread-${item.thread_id}`)) {
      edges.push({ from: `thread-${item.thread_id}`, to: id, style: item.status === 'active' ? 'owns' : 'queued' })
    } else {
      edges.push({ from: 'prime', to: id, style: 'coord' })
    }
  })

  // Row 4 — Audit loops
  const auditXs = rowPositions(auditLoops.length)
  auditLoops.forEach((loop, i) => {
    const id = `audit-${loop.id}`
    nodes.set(id, {
      id, type: 'audit', state: 'neutral',
      x: auditXs[i], y: ROW_Y[4],
      title: loop.name,
      summary: (loop.purpose || '').slice(0, 44),
      chips: [{ label: loop.cadence_cron }],
    })
    edges.push({ from: 'prime', to: id, style: 'audit' })
  })

  return { nodes, edges }
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const TYPE_LABEL_COLOR: Record<NodeType, string> = {
  agent:  '#0891b2',
  room:   '#7c3aed',
  work:   '#15803d',
  audit:  '#6b7280',
  system: '#9ca3af',
}

function nodeBorder(state: NodeState): string {
  if (state === 'active')   return 'var(--s-ok-bd)'
  if (state === 'running')  return 'var(--s-run-bd)'
  if (state === 'blocked')  return 'var(--s-blk-bd)'
  if (state === 'approval') return 'var(--s-att-bd)'
  if (state === 'system')   return 'rgba(167,139,250,0.4)'
  return 'var(--s-neu-bd)'
}

function nodeGlow(state: NodeState): string {
  if (state === 'active')   return '0 0 0 2px rgba(34,197,94,0.14),  0 2px 8px rgba(0,0,0,0.07)'
  if (state === 'running')  return '0 0 0 2px rgba(6,182,212,0.14),  0 2px 8px rgba(0,0,0,0.07)'
  if (state === 'blocked')  return '0 0 0 4px rgba(239,68,68,0.18),  0 4px 14px rgba(0,0,0,0.10)'
  if (state === 'approval') return '0 0 0 4px rgba(217,119,6,0.16),  0 4px 14px rgba(0,0,0,0.10)'
  if (state === 'system')   return '0 0 0 2px rgba(124,58,237,0.10), 0 2px 8px rgba(0,0,0,0.07)'
  return '0 1px 4px rgba(0,0,0,0.05)'
}

function chipStyle(variant?: Chip['variant']): CSSProperties {
  if (variant === 'ok')  return { color: 'var(--s-ok-tx)',  background: 'var(--s-ok-bg)',  border: '1px solid var(--s-ok-bd)'  }
  if (variant === 'run') return { color: 'var(--s-run-tx)', background: 'var(--s-run-bg)', border: '1px solid var(--s-run-bd)' }
  if (variant === 'blk') return { color: 'var(--s-blk-tx)', background: 'var(--s-blk-bg)', border: '1px solid var(--s-blk-bd)' }
  if (variant === 'att') return { color: 'var(--s-att-tx)', background: 'var(--s-att-bg)', border: '1px solid var(--s-att-bd)' }
  return { color: 'var(--muted)', background: 'var(--panel-subtle)', border: '1px solid var(--border-soft)' }
}

function sdotStyle(state: NodeState): { bg: string; cls: string } {
  if (state === 'active')   return { bg: '#22c55e', cls: '' }
  if (state === 'running')  return { bg: '#0891b2', cls: 'sd-run-pulse' }
  if (state === 'blocked')  return { bg: '#ef4444', cls: 'sd-blk-pulse' }
  if (state === 'approval') return { bg: '#d97706', cls: 'sd-att-pulse' }
  if (state === 'system')   return { bg: '#8b5cf6', cls: '' }
  return { bg: '#6b7280', cls: '' }
}

// ─── Node card ────────────────────────────────────────────────────────────────

interface CircuitNodeProps extends NodeDef {
  onRoomClick?: (id: string) => void
  onPositionChange?: (id: string, x: number, y: number) => void
}

function CircuitNode({ id, type, state, x, y, wide, title, summary, chips, onRoomClick, onPositionChange }: CircuitNodeProps) {
  const dot = sdotStyle(state)
  const isRoom = type === 'room'
  const width = wide ? ROOM_W : NODE_W
  const leftBorder = state === 'approval' ? '3px solid var(--s-att-bd)' : undefined
  const dragState = useRef<{ startX: number; startY: number; nodeX: number; nodeY: number } | null>(null)
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(null)

  const displayX = localPos?.x ?? x
  const displayY = localPos?.y ?? y

  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation()
    dragState.current = { startX: e.clientX, startY: e.clientY, nodeX: displayX, nodeY: displayY }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragState.current) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    setLocalPos({ x: dragState.current.nodeX + dx, y: dragState.current.nodeY + dy })
  }

  function handlePointerUp() {
    if (!dragState.current || !localPos) {
      dragState.current = null
      return
    }
    onPositionChange?.(id, localPos.x, localPos.y)
    dragState.current = null
  }

  return (
    <div
      onClick={isRoom && onRoomClick ? () => onRoomClick(id) : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'absolute',
        left: displayX,
        top: displayY,
        width,
        background: 'var(--panel)',
        border: `1.5px solid ${nodeBorder(state)}`,
        borderLeft: leftBorder ?? `1.5px solid ${nodeBorder(state)}`,
        borderRadius: 5,
        padding: '9px 11px',
        cursor: dragState.current ? 'grabbing' : isRoom ? 'pointer' : 'grab',
        transition: dragState.current ? 'none' : 'box-shadow 0.15s',
        boxShadow: nodeGlow(state),
        userSelect: 'none',
        opacity: state === 'neutral' ? 0.72 : 1,
      }}
      className="circuit-node group"
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
        <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.14em', fontFamily: 'monospace', fontWeight: 700, color: TYPE_LABEL_COLOR[type] }}>
          {type}
        </span>
        <span
          className={dot.cls}
          style={{ width: 8, height: 8, borderRadius: '50%', background: dot.bg, boxShadow: `0 0 6px ${dot.bg}99`, display: 'inline-block' }}
        />
      </div>

      {/* Title */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 2 }}>
        {title}
      </div>

      {/* Summary */}
      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 6 }}>
        {summary}
      </div>

      {/* Footer chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {chips.map((chip, i) => (
          <span
            key={i}
            style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '1px 5px', borderRadius: 3, ...chipStyle(chip.variant) }}
          >
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Dynamic edge SVG layer ───────────────────────────────────────────────────

function DynamicEdges({ nodes, edges }: { nodes: Map<string, NodeDef>; edges: EdgeDef[] }) {
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      <defs>
        <marker id="a-coord" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,1L5,3L0,5Z" fill="#3b82f6" opacity="0.85"/></marker>
        <marker id="a-part"  markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,1L5,3L0,5Z" fill="#6b7280" opacity="0.7"/></marker>
        <marker id="a-owns"  markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,1L5,3L0,5Z" fill="#22c55e" opacity="0.8"/></marker>
        <marker id="a-queue" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,1L5,3L0,5Z" fill="#6b7280" opacity="0.55"/></marker>
        <marker id="a-audit" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0.5L4,2.5L0,4.5Z" fill="#9ca3af" opacity="0.6"/></marker>
      </defs>
      {edges.map((edge, i) => {
        const fromNode = nodes.get(edge.from)
        const toNode   = nodes.get(edge.to)
        if (!fromNode || !toNode) return null
        const [x1, y1] = nodePt(fromNode, 'bottom')
        const [x2, y2] = nodePt(toNode,   'top')
        const d = routeEdge(x1, y1, x2, y2)
        if (edge.style === 'coord') {
          return <path key={i} className="e-flow"      d={d} stroke="#3b82f6" strokeWidth="1.5" fill="none" opacity="0.75" markerEnd="url(#a-coord)" />
        }
        if (edge.style === 'part') {
          return <path key={i} className="e-flow"      d={d} stroke="#6b7280" strokeWidth="1.2" fill="none" opacity="0.6"  markerEnd="url(#a-part)"  />
        }
        if (edge.style === 'owns') {
          return <path key={i} className="e-flow-slow" d={d} stroke="#22c55e" strokeWidth="1.2" fill="none" opacity="0.7"  markerEnd="url(#a-owns)"  />
        }
        if (edge.style === 'queued') {
          return <path key={i} d={d} stroke="#6b7280" strokeWidth="1" strokeDasharray="4 4" fill="none" opacity="0.4" markerEnd="url(#a-queue)" />
        }
        return <path key={i} d={d} stroke="#9ca3af" strokeWidth="1" strokeDasharray="2 4" fill="none" opacity="0.5" markerEnd="url(#a-audit)" />
      })}
    </svg>
  )
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  const rows: { stroke: string; width: number; dash?: string; label: string }[] = [
    { stroke: '#3b82f6', width: 1.5,             label: 'coordinates  ▶ animated'  },
    { stroke: '#6b7280', width: 1.2,             label: 'participating ▶ animated' },
    { stroke: '#22c55e', width: 1.2,             label: 'owns active  ▶ animated'  },
    { stroke: '#6b7280', width: 1,   dash: '4 4', label: 'queued / pending'         },
    { stroke: '#9ca3af', width: 1,   dash: '2 4', label: 'audit schedule'           },
  ]

  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 200,
      background: 'var(--panel)', border: '1px solid var(--border-soft)',
      borderRadius: 6, padding: '10px 14px',
      fontSize: 10, fontFamily: 'monospace',
      display: 'flex', flexDirection: 'column', gap: 5,
      boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
    }}>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 3 }}>Edges</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <svg width="30" height="8" style={{ flexShrink: 0 }}>
            <path d="M0,4 H30" stroke={r.stroke} strokeWidth={r.width} strokeDasharray={r.dash} fill="none"/>
          </svg>
          <span style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{r.label}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

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

interface CircuitViewProps {
  onNavigate?: (href: string) => void
}

export function CircuitView({ onNavigate }: CircuitViewProps) {
  const viewportHook = useCanvasViewport()
  const { dragHandlers, touchHandlers } = viewportHook
  const { positions, updatePosition } = useCanvasLayout()
  const queryClient = useQueryClient()
  const canvasRef = useRef<HTMLDivElement>(null)

  // Attach a non-passive wheel listener so preventDefault() actually works.
  // React's synthetic onWheel is passive in some environments, letting the page scroll.
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

  const { data: agentRegistry = [] } = useQuery({
    queryKey: ['agent-registry', 'circuit'],
    queryFn: fetchAgentRegistry,
    refetchInterval: 30_000,
  })

  const { data: healthData = [] } = useQuery({
    queryKey: ['agents', 'health'],
    queryFn: fetchAgents,
    refetchInterval: 30_000,
  })

  const { data: runtimeOverview } = useQuery({
    queryKey: ['runtime-overview'],
    queryFn: fetchRuntimeOverview,
    refetchInterval: 30_000,
  })

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

  const { data: delegations = [] } = useQuery({
    queryKey: ['runtime-delegations'],
    queryFn: () => fetchRuntimeDelegations(),
    refetchInterval: 15_000,
  })

  const { data: auditLoops = [] } = useQuery({
    queryKey: ['runtime-audit-loops'],
    queryFn: fetchRuntimeAuditLoops,
    refetchInterval: 30_000,
  })

  const healthMap = useMemo(
    () => new Map(healthData.map(h => [h.agent.toLowerCase(), h.healthy])),
    [healthData],
  )

  const primeName = runtimeOverview?.prime?.name ?? 'Prime'

  const { nodes, edges } = useMemo(
    () => buildGraph(primeName, agentRegistry, threads, workItems, delegations, auditLoops, healthMap),
    [primeName, agentRegistry, threads, workItems, delegations, auditLoops, healthMap],
  )

  // Merge persisted positions into graph nodes
  const mergedNodes = useMemo(() => {
    const result = new Map<string, NodeDef>()
    for (const [id, node] of nodes) {
      const saved = positions[id]
      result.set(id, saved ? { ...node, x: saved.x, y: saved.y } : node)
    }
    return result
  }, [nodes, positions])

  return (
    <div
      ref={canvasRef}
      style={{ ...GRID_BG, flex: 1, overflow: 'hidden', position: 'relative', touchAction: 'none' }}
      tabIndex={0}
      {...dragHandlers}
      {...touchHandlers}
    >
      {/* Canvas controls — pointer-isolated so drag-pan doesn't capture their clicks */}
      <div
        className="absolute top-4 right-4 z-50"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <CircuitCanvasControls
          viewport={viewportHook}
          compact
        />
      </div>

      <div
        style={{
          position: 'relative',
          width: CANVAS_W,
          height: CANVAS_H,
          transform: viewportHook.getTransformStyle(),
          transformOrigin: '0 0',
        }}
      >
        <DynamicEdges nodes={mergedNodes} edges={edges} />
        {Array.from(mergedNodes.values()).map((node) => (
          <CircuitNode
            key={node.id}
            {...node}
            onRoomClick={node.type === 'room' && onNavigate ? () => onNavigate('/') : undefined}
            onPositionChange={updatePosition}
          />
        ))}
      </div>

      {/* Bottom action toolbar — pointer-isolated so setPointerCapture on canvas doesn't eat button clicks */}
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

      <Legend />

      {showGoalModal && (
        <NewGoalModal
          onClose={() => setShowGoalModal(false)}
          onCreated={(result) => {
            setShowGoalModal(false)
            queryClient.invalidateQueries({ queryKey: ['threads'] })
            queryClient.invalidateQueries({ queryKey: ['runtime-work-items'] })
            if (result.thread_id && onNavigate) {
              onNavigate(`/rooms/${result.thread_id}`)
            }
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
