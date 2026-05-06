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

type RoomView = {
  id: string
  title: string
  state: RoomState
  lane: string
  summary: string
  activityScore: number
  metrics: string[]
  participants: string[]
  messages: Array<{ speaker: string; text: string; at: string }>
  workItems: RuntimeWorkItem[]
  delegations: RuntimeDelegation[]
}

const SAMPLE_ROOM_MESSAGES = [
  [
    { speaker: 'chief', at: '10:14', text: 'Scope the failing deploy path and keep rollback ready.' },
    { speaker: 'verify', at: '10:15', text: 'Tracing the queue now. I will post the blocked step next.' },
    { speaker: 'builder', at: '10:16', text: 'Patch path narrowed to websocket reconnect and retry state.' },
  ],
  [
    { speaker: 'chief', at: '10:18', text: 'Split investigation and patch work in this room.' },
    { speaker: 'builder', at: '10:19', text: 'Patch is in flight. Review lane will get the diff in two minutes.' },
    { speaker: 'review', at: '10:21', text: 'Watching for approval boundary changes before merge.' },
  ],
  [
    { speaker: 'chief', at: '10:22', text: 'Hold approvals here until provider health is stable.' },
    { speaker: 'ops', at: '10:23', text: 'Provider recovered. Releasing one queued delegation for validation.' },
    { speaker: 'verify', at: '10:24', text: 'Smoke checks queued and artifact bundle will follow.' },
  ],
]

const SAMPLE_ROOMS = [
  {
    id: 'sample-room-release',
    title: 'Release coordination',
    lane: 'implementation',
    state: 'active' as const,
    summary: 'Primary release room with implementation and verification handoff.',
    participants: ['chief', 'builder', 'verify', 'ops'],
    metrics: ['2 active', '0 blocked', '2 artifacts'],
  },
  {
    id: 'sample-room-provider',
    title: 'Provider incident',
    lane: 'incident',
    state: 'blocked' as const,
    summary: 'Provider-side instability is blocking downstream work and approvals.',
    participants: ['chief', 'ops', 'review'],
    metrics: ['1 blocked', '1 approval', '1 signal'],
  },
  {
    id: 'sample-room-verify',
    title: 'Verification lane',
    lane: 'verification',
    state: 'attention' as const,
    summary: 'Validation and review queue with pending signals from active agents.',
    participants: ['verify', 'review', 'builder'],
    metrics: ['1 active', '0 blocked', '3 artifacts'],
  },
]

function laneLabel(value: string) {
  return value
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value
}

function roomStateFromThread(thread: RuntimeThread, workItems: RuntimeWorkItem[], delegations: RuntimeDelegation[]): RoomState {
  if (thread.status === 'closed') return 'archived'
  const blocked = workItems.filter((item) => item.status === 'blocked').length
  const attention = delegations.filter((item) => item.status === 'queued' || item.status === 'running').length
  const active = workItems.filter((item) => item.status === 'active').length
  if (blocked > 0) return 'blocked'
  if (attention > 0) return 'attention'
  if (active > 0) return 'active'
  return 'archived'
}

function roomIndicator(state: RoomState) {
  if (state === 'active') return 'bg-emerald-500 shadow-[0_0_16px_rgba(34,197,94,0.45)]'
  if (state === 'attention') return 'bg-sky-500 animate-pulse shadow-[0_0_16px_rgba(14,165,233,0.45)]'
  if (state === 'blocked') return 'bg-rose-500 animate-pulse shadow-[0_0_16px_rgba(244,63,94,0.45)]'
  return 'bg-slate-400'
}

function stateBadge(state: RoomState) {
  if (state === 'active') return 'border-[color:var(--tone-emerald-border)] bg-[color:var(--tone-emerald-bg)] text-[color:var(--tone-emerald-text)]'
  if (state === 'attention') return 'border-[color:var(--tone-cyan-border)] bg-[color:var(--tone-cyan-bg)] text-[color:var(--tone-cyan-text)]'
  if (state === 'blocked') return 'border-[color:var(--tone-rose-border)] bg-[color:var(--tone-rose-bg)] text-[color:var(--tone-rose-text)]'
  return 'border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)]'
}

