import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchPrimeSessions, fetchThreadMessages, sendChiefMessage } from '../api'
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
  isOnboarding: boolean
}

type WorkFocus = {
  id: string
  title: string
  status: string
  lane: string
  owner: string
  kind: 'work' | 'delegation'
  messageId?: string
  updatedAt?: string
}

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

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds}s`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
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

function speakerGlyph(speaker: string): string {
  if (speaker === 'system') return '■'
  return '▣'
}

function participantDot(agent: string, healthByName: Map<string, AgentHealth>): string {
  const health = healthByName.get(agent.toLowerCase())
  if (health?.healthy === false) return 'bg-red-400 shadow-[0_0_7px_rgba(248,113,113,0.55)]'
  if (health?.healthy === true) return 'bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.45)]'
  return 'bg-[var(--muted)]'
}

function primePhaseLabel(step?: string, status?: string): string {
  if (status && status !== 'running') return 'finalizing'
  if (step === 'assembling_context') return 'gathering context'
  if (step === 'deciding') return 'thinking'
  if (step === 'dispatching') return 'taking action'
  if (step === 'completed') return 'responding'
  if (step === 'failed') return 'reporting'
  return 'processing'
}

// ─── Data derivation ───────────────────────────────────────────────────────

function roomStateFromThread(
  thread: RuntimeThread,
  items: RuntimeWorkItem[],
  delegs: RuntimeDelegation[],
): RoomState {
  if (thread.metadata?.kind === 'onboarding') return 'active'
  if (thread.status === 'closed') return 'archived'
  if (items.some((i) => i.status === 'blocked')) return 'blocked'
  if (delegs.some((d) => d.status === 'queued' || d.status === 'running')) return 'attention'
  if (items.some((i) => i.status === 'active')) return 'active'
  return 'active'
}

function derivedMessages(
  items: RuntimeWorkItem[],
  delegs: RuntimeDelegation[],
  agents: RegistryAgent[],
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
  return msgs.slice(0, 8).map(({ speaker, text, at }) => ({ speaker, text, at }))
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
  chiefName,
  agents,
  healthData,
  workItems,
  delegations,
  threads,
  pendingApprovals,
}: CollaborationRoomsViewProps) {
  const queryClient = useQueryClient()
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterTab>('active')
  const [search, setSearch] = useState('')
  const [termExpanded, setTermExpanded] = useState(true)
  const [draftMessage, setDraftMessage] = useState('')
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [followBottom, setFollowBottom] = useState(true)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const lastMessageCountRef = useRef(0)

  const rooms = useMemo<RoomView[]>(() => {
    if (threads.length === 0) return []

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
        messages: derivedMessages(items, delegs, agents),
        workItems: items,
        delegations: delegs,
        isOnboarding: thread.metadata?.kind === 'onboarding',
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
  const activeRoomId = selectedRoom?.id ?? null

  const { data: primeSessions = [] } = useQuery({
    queryKey: ['prime-agent-sessions', activeRoomId],
    queryFn: () => fetchPrimeSessions(25),
    enabled: !!activeRoomId,
    refetchInterval: 2_000,
  })

  const roomPrimeSessions = primeSessions.filter((session) =>
    session.trigger_type === 'chief_message' &&
    session.trigger_payload?.['thread_id'] === activeRoomId
  )
  const runningPrimeSessions = roomPrimeSessions.filter((session) => session.status === 'running')

  const { data: rawMessages = [] } = useQuery({
    queryKey: ['thread-messages', activeRoomId],
    queryFn: () => fetchThreadMessages(activeRoomId!),
    enabled: !!activeRoomId,
    refetchInterval: runningPrimeSessions.length > 0 ? 1_000 : 3_000,
  })

  const selectedWork = selectedRoom
    ? selectedRoom.workItems.find((item) => item.id === selectedWorkId)
    : undefined

  const displayMessages = rawMessages.length >= 1
    ? rawMessages.map(msg => ({
        speaker: msg.sender || msg.role,
        text: msg.content,
        at: formatShortTime(msg.created_at),
      }))
    : selectedRoom?.messages ?? []

  useEffect(() => {
    lastMessageCountRef.current = 0
    setUnreadMessages(0)
    setFollowBottom(true)
  }, [activeRoomId])

  useEffect(() => {
    if (!followBottom) return
    const node = chatScrollRef.current
    if (!node) return
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
    })
  }, [activeRoomId, selectedRoomId])

  const activeAgents = selectedRoom
    ? Array.from(new Set([
        ...selectedRoom.workItems.map((i) => i.owner_label).filter(Boolean) as string[],
        ...selectedRoom.participants,
        ...(selectedRoom.isOnboarding ? [chiefName] : []),
      ]))
    : []
  const healthByName = useMemo(() => new Map(healthData.map((entry) => [entry.agent.toLowerCase(), entry])), [healthData])
  const attentionWork = selectedRoom
    ? selectedRoom.workItems.filter((item) => item.status === 'blocked' || item.status === 'approval')
    : []
  const activeWork = selectedRoom
    ? [
        ...selectedRoom.workItems
          .filter((item) => item.status === 'active')
          .map((item): WorkFocus => ({
            id: item.id,
            title: item.title,
            status: item.status,
            lane: item.lane,
            owner: item.owner_label || chiefName,
            kind: 'work',
            messageId: typeof item.metadata?.['message_id'] === 'string' ? item.metadata['message_id'] : undefined,
            updatedAt: item.updated_at ?? item.created_at,
          })),
        ...selectedRoom.delegations
          .filter((delegation) => delegation.status === 'running')
          .map((delegation): WorkFocus => {
            const item = selectedRoom.workItems.find((workItem) => workItem.id === delegation.work_item_id)
            const agent = agents.find((candidate) => candidate.id === delegation.to_agent_id)
            return {
              id: delegation.id,
              title: item?.title ?? `${laneLabel(delegation.capability)} delegation`,
              status: delegation.status,
              lane: delegation.capability,
              owner: agent?.name ?? item?.owner_label ?? 'agent',
              kind: 'delegation',
              messageId: typeof item?.metadata?.['message_id'] === 'string' ? item.metadata['message_id'] : undefined,
              updatedAt: delegation.updated_at ?? delegation.created_at,
            }
          }),
      ]
    : []
  const pendingWork = selectedRoom
    ? [
        ...selectedRoom.workItems
          .filter((item) => item.status !== 'active' && item.status !== 'blocked' && item.status !== 'approval')
          .map((item): WorkFocus => ({
            id: item.id,
            title: item.title,
            status: item.status,
            lane: item.lane,
            owner: item.owner_label || chiefName,
            kind: 'work',
            messageId: typeof item.metadata?.['message_id'] === 'string' ? item.metadata['message_id'] : undefined,
            updatedAt: item.updated_at ?? item.created_at,
          })),
        ...selectedRoom.delegations
          .filter((delegation) => delegation.status === 'queued')
          .map((delegation): WorkFocus => {
            const item = selectedRoom.workItems.find((workItem) => workItem.id === delegation.work_item_id)
            const agent = agents.find((candidate) => candidate.id === delegation.to_agent_id)
            return {
              id: delegation.id,
              title: item?.title ?? `${laneLabel(delegation.capability)} delegation`,
              status: delegation.status,
              lane: delegation.capability,
              owner: agent?.name ?? item?.owner_label ?? 'agent',
              kind: 'delegation',
              messageId: typeof item?.metadata?.['message_id'] === 'string' ? item.metadata['message_id'] : undefined,
              updatedAt: delegation.updated_at ?? delegation.created_at,
            }
          }),
      ]
    : []
  const selectedFocus = [...activeWork, ...pendingWork].find((item) => item.id === selectedWorkId)
  const latestPrimeSession = roomPrimeSessions[0]
  const latestPrimeResponseVisible = latestPrimeSession
    ? rawMessages.some((message) => message.metadata?.['session_id'] === latestPrimeSession.id)
    : false
  const finalizingPrimeSessions = latestPrimeSession && latestPrimeSession.status !== 'running' && !latestPrimeResponseVisible
    ? [latestPrimeSession]
    : []
  const visiblePrimeSessions = runningPrimeSessions.length > 0 ? runningPrimeSessions : finalizingPrimeSessions
  useEffect(() => {
    const node = chatScrollRef.current
    if (!node) return

    if (!followBottom) {
      const currentCount = displayMessages.length
      const previousCount = lastMessageCountRef.current
      if (currentCount > previousCount) {
        setUnreadMessages((count) => count + (currentCount - previousCount))
      }
      lastMessageCountRef.current = currentCount
      return
    }

    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
      setUnreadMessages(0)
      lastMessageCountRef.current = displayMessages.length
    })
  }, [displayMessages.length, followBottom, activeRoomId, visiblePrimeSessions.length])

  useEffect(() => {
    if (visiblePrimeSessions.length === 0) return
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [visiblePrimeSessions.length])

  const primaryRunningSession = visiblePrimeSessions[0]
  const runningPrimeWork = visiblePrimeSessions
    .map((session) => {
      const messageId = session.trigger_payload?.['message_id']
      return selectedRoom?.workItems.find((item) => item.metadata?.['message_id'] === messageId)
    })
    .filter(Boolean) as RuntimeWorkItem[]
  const hasLiveActivity = !!selectedRoom && (
    selectedRoom.workItems.some((item) => item.status === 'active' || item.status === 'blocked')
    || selectedRoom.delegations.some((delegation) => delegation.status === 'queued' || delegation.status === 'running')
  )
  const processingOwners = Array.from(new Set(runningPrimeWork.map((item) => item.owner_label || chiefName))).filter(Boolean)
  const processingLabel = processingOwners.length > 0 ? processingOwners.join(', ') : chiefName
  const processingSummary = runningPrimeWork.length > 0
    ? runningPrimeWork.slice(0, 2).map((item) => item.title).join(' · ')
    : 'thinking through the latest request'
  const processingStartedAt = primaryRunningSession ? new Date(primaryRunningSession.started_at).getTime() : clockNow
  const processingStartupBufferMs = 5000
  const processingElapsed = primaryRunningSession
    ? formatElapsed(Math.max(0, clockNow - processingStartedAt + processingStartupBufferMs))
    : '0s'
  const processingTimeLabel = formatShortTime(primaryRunningSession?.started_at)
  const processingVerb = primePhaseLabel(primaryRunningSession?.last_step, primaryRunningSession?.status)
  const selectedWorkSession = selectedFocus?.messageId
    ? roomPrimeSessions.find((session) => session.trigger_payload?.['message_id'] === selectedFocus.messageId)
    : undefined
  const selectedWorkResponse = selectedWorkSession
    ? rawMessages.find((message) => message.metadata?.['session_id'] === selectedWorkSession.id)
    : undefined
  const sendMessage = useMutation({
    mutationFn: async () => {
      if (!activeRoomId) throw new Error('No active room')
      const content = draftMessage.trim()
      if (!content) throw new Error('Message is empty')
      return sendChiefMessage(activeRoomId, { content, sender: 'james' })
    },
    onSuccess: async () => {
      setDraftMessage('')
      setFollowBottom(true)
      setUnreadMessages(0)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread-messages', activeRoomId] }),
        queryClient.invalidateQueries({ queryKey: ['threads'] }),
        queryClient.invalidateQueries({ queryKey: ['runtime-work-items'] }),
        queryClient.invalidateQueries({ queryKey: ['runtime-delegations'] }),
        queryClient.invalidateQueries({ queryKey: ['runtime-overview'] }),
        queryClient.invalidateQueries({ queryKey: ['prime-agent-sessions', activeRoomId] }),
      ])
    },
  })
  const canSendMessage = !!activeRoomId && draftMessage.trim().length > 0 && !sendMessage.isPending

  function submitMessage() {
    if (!canSendMessage) return
    sendMessage.mutate()
  }

  function selectWork(id: string) {
    setSelectedWorkId(id)
    setTermExpanded(true)
  }

  function handleChatScroll() {
    const node = chatScrollRef.current
    if (!node) return
    const isNearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80
    setFollowBottom(isNearBottom)
    if (isNearBottom) setUnreadMessages(0)
  }

  function scrollChatToBottom() {
    const node = chatScrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
    setUnreadMessages(0)
    setFollowBottom(true)
  }

  function renderWorkRows(rows: WorkFocus[], empty: string) {
    if (rows.length === 0) {
      return <div className="rounded border border-dashed border-[var(--border-soft)] px-3 py-3 text-xs text-[var(--muted)]">{empty}</div>
    }
    return rows.map((item) => (
      <button
        key={`${selectedRoom?.id}-work-${item.kind}-${item.id}`}
        type="button"
        onClick={() => selectWork(item.id)}
        className={`w-full rounded border px-3 py-2 text-left transition ${
          selectedWorkId === item.id
            ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)]'
            : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] hover:bg-[var(--panel-strong)]'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[var(--text)]">{item.title}</div>
            <div className="mt-1 font-mono text-[11px] text-[var(--muted)]">
              {item.owner} · {laneLabel(item.lane)}
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-[var(--border-soft)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">
            {laneLabel(item.status)}
          </span>
        </div>
        <div className="mt-1.5 font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">
          {item.kind} · updated {formatShortTime(item.updatedAt)}
        </div>
      </button>
    ))
  }

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
          {rooms.length === 0 && (
            <div className="px-5 py-8 text-sm text-[var(--muted)]">
              No rooms yet. Launch the prime agent from setup to create the first getting-started room.
            </div>
          )}
          {rooms.length > 0 && filteredRooms.length === 0 && (
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
          <div className="shrink-0 border-b border-[var(--border-soft)] px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-semibold text-[var(--text)]">{selectedRoom.title}</div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {activeAgents.length === 0 && (
                    <span className="font-mono text-[11px] uppercase tracking-wide text-[var(--muted)]">No participants yet</span>
                  )}
                  {activeAgents.map((agent) => (
                    <span
                      key={`${selectedRoom.id}-header-p-${agent}`}
                      className="inline-flex max-w-[160px] items-center gap-1.5 rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted)]"
                      title={agent}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${participantDot(agent, healthByName)}`} />
                      <span className="truncate">{agent}</span>
                    </span>
                  ))}
                </div>
              </div>
              <span className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide ${stateChip(selectedRoom.state)}`}>
                {stateLabel(selectedRoom.state)}
              </span>
              <span className="shrink-0 font-mono text-sm text-[var(--muted)]">{selectedRoom.lane} · {selectedRoom.lastUpdated}</span>
            </div>
          </div>

          {/* Workspace body */}
          <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px]">

            {/* Chat column */}
            <div className="flex min-h-0 flex-col border-r border-[var(--border-soft)]">

              {/* Messages */}
              <div
                ref={chatScrollRef}
                className="min-h-0 flex-1 overflow-y-auto bg-[var(--panel-subtle)] px-[18px] py-4"
                onScroll={handleChatScroll}
              >
                <div className="flex flex-col gap-1.5 font-mono text-sm">
                  {unreadMessages > 0 && (
                    <button
                      type="button"
                      onClick={scrollChatToBottom}
                      className="sticky top-0 z-10 mx-auto mb-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-200 shadow-lg backdrop-blur"
                    >
                      {unreadMessages} new message{unreadMessages === 1 ? '' : 's'}
                    </button>
                  )}
                  {displayMessages.map((msg, i) => (
                    <div
                      key={`${selectedRoom.id}-${i}`}
                      className="grid gap-2.5 rounded px-1.5 py-0.5"
                      style={{ gridTemplateColumns: '92px 132px 1fr' }}
                    >
                      <span className="whitespace-nowrap text-[var(--terminal-time)]">{msg.at}</span>
                      <span className={`whitespace-nowrap font-semibold ${speakerCls(msg.speaker)}`}>{speakerGlyph(msg.speaker)} {msg.speaker}</span>
                      <span className={msg.speaker === 'system' ? 'text-[var(--s-blk-tx)]' : 'text-[var(--text)]'}>{msg.text}</span>
                    </div>
                  ))}
                  {visiblePrimeSessions.length > 0 && (
                    <div className="mt-1 grid animate-pulse gap-2.5 rounded border border-emerald-400/20 bg-emerald-400/5 px-1.5 py-1 text-[var(--terminal-working)]" style={{ gridTemplateColumns: '92px 132px 1fr' }}>
                      <span className="whitespace-nowrap">{processingTimeLabel}</span>
                      <span className="whitespace-nowrap font-semibold">
                        {speakerGlyph(processingLabel)} {processingLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() => runningPrimeWork[0] && selectWork(runningPrimeWork[0].id)}
                        className="min-w-0 truncate text-left text-[var(--terminal-working)] underline-offset-4 hover:underline"
                      >
                        <span className="uppercase tracking-wide">{processingVerb}</span>
                        <span className="mx-1 text-[var(--terminal-working)]">({processingElapsed})</span>
                        <span className="mx-1 inline-flex w-5 justify-start">
                          <span className="animate-bounce [animation-delay:-0.2s]">.</span>
                          <span className="animate-bounce [animation-delay:-0.1s]">.</span>
                          <span className="animate-bounce">.</span>
                        </span>
                        {processingSummary}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Chat input */}
              <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3">
                <input
                  className="flex-1 rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-2 font-mono text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--sel-bd)]"
                  placeholder="$ message room or @agent…"
                  value={draftMessage}
                  disabled={!activeRoomId || sendMessage.isPending}
                  onChange={(e) => setDraftMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      submitMessage()
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!canSendMessage}
                  onClick={submitMessage}
                  className="shrink-0 rounded border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-4 py-2 font-mono text-xs uppercase tracking-wide text-blue-400 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {sendMessage.isPending ? 'Sending…' : 'Send ↵'}
                </button>
              </div>
              {sendMessage.isError && (
                <div className="shrink-0 border-t border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)] px-4 py-2 font-mono text-xs text-[var(--s-blk-tx)]">
                  {(sendMessage.error as Error).message}
                </div>
              )}

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
                    Agent activity — {selectedRoom.participants[0] ?? chiefName}
                  </span>
                  <span className="ml-auto text-[11px] text-[#6e7681]">{termExpanded ? '▲' : '▼'}</span>
                </div>

                {termExpanded && (
                  <div className="h-[calc(100%-36px)] overflow-y-auto px-3.5 pb-2 font-mono text-[13px] leading-relaxed">
                    {selectedFocus ? (
                      <>
                        <div className="flex gap-2.5"><span className="text-[#58a6ff]">{selectedFocus.owner} $</span><span className="text-[#79c0ff]">inspect selected work</span></div>
                        <div className="pl-4 text-[#c9d1d9]">{selectedFocus.title}</div>
                        <div className="pl-4 text-[#8b949e]">status={selectedFocus.status} lane={selectedFocus.lane} kind={selectedFocus.kind}</div>
                        {selectedWorkSession && (
                          <>
                            <div className="mt-2 flex gap-2.5"><span className="text-[#58a6ff]">prime $</span><span className="text-[#79c0ff]">session {selectedWorkSession.status}</span></div>
                            <div className="pl-4 text-[#8b949e]">step={selectedWorkSession.last_step ?? 'n/a'} model={selectedWorkSession.model_used ?? 'pending'}</div>
                            {selectedWorkSession.workspace_revision && (
                              <div className="pl-4 text-[#8b949e]">workspace revision: {selectedWorkSession.workspace_revision.slice(0, 12)}</div>
                            )}
                            {selectedWorkSession.workspace_root && (
                              <div className="pl-4 text-[#8b949e]">workspace root: {selectedWorkSession.workspace_root}</div>
                            )}
                            {Object.keys(selectedWorkSession.prompt_templates ?? {}).length > 0 && (
                              <>
                                <div className="pl-4 text-[#79c0ff]">templates used:</div>
                                <div className="pl-8 text-[#8b949e]">
                                  {Object.entries(selectedWorkSession.prompt_templates)
                                    .map(([name, filePath]) => `${name}=${filePath}`)
                                    .join(' | ')}
                                </div>
                              </>
                            )}
                            {selectedWorkSession.reasoning_summary && (
                              <div className="pl-4 text-[#c9d1d9]">reasoning: {selectedWorkSession.reasoning_summary}</div>
                            )}
                            {selectedWorkSession.actions_taken.length > 0 && (
                              <div className="pl-4 text-[#c9d1d9]">
                                actions: {selectedWorkSession.actions_taken.map((action) => typeof action === 'object' && action !== null && 'type' in action ? String(action.type) : 'action').join(', ')}
                              </div>
                            )}
                            {selectedWorkSession.error && (
                              <div className="pl-4 text-[#f85149]">error: {selectedWorkSession.error}</div>
                            )}
                            {selectedWorkResponse && (
                              <div className="pl-4 text-[#c9d1d9]">response: {selectedWorkResponse.content}</div>
                            )}
                          </>
                        )}
                        <div className="mt-1.5 flex gap-2.5"><span className="text-[#58a6ff]">{selectedFocus.owner} $</span><span className="text-[#d29922]">▌</span></div>
                      </>
                    ) : hasLiveActivity ? (
                      <>
                        <div className="flex gap-2.5"><span className="text-[#58a6ff]">{selectedRoom.participants[0] ?? chiefName} $</span><span className="text-[#79c0ff]">monitor coordination state</span></div>
                        <div className="pl-4 text-[#c9d1d9]">{selectedRoom.summary}</div>
                        <div className="mt-1.5 flex gap-2.5"><span className="text-[#58a6ff]">{selectedRoom.participants[0] ?? chiefName} $</span><span className="text-[#d29922]">▌</span></div>
                      </>
                    ) : (
                      <>
                        <div className="flex gap-2.5"><span className="text-[#58a6ff]">{chiefName} $</span><span className="text-[#79c0ff]">await first instruction</span></div>
                        <div className="pl-4 text-[#c9d1d9]">Use this room to kick off the first task, incident, or repo workflow.</div>
                        <div className="pl-4 text-[#c9d1d9]">Once you send a message, this room becomes the live coordination thread.</div>
                        <div className="mt-1.5 flex gap-2.5"><span className="text-[#58a6ff]">{chiefName} $</span><span className="text-[#d29922]">▌</span></div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right data column */}
            <div className="flex min-h-0 flex-col overflow-hidden">

              {/* Needs attention */}
              <div className="max-h-[30%] min-h-[120px] overflow-hidden border-b border-[var(--border-soft)] px-[18px] py-3.5">
                <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[11px] uppercase tracking-widest text-[var(--muted)]">
                  <span>Needs Attention</span>
                  <span className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-0.5 tracking-normal">
                    {attentionWork.length + pendingApprovals}
                  </span>
                </div>
                <div className="flex h-[calc(100%-28px)] flex-col gap-2 overflow-y-auto pr-1">
                  {pendingApprovals > 0 && (
                    <div className="rounded border border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)] px-3 py-2 text-sm text-[var(--s-blk-tx)]">
                      {pendingApprovals} approval{pendingApprovals === 1 ? '' : 's'} waiting
                    </div>
                  )}
                  {attentionWork.map((item) => (
                    <button
                      key={`${selectedRoom.id}-attention-${item.id}`}
                      type="button"
                      onClick={() => selectWork(item.id)}
                      className={`rounded border px-3 py-2 text-left transition ${
                        selectedWorkId === item.id
                          ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)]'
                          : 'border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)] hover:bg-[var(--panel-strong)]'
                      }`}
                    >
                      <div className="truncate text-sm font-medium text-[var(--text)]">{item.title}</div>
                      <div className="mt-1 font-mono text-[11px] text-[var(--muted)]">{item.owner_label || chiefName} · {laneLabel(item.status)}</div>
                    </button>
                  ))}
                  {attentionWork.length === 0 && pendingApprovals === 0 && (
                    <div className="rounded border border-dashed border-[var(--border-soft)] px-3 py-3 text-xs text-[var(--muted)]">Nothing needs intervention.</div>
                  )}
                </div>
              </div>

              {/* Active work */}
              <div className="min-h-[180px] flex-1 overflow-hidden border-b border-[var(--border-soft)] px-[18px] py-3.5">
                <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[11px] uppercase tracking-widest text-[var(--muted)]">
                  <span>Active Work</span>
                  <span className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-0.5 tracking-normal">{activeWork.length}</span>
                </div>
                <div className="flex h-[calc(100%-28px)] flex-col gap-2 overflow-y-auto pr-1">
                  {renderWorkRows(activeWork, 'No active work in this room.')}
                </div>
              </div>

              {/* Pending work */}
              <div className="min-h-[180px] flex-1 overflow-hidden px-[18px] py-3.5">
                <div className="mb-2 flex items-center justify-between gap-2 font-mono text-[11px] uppercase tracking-widest text-[var(--muted)]">
                  <span>Pending Work</span>
                  <span className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-0.5 tracking-normal">{pendingWork.length}</span>
                </div>
                <div className="flex h-[calc(100%-28px)] flex-col gap-2 overflow-y-auto pr-1">
                  {renderWorkRows(pendingWork, 'No pending work queued.')}
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
