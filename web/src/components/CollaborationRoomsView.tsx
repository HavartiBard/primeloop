import { useMemo, useState } from 'react'
import type { RegistryAgent, RuntimeAuditLoop, RuntimeDelegation, RuntimeThread, RuntimeWorkItem } from '../types'

type AgentHealth = {
  agent: string
  last_seen: string
  healthy: boolean
}

type CollaborationRoomsViewProps = {
  chiefName: string
  connected: boolean
  agents: RegistryAgent[]
  healthData: AgentHealth[]
  workItems: RuntimeWorkItem[]
  delegations: RuntimeDelegation[]
  threads: RuntimeThread[]
  pendingApprovals: number
  auditLoops: RuntimeAuditLoop[]
}

type RoomState = 'active' | 'attention' | 'blocked' | 'archived'
type FilterTab = 'active' | 'blocked' | 'all' | 'archived'

type RoomView = {
  id: string
  title: string
  state: RoomState
  lane: string
  summary: string
  lastUpdated: string
  activityScore: number
  participants: string[]
  messages: Array<{ speaker: string; text: string; at: string }>
  workItems: RuntimeWorkItem[]
  delegations: RuntimeDelegation[]
}

// ─── Sample data ───────────────────────────────────────────────────────────

const SAMPLE_MESSAGES = [
  [
    { speaker: 'chief',  at: '10:12', text: 'Locking scope to websocket reconnect and retry state. Rollback path must stay clear.' },
    { speaker: 'builder',at: '10:14', text: 'Patch branch open. Narrowed to three files in the reconnect layer.' },
    { speaker: 'verify', at: '10:16', text: 'Smoke suite queued against staging. Will flag any regression before merge.' },
  ],
  [
    { speaker: 'ops',    at: '10:18', text: 'Provider latency spike detected — holding downstream delegations until stable.' },
    { speaker: 'chief',  at: '10:19', text: 'Agreed. Freeze new work in this room. Surface the incident trace first.' },
    { speaker: 'system', at: '10:21', text: 'Blocked: Collect provider incident traces' },
  ],
  [
    { speaker: 'verify', at: '10:23', text: 'Artifact bundle received. Running full verification pass now.' },
    { speaker: 'builder',at: '10:24', text: 'Diff is clean. No unexpected boundary changes in the capability contract.' },
    { speaker: 'chief',  at: '10:25', text: 'Good. Promote to release queue once smoke checks pass.' },
  ],
]

const SAMPLE_ROOMS = [
  { id: 'sr-release',  title: 'Release coordination', lane: 'implementation', state: 'active'    as RoomState, lastUpdated: '10:21', participants: ['chief','builder','verify','ops'] },
  { id: 'sr-provider', title: 'Provider incident',    lane: 'incident',        state: 'blocked'   as RoomState, lastUpdated: '10:23', participants: ['chief','ops','review'] },
  { id: 'sr-verify',   title: 'Verification lane',    lane: 'verification',    state: 'attention' as RoomState, lastUpdated: '10:19', participants: ['verify','review','builder'] },
  { id: 'sr-infra',    title: 'Infra audit Q1',       lane: 'audit',           state: 'archived'  as RoomState, lastUpdated: '09:44', participants: ['ops','review'] },
]

// ─── Helpers ───────────────────────────────────────────────────────────────