function buildFallbackRooms(): RoomView[] {
  return SAMPLE_ROOMS.map((room, index) => ({
    id: room.id,
    title: room.title,
    state: room.state,
    lane: laneLabel(room.lane),
    summary: room.summary,
    activityScore: room.state === 'blocked' ? 40 : room.state === 'attention' ? 28 : 20,
    metrics: room.metrics,
    participants: room.participants,
    messages: SAMPLE_ROOM_MESSAGES[index % SAMPLE_ROOM_MESSAGES.length],
    workItems: [
      {
        id: `sample-work-${index}-1`,
        thread_id: room.id,
        owner_agent_id: 'sample-builder',
        owner_label: room.participants[1] ?? 'builder',
        lane: room.lane,
        title: index === 0 ? 'Patch websocket reconnection flow' : index === 1 ? 'Collect provider incident traces' : 'Run verification bundle',
        status: room.state === 'blocked' ? 'blocked' : 'active',
        priority: 'high',
        metadata: {},
        created_at: '',
        updated_at: '',
      },
      {
        id: `sample-work-${index}-2`,
        thread_id: room.id,
        owner_agent_id: 'sample-verify',
        owner_label: room.participants[2] ?? 'verify',
        lane: index === 2 ? 'review' : 'verification',
        title: index === 0 ? 'Review deployment checklist' : index === 1 ? 'Hold escalation notes' : 'Publish artifact summary',
        status: room.state === 'active' ? 'review' : 'queued',
        priority: 'medium',
        metadata: {},
        created_at: '',
        updated_at: '',
      },
    ],
    delegations: [
      { id: `sample-delegation-${index}-1`, work_item_id: `sample-work-${index}-1`, to_agent_id: 'sample-builder', capability: 'implementation', status: 'running', request: {}, result: {}, trace: [], created_at: '', updated_at: '' },
      { id: `sample-delegation-${index}-2`, work_item_id: `sample-work-${index}-2`, to_agent_id: 'sample-verify', capability: 'verification', status: room.state === 'blocked' ? 'queued' : 'running', request: {}, result: {}, trace: [], created_at: '', updated_at: '' },
    ],
  }))
}

function buildSignalRows(room: RoomView, connected: boolean, pendingApprovals: number, auditLoops: RuntimeAuditLoop[]) {
  const blocked = room.workItems.filter((item) => item.status === 'blocked').length
  const running = room.delegations.filter((item) => item.status === 'running').length
  return [
    { label: 'Feed', value: connected ? 'Streaming' : 'Polling' },
    { label: 'Lane', value: room.lane },
    { label: 'Participants', value: `${room.participants.length}` },
    { label: 'Blocked', value: `${blocked}` },
    { label: 'Running', value: `${running}` },
    { label: 'Approvals', value: `${pendingApprovals}` },
    { label: 'Audits', value: `${auditLoops.length}` },
  ]
}

