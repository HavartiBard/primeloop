// ─── Types ────────────────────────────────────────────────────────────────────

type NodeType  = 'agent' | 'room' | 'work' | 'approval' | 'tool' | 'system'
type NodeState = 'active' | 'running' | 'blocked' | 'approval' | 'neutral' | 'system'

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
  status: { label: string; variant: 'ok' | 'run' | 'blk' | 'att' | 'neu' }
  wide?: boolean
}

// ─── Static mock graph ────────────────────────────────────────────────────────

const NODES: NodeDef[] = [
  // Row 1 — Chief coordinator
  { id: 'chief', type: 'agent', state: 'active', x: 576, y: 48, wide: false,
    title: 'Chief of Staff', summary: 'coordinator · delegate · approve',
    chips: [{ label: '3 active', variant: 'ok' }, { label: '1 appr', variant: 'att' }],
    status: { label: 'active', variant: 'ok' } },

  // Row 2 — Sub-agents
  { id: 'ops', type: 'agent', state: 'running', x: 96, y: 192, wide: false,
    title: 'OPS', summary: 'incident · infra · provider',
    chips: [{ label: '1 blocked', variant: 'blk' }, { label: '1 run', variant: 'run' }],
    status: { label: 'running', variant: 'run' } },

  { id: 'builder', type: 'agent', state: 'active', x: 544, y: 192, wide: false,
    title: 'Builder', summary: 'impl · patch · thread-4a2',
    chips: [{ label: '1 active', variant: 'ok' }],
    status: { label: 'active', variant: 'ok' } },

  { id: 'reviewer', type: 'agent', state: 'active', x: 976, y: 192, wide: false,
    title: 'Reviewer', summary: 'review · verify · approve',
    chips: [{ label: '2 active', variant: 'ok' }],
    status: { label: 'active', variant: 'ok' } },

  // Row 3 — Rooms (wide: 192px)
  { id: 'room-provider', type: 'room', state: 'blocked', x: 96, y: 336, wide: true,
    title: 'Provider Incident', summary: 'infra instability · downstream blk',
    chips: [{ label: '1 blocked', variant: 'blk' }, { label: '1 appr', variant: 'att' }],
    status: { label: 'blocked', variant: 'blk' } },

  { id: 'room-release', type: 'room', state: 'running', x: 544, y: 336, wide: true,
    title: 'Release Coord', summary: 'websocket patch · deploy pipeline',
    chips: [{ label: '2 active', variant: 'ok' }, { label: '1 queued', variant: 'run' }],
    status: { label: 'running', variant: 'run' } },

  { id: 'room-verify', type: 'room', state: 'active', x: 976, y: 336, wide: true,
    title: 'Verification Lane', summary: 'artifact check · smoke suite',
    chips: [{ label: '1 active', variant: 'ok' }],
    status: { label: 'active', variant: 'ok' } },

  // Row 4 — Work + Approval
  { id: 'work-traces', type: 'work', state: 'blocked', x: 96, y: 480, wide: false,
    title: 'Collect traces', summary: 'ops · incident · provider',
    chips: [{ label: 'blocked', variant: 'blk' }],
    status: { label: 'blocked', variant: 'blk' } },

  { id: 'approval-fix', type: 'approval', state: 'approval', x: 320, y: 480, wide: false,
    title: 'Provider Fix', summary: 'gates trace work · chief review',
    chips: [{ label: 'gating', variant: 'att' }],
    status: { label: 'pending', variant: 'att' } },

  { id: 'work-patch', type: 'work', state: 'active', x: 544, y: 480, wide: false,
    title: 'Patch websocket', summary: 'builder · impl · branch open',
    chips: [{ label: 'active', variant: 'ok' }, { label: '4a2f' }],
    status: { label: 'active', variant: 'ok' } },

  { id: 'work-deploy', type: 'work', state: 'running', x: 752, y: 480, wide: false,
    title: 'Deploy bundle', summary: 'queued · awaiting infra gate',
    chips: [{ label: 'queued', variant: 'run' }],
    status: { label: 'queued', variant: 'run' } },

  { id: 'work-review', type: 'work', state: 'active', x: 976, y: 480, wide: false,
    title: 'Review checklist', summary: 'reviewer · verification pass',
    chips: [{ label: 'active', variant: 'ok' }],
    status: { label: 'active', variant: 'ok' } },

  // Row 5 — Tools + System
  { id: 'tool-kubectl', type: 'tool', state: 'neutral', x: 96, y: 624, wide: false,
    title: 'kubectl', summary: 'pod · log · exec access',
    chips: [{ label: 'in use' }],
    status: { label: 'tool', variant: 'neu' } },

  { id: 'tool-git', type: 'tool', state: 'neutral', x: 592, y: 624, wide: false,
    title: 'git', summary: 'patch branch · diff review',
    chips: [{ label: 'in use' }],
    status: { label: 'tool', variant: 'neu' } },

  { id: 'sys-k8s', type: 'system', state: 'system', x: 976, y: 624, wide: false,
    title: 'k8s / Infra', summary: 'gateway · memory · pod mesh',
    chips: [{ label: 'degraded', variant: 'blk' }],
    status: { label: 'degraded', variant: 'blk' } },
]