function laneLabel(value: string) {
  return value.split(/[-_ ]+/).filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1)).join(' ')
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function formatShortTime(iso?: string): string {
  if (!iso) return '--:--'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '--:--'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function stateLabel(state: RoomState): string {
  if (state === 'attention') return 'running'
  if (state === 'archived') return 'closed'
  return state
}

function stateDot(state: RoomState): string {
  if (state === 'active')    return 'bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.65)]'
  if (state === 'attention') return 'bg-cyan-400 shadow-[0_0_7px_rgba(34,211,238,0.65)] animate-pulse'
  if (state === 'blocked')   return 'bg-red-400 shadow-[0_0_7px_rgba(248,113,113,0.65)] animate-pulse'
  return 'bg-gray-400'
}

function stateChip(state: RoomState): string {
  if (state === 'active')    return 'text-[var(--s-ok-tx)] bg-[var(--s-ok-bg)] border-[var(--s-ok-bd)]'
  if (state === 'attention') return 'text-[var(--s-run-tx)] bg-[var(--s-run-bg)] border-[var(--s-run-bd)]'
  if (state === 'blocked')   return 'text-[var(--s-blk-tx)] bg-[var(--s-blk-bg)] border-[var(--s-blk-bd)]'
  return 'text-[var(--s-neu-tx)] bg-[var(--s-neu-bg)] border-[var(--s-neu-bd)]'
}

function stateStatusBg(state: RoomState): string {
  if (state === 'active')    return 'border-[var(--s-ok-bd)] bg-[var(--s-ok-bg)]'
  if (state === 'attention') return 'border-[var(--s-run-bd)] bg-[var(--s-run-bg)]'
  if (state === 'blocked')   return 'border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)]'
  return 'border-[var(--s-neu-bd)] bg-[var(--s-neu-bg)]'
}

function stateLeftBorderColor(state: RoomState): string {
  if (state === 'active')    return '#4ade80'
  if (state === 'attention') return '#22d3ee'
  if (state === 'blocked')   return '#f87171'
  return '#6b7280'
}

function filterTabCls(current: FilterTab, tab: FilterTab): string {
  if (current !== tab) return 'border-transparent text-[var(--muted)] hover:bg-[var(--panel-subtle)]'
  if (tab === 'active')   return 'border-[var(--s-ok-bd)] bg-[var(--s-ok-bg)] text-[var(--s-ok-tx)]'
  if (tab === 'blocked')  return 'border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)] text-[var(--s-blk-tx)]'
  if (tab === 'archived') return 'border-[var(--s-neu-bd)] bg-[var(--s-neu-bg)] text-[var(--s-neu-tx)]'
  return 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-400'
}

function speakerCls(speaker: string): string {
  if (speaker === 'chief')  return 'text-violet-400'
  if (speaker === 'system') return 'text-[var(--s-blk-tx)]'
  return 'text-[var(--terminal-speaker)]'
}

// ─── Data derivation ───────────────────────────────────────────────────────

function roomStateFromThread(
  thread: RuntimeThread,
  items: RuntimeWorkItem[],
  delegs: RuntimeDelegation[],
): RoomState {
  if (thread.status === 'closed') return 'archived'
  if (items.some((i) => i.status === 'blocked')) return 'blocked'
  if (delegs.some((d) => d.status === 'queued' || d.status === 'running')) return 'attention'
  if (items.some((i) => i.status === 'active')) return 'active'
  return 'archived'
}

function derivedMessages(
  items: RuntimeWorkItem[],
  delegs: RuntimeDelegation[],
  agents: RegistryAgent[],
  fallbackIdx: number,
): Array<{ speaker: string; text: string; at: string }> {
  const msgs: Array<{ speaker: string; text: string; at: string; _ts: string }> = []

  for (const item of items) {
    if (item.status === 'active') {
      msgs.push({ speaker: item.owner_label || 'worker', text: `Working on: ${item.title}`, at: formatShortTime(item.updated_at ?? item.created_at), _ts: item.updated_at ?? item.created_at ?? '' })
    } else if (item.status === 'blocked') {
      msgs.push({ speaker: 'system', text: `Blocked: ${item.title}`, at: formatShortTime(item.updated_at ?? item.created_at), _ts: item.updated_at ?? item.created_at ?? '' })
    }
  }
  for (const d of delegs) {
    if (d.status === 'running') {
      const name = agents.find((a) => a.id === d.to_agent_id)?.name ?? 'agent'
      msgs.push({ speaker: name, text: `Delegated: ${laneLabel(d.capability)}`, at: formatShortTime(d.updated_at ?? d.created_at), _ts: d.updated_at ?? d.created_at ?? '' })
    }
  }

  msgs.sort((a, b) => b._ts.localeCompare(a._ts))
  const result = msgs.slice(0, 8).map(({ speaker, text, at }) => ({ speaker, text, at }))
  return result.length >= 2 ? result : SAMPLE_MESSAGES[fallbackIdx % SAMPLE_MESSAGES.length]
}

function derivedSummary(items: RuntimeWorkItem[], delegs: RuntimeDelegation[], agents: RegistryAgent[], signal?: string): string {
  if (signal) return signal
  const blocked = items.find((i) => i.status === 'blocked')
  if (blocked) return truncate(`Blocked on: ${blocked.title}`, 52)
  const running = delegs.find((d) => d.status === 'running')
  if (running) {
    const name = agents.find((a) => a.id === running.to_agent_id)?.name ?? 'agent'
    return truncate(`Delegating: ${laneLabel(running.capability)} to ${name}`, 52)
  }
  const active = items.find((i) => i.status === 'active')
  if (active) return truncate(`Active: ${active.title}`, 52)
  return `${items.length} tracked item${items.length === 1 ? '' : 's'} in coordination.`
}

function buildFallbackRooms(): RoomView[] {
  return SAMPLE_ROOMS.map((room, idx) => ({
    id: room.id,
    title: room.title,
    state: room.state,
    lane: laneLabel(room.lane),
    lastUpdated: room.lastUpdated,
    summary: idx === 0 ? 'Active: Patch websocket reconnection flow'
           : idx === 1 ? 'Blocked on: Collect provider incident traces'
           : idx === 2 ? 'Delegating: Verification to verify'
           : 'Closed — archived Q1',
    activityScore: room.state === 'blocked' ? 40 : room.state === 'attention' ? 28 : room.state === 'active' ? 20 : 0,
    participants: room.participants,
    messages: SAMPLE_MESSAGES[idx % SAMPLE_MESSAGES.length],
    workItems: [
      { id: `sw-${idx}-1`, thread_id: room.id, owner_agent_id: 'a1', owner_label: room.participants[1] ?? 'builder', lane: room.lane, title: idx === 0 ? 'Patch websocket reconnection flow' : idx === 1 ? 'Collect provider incident traces' : idx === 2 ? 'Run verification bundle' : 'Audit report', status: room.state === 'blocked' ? 'blocked' : 'active', priority: 'high', metadata: {}, created_at: '', updated_at: '' },
      { id: `sw-${idx}-2`, thread_id: room.id, owner_agent_id: 'a2', owner_label: room.participants[2] ?? 'verify',  lane: room.lane, title: idx === 0 ? 'Review deployment checklist' : idx === 1 ? 'Hold escalation notes' : idx === 2 ? 'Publish artifact summary' : 'Close thread', status: 'queued', priority: 'medium', metadata: {}, created_at: '', updated_at: '' },
    ],
    delegations: [
      { id: `sd-${idx}-1`, work_item_id: `sw-${idx}-1`, to_agent_id: 'a1', capability: 'implementation', status: 'running', request: {}, result: {}, trace: [], created_at: '', updated_at: '' },
      { id: `sd-${idx}-2`, work_item_id: `sw-${idx}-2`, to_agent_id: 'a2', capability: 'verification',   status: room.state === 'blocked' ? 'queued' : 'running', request: {}, result: {}, trace: [], created_at: '', updated_at: '' },
    ],
  }))
}

function buildSignalRows(room: RoomView, connected: boolean, pendingApprovals: number, auditLoops: RuntimeAuditLoop[]) {
  const blocked = room.workItems.filter((i) => i.status === 'blocked').length
  const running = room.delegations.filter((d) => d.status === 'running').length
  return [
    { label: 'Feed',         value: connected ? 'Streaming' : 'Polling',  hi: connected },
    { label: 'Lane',         value: room.lane,                             hi: false },
    { label: 'Participants', value: `${room.participants.length}`,          hi: false },
    { label: 'Blocked',      value: `${blocked}`,                          hi: blocked > 0 },
    { label: 'Running',      value: `${running}`,                          hi: false },
    { label: 'Approvals',    value: `${pendingApprovals}`,                 hi: pendingApprovals > 0 },
    { label: 'Audits',       value: `${auditLoops.length}`,                hi: false },
  ]
}

// ─── Component ─────────────────────────────────────────────────────────────

const GRID_BG = {
  backgroundImage: [
    'linear-gradient(var(--canvas-grid-major) 1px, transparent 1px)',
    'linear-gradient(90deg, var(--canvas-grid-major) 1px, transparent 1px)',
    'linear-gradient(var(--canvas-grid-minor) 1px, transparent 1px)',
    'linear-gradient(90deg, var(--canvas-grid-minor) 1px, transparent 1px)',
  ].join(', '),
  backgroundSize: '120px 120px, 120px 120px, 24px 24px, 24px 24px',
}

export function CollaborationRoomsView({
  connected,
  agents,
  healthData,
  workItems,
  delegations,
  threads,
  pendingApprovals,
  auditLoops,
}: CollaborationRoomsViewProps) {
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterTab>('active')
  const [search, setSearch] = useState('')
  const [termExpanded, setTermExpanded] = useState(true)

  const rooms = useMemo<RoomView[]>(() => {
    if (threads.length === 0) return buildFallbackRooms()

    const healthByName = new Map(healthData.map((e) => [e.agent.toLowerCase(), e]))

    return threads.map((thread, idx) => {
      const items = workItems.filter((i) => i.thread_id === thread.id)
      const delegs = delegations.filter((d) => d.work_item_id && items.some((i) => i.id === d.work_item_id))
      const state = roomStateFromThread(thread, items, delegs)

      const participants = Array.from(new Set([
        ...items.map((i) => i.owner_label).filter(Boolean) as string[],
        ...delegs.map((d) => agents.find((a) => a.id === d.to_agent_id)?.name).filter(Boolean) as string[],
      ])).slice(0, 6)

      const degraded = participants.map((p) => healthByName.get(p.toLowerCase())).filter((h) => h?.healthy === false).map((h) => `${h!.agent} degraded`)

      const allTs = [...items.map((i) => i.updated_at ?? i.created_at), ...delegs.map((d) => d.updated_at ?? d.created_at)].filter(Boolean) as string[]
      allTs.sort((a, b) => b.localeCompare(a))
      const lastUpdated = formatShortTime(allTs[0])

      const blocked  = items.filter((i) => i.status === 'blocked').length
      const active   = items.filter((i) => i.status === 'active').length

      return {
        id: thread.id,
        title: truncate(thread.title || 'Untitled room', 40),
        state,
        lane: laneLabel(items[0]?.lane ?? 'intake'),
        summary: derivedSummary(items, delegs, agents, degraded[0]),
        lastUpdated,
        activityScore: blocked * 20 + delegs.length * 8 + active * 6 + (state === 'attention' ? 4 : 0),
        participants,
        messages: derivedMessages(items, delegs, agents, idx),
        workItems: items,
        delegations: delegs,
      } satisfies RoomView
    }).sort((a, b) => b.activityScore - a.activityScore)
  }, [agents, delegations, healthData, threads, workItems])

  const filteredRooms = useMemo(() => {
    let list = rooms
    if (filter === 'active')   list = list.filter((r) => r.state === 'active' || r.state === 'attention')
    if (filter === 'blocked')  list = list.filter((r) => r.state === 'blocked')
    if (filter === 'archived') list = list.filter((r) => r.state === 'archived')
    if (search) {
      const q = search.toLowerCase()
      list = list.filter((r) => r.title.toLowerCase().includes(q) || r.lane.toLowerCase().includes(q))
    }
    return list
  }, [rooms, filter, search])

  const selectedRoom = filteredRooms.find((r) => r.id === selectedRoomId) ?? filteredRooms[0]

  const signalRows  = selectedRoom ? buildSignalRows(selectedRoom, connected, pendingApprovals, auditLoops) : []
  const activeAgents = selectedRoom
    ? Array.from(new Set([...selectedRoom.workItems.map((i) => i.owner_label).filter(Boolean) as string[], ...selectedRoom.participants]))
    : []
  const artifactRows = selectedRoom
    ? [
        ...selectedRoom.workItems.slice(0, 5).map((i) => ({ id: i.id, title: i.title, meta: `${i.owner_label} · ${laneLabel(i.lane)} · ${laneLabel(i.status)}`, type: 'workItem' as const })),
        ...selectedRoom.delegations.slice(0, 4).map((d) => ({ id: d.id, title: `${laneLabel(d.capability)} bundle`, meta: `${laneLabel(d.status)} delegation`, type: 'delegation' as const })),
      ]
    : []

  return (
    <div className="flex h-full min-h-0" style={GRID_BG}>

      {/* ── Left: Room list panel ─────────────────────────────────────── */}
      <div className="flex w-[360px] shrink-0 flex-col border-r border-[var(--border-soft)] bg-[var(--panel)]">

        {/* Panel header */}
        <div className="shrink-0 border-b border-[var(--border-soft)] px-[18px] py-[14px]">
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-sm uppercase tracking-widest text-[var(--muted)]">Rooms</span>
            <span className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2.5 py-0.5 font-mono text-xs text-[var(--muted)]">
              {filteredRooms.length}
            </span>
          </div>

          {/* Filter tabs */}
          <div className="mb-2.5 flex gap-1.5">
            {(['active','blocked','all','archived'] as FilterTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition ${filterTabCls(filter, tab)}`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            className="w-full rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-2 font-mono text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--sel-bd)]"
            placeholder="search rooms…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Room rows */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filteredRooms.length === 0 && (
            <div className="px-5 py-8 font-mono text-xs text-[var(--muted)]">no rooms match</div>
          )}
          {filteredRooms.map((room) => (
            <button
              key={room.id}
              type="button"
              onClick={() => setSelectedRoomId(room.id)}
              className={`relative flex w-full items-center gap-2.5 px-[18px] py-[11px] text-left transition hover:bg-[var(--panel-subtle)] ${selectedRoom?.id === room.id ? 'bg-[var(--sel-bg)]' : ''} ${room.state === 'archived' ? 'opacity-50' : ''}`}
            >
              {selectedRoom?.id === room.id && (
                <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r bg-[var(--sel-bd)]" />
              )}
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stateDot(room.state)}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-[var(--text)]">{room.title}</div>
                <div className="mt-0.5 font-mono text-xs text-[var(--muted)]">updated {room.lastUpdated}</div>
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide ${stateChip(room.state)}`}>
                {stateLabel(room.state)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: Workspace ──────────────────────────────────────────── */}
      {selectedRoom ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--panel)]">

          {/* Workspace header */}
          <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border-soft)] px-5 py-3.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${stateDot(selectedRoom.state)}`} />
            <span className="flex-1 text-lg font-semibold text-[var(--text)]">{selectedRoom.title}</span>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide ${stateChip(selectedRoom.state)}`}>
              {stateLabel(selectedRoom.state)}
            </span>
            <span className="ml-2 shrink-0 font-mono text-sm text-[var(--muted)]">{selectedRoom.lane} · {selectedRoom.lastUpdated}</span>
          </div>

          {/* Workspace body */}
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px]">

            {/* Chat column */}
            <div className="flex min-h-0 flex-col border-r border-[var(--border-soft)]">

              {/* Messages */}
              <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--panel-subtle)] px-[18px] py-4">
                <div className="flex flex-col gap-1.5 font-mono text-sm">
                  {selectedRoom.messages.map((msg, i) => (
                    <div key={`${selectedRoom.id}-${i}`} className="grid gap-2.5" style={{ gridTemplateColumns: '50px 100px 1fr' }}>
                      <span className="text-[var(--terminal-time)]">{msg.at}</span>
                      <span className={speakerCls(msg.speaker)}>&lt;{msg.speaker}&gt;</span>
                      <span className={msg.speaker === 'system' ? 'text-[var(--s-blk-tx)]' : 'text-[var(--text)]'}>{msg.text}</span>
                    </div>
                  ))}
                  {/* Live working indicator */}
                  <div className="mt-1 grid gap-2.5 text-[var(--terminal-working)]" style={{ gridTemplateColumns: '50px 100px 1fr' }}>
                    <span>now</span>
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--terminal-working-label)]" />
                      &lt;worker&gt;
                    </span>
                    <span>$ Working... (2m 14s)</span>
                  </div>
                </div>
              </div>

              {/* Terminal pane */}
              <div
                className="shrink-0 overflow-hidden transition-[height] duration-200"
                style={{ height: termExpanded ? 200 : 36, background: '#090b0e', borderTop: '1px solid rgba(255,255,255,0.08)' }}
              >
                <div
                  className="flex cursor-pointer select-none items-center gap-2.5 px-3.5 py-2"
                  onClick={() => setTermExpanded((v) => !v)}
                >
                  <div className="flex gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                  </div>
                  <span className="font-mono text-[11px] uppercase tracking-widest text-[#6e7681]">
                    Agent activity — {selectedRoom.participants[0] ?? 'ops'}
                  </span>
                  <span className="ml-auto text-[11px] text-[#6e7681]">{termExpanded ? '▲' : '▼'}</span>
                </div>

                {termExpanded && (
                  <div className="h-[calc(100%-36px)] overflow-y-auto px-3.5 pb-2 font-mono text-[13px] leading-relaxed">
                    <div className="flex gap-2.5"><span className="text-[#58a6ff]">ops $</span><span className="text-[#79c0ff]">curl -s https://provider.api/health</span></div>
                    <div className="pl-4 text-[#c9d1d9]">{'{"status":"degraded","latency_p99":4821,"errors":14}'}</div>
                    <div className="mt-1.5 flex gap-2.5"><span className="text-[#58a6ff]">ops $</span><span className="text-[#79c0ff]">tail -n 50 /var/log/provider-gateway.log | grep ERROR</span></div>
                    <div className="pl-4 text-[#f85149]">ERROR 10:21:03 connection pool exhausted (max=128)</div>
                    <div className="pl-4 text-[#f85149]">ERROR 10:21:07 upstream timeout after 5000ms (retry 3/3)</div>
                    <div className="mt-1.5 flex gap-2.5"><span className="text-[#58a6ff]">ops $</span><span className="text-[#79c0ff]">kubectl get pods -n gateway | grep -v Running</span></div>
                    <div className="pl-4 text-[#c9d1d9]">gateway-worker-7d9f   0/1   CrashLoopBackOff   7   18m</div>
                    <div className="mt-1.5 flex gap-2.5"><span className="text-[#58a6ff]">ops $</span><span className="text-[#d29922]">▌</span></div>
                  </div>
                )}
              </div>

              {/* Chat input */}
              <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3">
                <input
                  className="flex-1 rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-2 font-mono text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--sel-bd)]"
                  placeholder="$ message room or @agent…"
                />
                <button
                  type="button"
                  className="shrink-0 rounded border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-4 py-2 font-mono text-xs uppercase tracking-wide text-blue-400 transition hover:bg-blue-500/20"
                >
                  Send ↵
                </button>
              </div>
            </div>

            {/* Right data column */}
            <div className="flex min-h-0 flex-col overflow-hidden">

              {/* Status */}
              <div
                className="shrink-0 border-b border-[var(--border-soft)] px-[18px] py-3.5"
                style={{ borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: stateLeftBorderColor(selectedRoom.state) }}
              >
                <div className="mb-2.5 font-mono text-[11px] uppercase tracking-widest text-[var(--muted)]">Status</div>
                <div className={`mb-3 flex items-center gap-2.5 rounded border px-3 py-2 ${stateStatusBg(selectedRoom.state)}`}>
                  <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wide font-semibold ${stateChip(selectedRoom.state)}`}>
                    {stateLabel(selectedRoom.state)}
                  </span>
                  <span className="text-sm text-[var(--muted)]">{selectedRoom.lane}</span>
                </div>
                <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-[var(--muted)]">Participants</div>
                <div className="flex flex-wrap gap-1.5">
                  {activeAgents.map((agent) => (
                    <span
                      key={`${selectedRoom.id}-p-${agent}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2.5 py-1 font-mono text-xs text-[var(--muted)]"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      {agent}
                    </span>
                  ))}
                </div>
              </div>

              {/* Signals */}
              <div className="min-h-0 flex-1 overflow-hidden border-b border-[var(--border-soft)] px-[18px] py-3.5">
                <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-[var(--muted)]">Signals</div>
                <div className="overflow-y-auto">
                  {signalRows.map((sig, idx) => (
                    <div
                      key={`${selectedRoom.id}-s-${sig.label}`}
                      className={`flex items-center justify-between py-1.5 ${idx < signalRows.length - 1 ? 'border-b border-[var(--border-soft)]' : ''}`}
                    >
                      <span className="font-mono text-xs uppercase tracking-wide text-[var(--muted)]">{sig.label}</span>
                      <span className={`font-mono text-sm ${sig.hi ? 'text-[var(--s-blk-tx)]' : 'text-[var(--text)]'}`}>{sig.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Artifacts */}
              <div className="min-h-0 flex-1 overflow-hidden px-[18px] py-3.5">
                <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-[var(--muted)]">Artifacts</div>
                <div className="overflow-y-auto">
                  {artifactRows.map((art) => (
                    <div
                      key={`${selectedRoom.id}-a-${art.id}`}
                      className="flex items-baseline gap-2 border-b border-[var(--border-soft)] py-1.5 last:border-0"
                    >
                      <span className="shrink-0 text-[11px] text-[var(--muted)]">{art.type === 'delegation' ? '◦' : '▪'}</span>
                      <div className="min-w-0">
                        <div className="truncate text-sm text-[var(--text)]">{art.title}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">{art.meta}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[var(--muted)]">
          <span className="font-mono text-xs uppercase tracking-widest">select a room</span>
        </div>
      )}
    </div>
  )
}