export function CollaborationRoomsView({
  chiefName,
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

  const rooms = useMemo(() => {
    if (threads.length === 0) return buildFallbackRooms()

    const healthByName = new Map(healthData.map((entry) => [entry.agent.toLowerCase(), entry]))

    return threads.map((thread, index) => {
      const threadWorkItems = workItems.filter((item) => item.thread_id === thread.id)
      const threadDelegations = delegations.filter((delegation) => delegation.work_item_id && threadWorkItems.some((item) => item.id === delegation.work_item_id))
      const state = roomStateFromThread(thread, threadWorkItems, threadDelegations)
      const active = threadWorkItems.filter((item) => item.status === 'active').length
      const blocked = threadWorkItems.filter((item) => item.status === 'blocked').length
      const participants = Array.from(new Set(
        threadWorkItems
          .map((item) => item.owner_label)
          .filter(Boolean)
          .concat(
            threadDelegations
              .map((delegation) => agents.find((agent) => agent.id === delegation.to_agent_id)?.name)
              .filter(Boolean) as string[],
          ),
      )).slice(0, 6)

      const participantSignals = participants.map((participant) => {
        const health = healthByName.get(participant.toLowerCase())
        return health?.healthy === false ? `${participant} degraded` : null
      }).filter(Boolean) as string[]

      return {
        id: thread.id,
        title: truncate(thread.title || 'Untitled room', 36),
        state,
        lane: laneLabel(threadWorkItems[0]?.lane ?? 'intake'),
        summary: participantSignals[0] ?? `${threadWorkItems.length} tracked item${threadWorkItems.length === 1 ? '' : 's'} in active coordination.`,
        activityScore: blocked * 20 + threadDelegations.length * 8 + active * 6 + (state === 'attention' ? 4 : 0),
        metrics: [
          `${active} active`,
          `${blocked} blocked`,
          `${threadDelegations.length} delegations`,
        ],
        participants,
        messages: SAMPLE_ROOM_MESSAGES[index % SAMPLE_ROOM_MESSAGES.length],
        workItems: threadWorkItems,
        delegations: threadDelegations,
      } satisfies RoomView
    }).sort((a, b) => b.activityScore - a.activityScore)
  }, [agents, delegations, healthData, threads, workItems])

  const selectedRoom = rooms.find((room) => room.id === (selectedRoomId ?? rooms[0]?.id)) ?? rooms[0]
  const signalRows = selectedRoom ? buildSignalRows(selectedRoom, connected, pendingApprovals, auditLoops) : []
  const activeAgents = selectedRoom
    ? Array.from(new Set(
        selectedRoom.workItems
          .map((item) => item.owner_label)
          .filter(Boolean)
          .concat(selectedRoom.participants),
      ))
    : []
  const artifactRows = selectedRoom
    ? [
        ...selectedRoom.workItems.slice(0, 5).map((item) => ({
          id: item.id,
          title: item.title,
          meta: `${item.owner_label} · ${laneLabel(item.lane)} · ${laneLabel(item.status)}`,
        })),
        ...selectedRoom.delegations.slice(0, 4).map((delegation) => ({
          id: delegation.id,
          title: `${laneLabel(delegation.capability)} bundle`,
          meta: `${laneLabel(delegation.status)} delegation`,
        })),
      ]
    : []

  return (
    <div className="h-full overflow-x-auto">
      <div
        className="relative h-full min-h-[960px] min-w-[1280px] overflow-hidden rounded-[1.25rem] border border-[var(--border-soft)]"
        style={{
          backgroundImage: [
            'linear-gradient(var(--canvas-grid-major) 1px, transparent 1px)',
            'linear-gradient(90deg, var(--canvas-grid-major) 1px, transparent 1px)',
            'linear-gradient(var(--canvas-grid-minor) 1px, transparent 1px)',
            'linear-gradient(90deg, var(--canvas-grid-minor) 1px, transparent 1px)',
            'var(--canvas-surface)',
          ].join(', '),
          backgroundSize: '120px 120px, 120px 120px, 24px 24px, 24px 24px, auto',
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(56,189,248,0.11),transparent_18%),radial-gradient(circle_at_82%_12%,rgba(251,146,60,0.08),transparent_16%),radial-gradient(circle_at_52%_78%,rgba(168,85,247,0.08),transparent_18%)]" />

        <div className="relative flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]">Collaboration Rooms</div>
            <div className="mt-1 text-sm text-[var(--muted)]">{chiefName} routes work through persistent rooms with visible status, signals, and artifacts.</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_16px_rgba(34,197,94,0.45)]' : 'bg-slate-500'}`} />
            {connected ? 'streaming' : 'polling'}
          </div>
        </div>

        <div className="grid h-[calc(100%-57px)] grid-cols-[340px_minmax(0,1fr)] gap-4 p-4">
          <div className="flex min-h-0 min-w-0 flex-col rounded-[1rem] border border-[var(--border-soft)] bg-[color-mix(in_srgb,var(--panel)_78%,transparent)] p-3 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Rooms</div>
                <div className="mt-1 text-sm text-[var(--canvas-label)]">Sorted by activity, blockers, and live delegation load.</div>
              </div>
              <div className="rounded-full border border-[var(--border-soft)] bg-[var(--canvas-chip)] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">
                {rooms.length} rooms
              </div>
            </div>

            <div className="min-h-0 space-y-2 overflow-y-auto pr-1">
              {rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => setSelectedRoomId(room.id)}
                  className={`w-full rounded-[0.95rem] border p-3 text-left transition ${selectedRoom?.id === room.id ? 'border-[color:var(--tone-cyan-border)] bg-[color:var(--tone-cyan-bg)] ring-2 ring-cyan-300/40' : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] hover:ring-1 hover:ring-[var(--border-soft)]'}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${roomIndicator(room.state)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-base font-semibold text-[var(--text)]">{room.title}</div>
                          <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">{room.lane}</div>
                        </div>
                        <div className={`rounded-full border px-2 py-1 text-[10px] uppercase tracking-[0.16em] ${stateBadge(room.state)}`}>
                          {room.state}
                        </div>
                      </div>
                      <div className="mt-2 text-xs leading-5 text-[var(--canvas-label)]">{room.summary}</div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {room.metrics.map((metric) => (
                          <span key={`${room.id}-${metric}`} className="rounded-full border border-[var(--border-soft)] bg-[var(--canvas-chip)] px-2 py-1 text-[9px] uppercase tracking-[0.12em] text-[var(--canvas-label)]">
                            {metric}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedRoom && (
            <div className="min-h-0 min-w-0 overflow-hidden rounded-[1.05rem] border border-[var(--border-soft)] bg-[color-mix(in_srgb,var(--panel)_74%,transparent)] backdrop-blur-md">
              <div className="border-b border-[var(--border-soft)] px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Room Workspace</div>
                    <div className="mt-1 text-xl font-semibold text-[var(--text)]">{selectedRoom.title}</div>
                    <div className="mt-2 text-sm text-[var(--canvas-label)]">{selectedRoom.summary}</div>
                  </div>
                  <div className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] ${stateBadge(selectedRoom.state)}`}>
                    {selectedRoom.state}
                  </div>
                </div>
              </div>

              <div className="grid h-[calc(100%-88px)] min-w-0 grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)] gap-4 p-4">
                <div className="min-h-0 min-w-0 rounded-[1rem] border border-[var(--border-soft)] bg-[var(--terminal-bg)] px-4 py-4 font-mono text-[12px] text-[var(--terminal-text)]">
                  <div className="mb-3 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] pb-3">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-[var(--terminal-accent)]">Chat</div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--terminal-time)]">irc://ops/{selectedRoom.id}</div>
                  </div>
                  <div className="h-[calc(100%-52px)] space-y-2 overflow-y-auto">
                    {selectedRoom.messages.map((message, index) => (
                      <div key={`${selectedRoom.id}-${message.speaker}-${index}`} className="grid grid-cols-[44px_84px_1fr] gap-2">
                        <span className="text-[var(--terminal-time)]">{message.at}</span>
                        <span className="text-[var(--terminal-speaker)]">&lt;{message.speaker}&gt;</span>
                        <span className="text-[var(--terminal-text)]">{message.text}</span>
                      </div>
                    ))}
                    <div className="grid grid-cols-[44px_84px_1fr] gap-2">
                      <span className="text-[var(--terminal-time)]">now</span>
                      <span className="inline-flex items-center gap-2 text-[var(--terminal-working-label)]">
                        <span className="inline-flex h-2 w-2 rounded-full bg-[var(--terminal-working-label)] animate-pulse" />
                        worker
                      </span>
                      <span className="text-[var(--terminal-working)]">working...</span>
                    </div>
                  </div>
                </div>

                <div className="grid min-h-0 min-w-0 grid-rows-[0.78fr_0.9fr_1fr] gap-3">
                  <div className="min-h-0 rounded-[0.95rem] border border-[var(--border-soft)] bg-[var(--canvas-chip)] px-3 py-3">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Status</div>
                    <div className="space-y-2">
                      <div className="rounded-[0.8rem] border border-[var(--border-soft)] bg-[color-mix(in_srgb,var(--panel)_72%,transparent)] px-3 py-2">
                        <div className="text-sm font-medium text-[var(--text)]">{laneLabel(selectedRoom.state)}</div>
                        <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">{selectedRoom.lane}</div>
                      </div>
                      <div className="rounded-[0.8rem] border border-[var(--border-soft)] bg-[color-mix(in_srgb,var(--panel)_72%,transparent)] px-3 py-2">
                        <div className="text-sm font-medium text-[var(--text)]">Participants</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {activeAgents.map((agent) => (
                            <span key={`${selectedRoom.id}-${agent}`} className="rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-[var(--canvas-label)]">
                              {agent}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 rounded-[0.95rem] border border-[var(--border-soft)] bg-[var(--canvas-chip)] px-3 py-3">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Signals</div>
                    <div className="space-y-2 overflow-y-auto pr-1">
                      {signalRows.map((signal) => (
                        <div key={`${selectedRoom.id}-${signal.label}`} className="flex items-center justify-between gap-3 rounded-[0.8rem] border border-[var(--border-soft)] bg-[color-mix(in_srgb,var(--panel)_72%,transparent)] px-3 py-2">
                          <div className="text-sm font-medium text-[var(--text)]">{signal.label}</div>
                          <div className="text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">{signal.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="min-h-0 rounded-[0.95rem] border border-[var(--border-soft)] bg-[var(--canvas-chip)] px-3 py-3">
                    <div className="mb-2 text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Artifacts</div>
                    <div className="space-y-2 overflow-y-auto pr-1">
                      {artifactRows.map((artifact) => (
                        <div key={`${selectedRoom.id}-${artifact.id}`} className="rounded-[0.8rem] border border-[var(--border-soft)] bg-[color-mix(in_srgb,var(--panel)_72%,transparent)] px-3 py-2">
                          <div className="text-sm font-medium text-[var(--text)]">{artifact.title}</div>
                          <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">{artifact.meta}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