// ─── Style helpers ────────────────────────────────────────────────────────────

const TYPE_LABEL_COLOR: Record<NodeType, string> = {
  agent:    '#0891b2',
  room:     '#7c3aed',
  work:     '#15803d',
  approval: '#d97706',
  tool:     '#6b7280',
  system:   '#7c3aed',
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

function chipStyle(variant?: Chip['variant']): React.CSSProperties {
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
}

function CircuitNode({ id, type, state, x, y, wide, title, summary, chips, status, onRoomClick }: CircuitNodeProps) {
  const dot = sdotStyle(state)
  const isRoom = type === 'room'
  const width = wide ? 192 : 176
  const leftBorder = state === 'approval' ? '3px solid var(--s-att-bd)' : undefined

  return (
    <div
      onClick={isRoom && onRoomClick ? () => onRoomClick(id) : undefined}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        background: 'var(--panel)',
        border: `1.5px solid ${nodeBorder(state)}`,
        borderLeft: leftBorder ?? `1.5px solid ${nodeBorder(state)}`,
        borderRadius: 5,
        padding: '9px 11px',
        cursor: isRoom ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s, transform 0.1s',
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

      {/* Footer chips + status pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {chips.map((chip, i) => (
          <span
            key={i}
            style={{ fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '1px 5px', borderRadius: 3, ...chipStyle(chip.variant) }}
          >
            {chip.label}
          </span>
        ))}
        <span
          style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '2px 6px', borderRadius: 99, border: '1px solid', ...chipStyle(status.variant) }}
        >
          {status.label}
        </span>
      </div>
    </div>
  )
}

// ─── Edge SVG layer ───────────────────────────────────────────────────────────

function Edges() {
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      <defs>
        <marker id="a-coord"  markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,1L5,3L0,5Z" fill="#3b82f6" opacity="0.85"/></marker>
        <marker id="a-part"   markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,1L5,3L0,5Z" fill="#6b7280" opacity="0.7"/></marker>
        <marker id="a-own"    markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,1L5,3L0,5Z" fill="#6b7280" opacity="0.55"/></marker>
        <marker id="a-assign" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,1L5,3L0,5Z" fill="#0891b2" opacity="0.8"/></marker>
        <marker id="a-blk"    markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,1L6,3.5L0,6Z" fill="#ef4444"/></marker>
        <marker id="a-att"    markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,1L6,3.5L0,6Z" fill="#d97706"/></marker>
        <marker id="a-uses"   markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0.5L4,2.5L0,4.5Z" fill="#9ca3af" opacity="0.6"/></marker>
      </defs>

      {/* ── Coordinates: Chief → Rooms (blue, flowing) ── */}
      <path className="e-flow" d="M 664,144 V 240 H 192 V 336"  stroke="#3b82f6" strokeWidth="1.5" fill="none" opacity="0.75" markerEnd="url(#a-coord)"/>
      <path className="e-flow" d="M 664,144 V 320 H 640 V 336"  stroke="#3b82f6" strokeWidth="1.5" fill="none" opacity="0.75" markerEnd="url(#a-coord)"/>
      <path className="e-flow" d="M 664,144 V 240 H 1072 V 336" stroke="#3b82f6" strokeWidth="1.5" fill="none" opacity="0.75" markerEnd="url(#a-coord)"/>

      {/* ── Participating: Agent → Room (gray, flowing) ── */}
      <path className="e-flow" d="M 184,288 V 336"              stroke="#6b7280" strokeWidth="1.2" fill="none" opacity="0.6"  markerEnd="url(#a-part)"/>
      <path className="e-flow" d="M 632,288 V 336"              stroke="#6b7280" strokeWidth="1.2" fill="none" opacity="0.6"  markerEnd="url(#a-part)"/>
      <path className="e-flow" d="M 1064,288 V 336"             stroke="#6b7280" strokeWidth="1.2" fill="none" opacity="0.6"  markerEnd="url(#a-part)"/>
      {/* Reviewer → Release (secondary, static dashed) */}
      <path d="M 1064,288 V 304 H 640 V 336" stroke="#6b7280" strokeWidth="1" strokeDasharray="4 4" fill="none" opacity="0.35" markerEnd="url(#a-part)"/>

      {/* ── Owns: Room → Work ── */}
      {/* Provider → Traces (static, blocked) */}
      <path d="M 192,432 V 480"              stroke="#6b7280" strokeWidth="1"   fill="none" opacity="0.45" markerEnd="url(#a-own)"/>
      {/* Release → Patch (active, green flowing) */}
      <path className="e-flow-slow" d="M 640,432 V 480"  stroke="#22c55e" strokeWidth="1.2" fill="none" opacity="0.7"  markerEnd="url(#a-own)"/>
      {/* Release → Deploy (queued, static dashed) */}
      <path d="M 688,432 V 448 H 840 V 480"  stroke="#6b7280" strokeWidth="1"   strokeDasharray="4 4" fill="none" opacity="0.4" markerEnd="url(#a-own)"/>
      {/* Verify → Review (active, green flowing) */}
      <path className="e-flow-slow" d="M 1072,432 V 480" stroke="#22c55e" strokeWidth="1.2" fill="none" opacity="0.65" markerEnd="url(#a-own)"/>

      {/* ── Approval gate: Room:Provider → Approval node (amber, pulsing) ── */}
      <path className="e-throb-att" d="M 240,432 V 448 H 408 V 480" stroke="#d97706" strokeWidth="2" fill="none" opacity="0.9" markerEnd="url(#a-att)"/>

      {/* ── Blocked-on: Approval → Work:Traces (red, pulsing) ── */}
      <path className="e-throb-blk" d="M 320,528 H 272" stroke="#ef4444" strokeWidth="2" fill="none" opacity="0.9" markerEnd="url(#a-blk)"/>

      {/* ── Assigned: Agent → Work (cyan, dashed flowing) ── */}
      <path className="e-flow" d="M 96,240 H 80 V 480 H 96"  stroke="#0891b2" strokeWidth="1" strokeDasharray="6 5" fill="none" opacity="0.55" markerEnd="url(#a-assign)"/>
      <path className="e-flow" d="M 720,240 V 480"           stroke="#0891b2" strokeWidth="1" strokeDasharray="6 5" fill="none" opacity="0.5"  markerEnd="url(#a-assign)"/>

      {/* ── Uses: Work → Tool/System (gray dotted, static) ── */}
      <path d="M 184,576 V 624"                stroke="#9ca3af" strokeWidth="1" strokeDasharray="2 4" fill="none" opacity="0.5"  markerEnd="url(#a-uses)"/>
      <path d="M 640,576 V 592 H 680 V 624"    stroke="#9ca3af" strokeWidth="1" strokeDasharray="2 4" fill="none" opacity="0.5"  markerEnd="url(#a-uses)"/>
      <path d="M 840,576 V 608 H 1064 V 624"   stroke="#9ca3af" strokeWidth="1" strokeDasharray="3 4" fill="none" opacity="0.4"  markerEnd="url(#a-uses)"/>
    </svg>
  )
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  const rows: { stroke: string; width: number; dash?: string; label: string }[] = [
    { stroke: '#3b82f6', width: 1.5, label: 'coordinates  ▶ animated'  },
    { stroke: '#6b7280', width: 1.2, label: 'participating ▶ animated' },
    { stroke: '#22c55e', width: 1.2, label: 'owns active  ▶ animated'  },
    { stroke: '#0891b2', width: 1,   dash: '5 3', label: 'assigned  ▶ animated'    },
    { stroke: '#d97706', width: 2,   dash: '5 3', label: 'approval gate ▶ pulsing' },
    { stroke: '#ef4444', width: 2,   label: 'blocked on  ▶ pulsing'   },
    { stroke: '#9ca3af', width: 1,   dash: '2 3', label: 'uses / depends'          },
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

const CANVAS_W = 1296
const CANVAS_H = 768

const GRID_BG: React.CSSProperties = {
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
  return (
    <div style={{ ...GRID_BG, flex: 1, overflow: 'auto', position: 'relative' }}>
      <div style={{ position: 'relative', width: CANVAS_W, height: CANVAS_H }}>
        <Edges />
        {NODES.map((node) => (
          <CircuitNode
            key={node.id}
            {...node}
            onRoomClick={onNavigate ? () => onNavigate('/') : undefined}
          />
        ))}
      </div>
      <Legend />
    </div>
  )
}
