import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, Menu, Paperclip, TerminalSquare, Wand2 } from 'lucide-react'
import { fetchPrimeSessions, fetchProviders, fetchSetupProviderModels, fetchThreadMessages, sendPrimeMessage } from '../api'
import { BottomActionToolbar } from './agentCanvas/BottomActionToolbar'
import type { AgentEvent, Provider, RegistryAgent, RuntimeAuditLoop, RuntimeDelegation, RuntimeThread, RuntimeWorkItem, ToolbarDraftAction } from '../types'
import { useToolbarActions } from '../hooks/useToolbarActions'
import type { ChatDraft } from '../types/composer'
type AgentHealth = {
  agent: string
  last_seen: string
  healthy: boolean
}

type CollaborationRoomsViewProps = {
  primeName: string
  connected: boolean
  events: AgentEvent[]
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
  sourceSessionId?: string
  actionType?: string
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
  if (speaker === 'prime')  return 'text-violet-400'
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

type TerminalLine = {
  key: string
  speaker: string
  command: string
  detail?: string
  occurredAt: string
  tone?: 'info' | 'success' | 'warning' | 'error'
  kind: 'thinking' | 'turn' | 'tool' | 'result' | 'error'
}

type ChatTimelineEntry =
  | { kind: 'message'; key: string; occurredAt: string; speaker: string; text: string; at: string }
  | {
      kind: 'artifact'
      key: string
      occurredAt: string
      summary: string
      live: boolean
      lines: TerminalLine[]
    }

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function asActionSummary(payload: Record<string, unknown>): string | undefined {
  const actions = Array.isArray(payload.actions) ? payload.actions : []
  if (actions.length === 0) return 'no actions proposed'
  return actions.map((action) => {
    if (!action || typeof action !== 'object') return 'action'
    const record = action as Record<string, unknown>
    const type = asText(record.type) ?? 'action'
    const reason = asText(record.reason)
    return reason ? `${type} (${reason})` : type
  }).join(' | ')
}

function toneClass(tone?: TerminalLine['tone']): string {
  if (tone === 'error') return 'text-rose-300'
  if (tone === 'warning') return 'text-amber-300'
  if (tone === 'success') return 'text-emerald-300'
  return 'text-cyan-300'
}

function artifactRailClass(tone?: TerminalLine['tone']): string {
  if (tone === 'error') return 'bg-rose-400/90'
  if (tone === 'warning') return 'bg-amber-400/90'
  if (tone === 'success') return 'bg-emerald-400/90'
  return 'bg-cyan-400/90'
}

function artifactLabel(line: TerminalLine): string {
  if (line.kind === 'thinking') return 'Thinking'
  if (line.kind === 'tool') return 'Tool'
  if (line.kind === 'result') return 'Update'
  if (line.kind === 'error') return 'Error'
  return 'Turn'
}

function eventToTerminalLine(event: AgentEvent): TerminalLine | null {
  const payload = event.payload ?? {}
  const sessionId = asText(payload.session_id)

  switch (event.type) {
    case 'prime.turn.started':
      return {
        key: event.id,
        speaker: 'prime',
        command: 'turn started',
        detail: `trigger=${asText(payload.trigger_type) ?? 'prime.message'}`,
        occurredAt: event.created_at,
        tone: 'info',
        kind: 'turn',
      }
    case 'prime.turn.step': {
      const status = asText(payload.status) ?? 'completed'
      const moduleId = asText(payload.module_id) ?? 'module'
      const mode = asText(payload.mode)
      return {
        key: event.id,
        speaker: 'prime',
        command: `${moduleId}${mode === 'shadow' ? ' [shadow]' : ''}`,
        detail: [status, asText(payload.detail)].filter(Boolean).join(' · '),
        occurredAt: event.created_at,
        tone: status === 'failed' ? 'error' : status === 'started' ? 'warning' : 'success',
        kind: status === 'failed' ? 'error' : status === 'started' ? 'tool' : 'result',
      }
    }
    case 'prime.turn.reasoning':
      return {
        key: event.id,
        speaker: 'prime',
        command: 'reasoning',
        detail: asText(payload.reasoning) ?? 'reasoning unavailable',
        occurredAt: event.created_at,
        tone: 'info',
        kind: 'thinking',
      }
    case 'prime.turn.actions':
      return {
        key: event.id,
        speaker: 'prime',
        command: 'actions',
        detail: asActionSummary(payload),
        occurredAt: event.created_at,
        tone: 'warning',
        kind: 'tool',
      }
    case 'prime.turn.completed': {
      const detail = [
        `status=${asText(payload.status) ?? 'completed'}`,
        asText(payload.model_used) ? `model=${asText(payload.model_used)}` : undefined,
      ].filter(Boolean).join(' ')
      return {
        key: event.id,
        speaker: 'prime',
        command: 'turn complete',
        detail,
        occurredAt: event.created_at,
        tone: 'success',
        kind: 'result',
      }
    }
    case 'prime.turn.failed':
      return {
        key: event.id,
        speaker: 'prime',
        command: 'turn failed',
        detail: asText(payload.error) ?? 'unknown error',
        occurredAt: event.created_at,
        tone: 'error',
        kind: 'error',
      }
    default:
      return null
  }
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
  primeName,
  events,
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
  const [draftMessage, setDraftMessage] = useState('')
  const [toolbarDrafts, setToolbarDrafts] = useState<Record<string, ToolbarDraftAction>>({})
  const [composerDraft, setComposerDraft] = useState<ToolbarDraftAction | null>(null)
  const { handleOpenDraft, handleCancelDraft } = useToolbarActions(setToolbarDrafts, setComposerDraft)
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const [unreadMessages, setUnreadMessages] = useState(0)
  // Composer state for ACP chat input enhancements
  const [composerState, setComposerState] = useState<ChatDraft>({
    text: '',
    modelId: null,
    mode: 'agent',
    attachments: [],
    companionPrompt: null,
    tools: { webSearch: false, shell: true, imageProcessing: false },
    validationState: 'valid',
    sendState: 'idle',
  })
  const [followBottom, setFollowBottom] = useState(true)
  const [expandedArtifactIds, setExpandedArtifactIds] = useState<Record<string, boolean>>({})
  const [showComposerMenu, setShowComposerMenu] = useState(false)
  const [showCompanionPrompt, setShowCompanionPrompt] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({})
  const [modelMenuPosition, setModelMenuPosition] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 260 })
  const [composerToast, setComposerToast] = useState<string | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const chatInputRef = useRef<HTMLInputElement | null>(null)
  const modelButtonRef = useRef<HTMLButtonElement | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const companionPromptRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const displayStartRef = useRef<{ ts: 0 | number; roomId: string | null }>({ ts: 0, roomId: null })
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
  }, [filter, rooms, search])

  const { data: providers = [] } = useQuery<Provider[]>({
    queryKey: ['providers'],
    queryFn: fetchProviders,
  })

  useEffect(() => {
    let cancelled = false
    async function loadProviderModels() {
      const next: Record<string, string[]> = {}
      await Promise.all(providers.map(async (provider) => {
        const configured = typeof provider.model === 'string' && provider.model.trim() ? [provider.model.trim()] : []
        next[provider.id] = configured
        try {
          const result = await fetchSetupProviderModels({
            type: provider.type,
            base_url: provider.base_url,
            ...(provider.api_key ? { api_key: provider.api_key } : {}),
          })
          if (Array.isArray(result.models) && result.models.length > 0) {
            next[provider.id] = Array.from(new Set([...configured, ...result.models]))
          }
        } catch {
          // fall back to configured provider.model only
        }
      }))
      if (!cancelled) setProviderModels(next)
    }
    if (providers.length > 0) loadProviderModels()
    return () => { cancelled = true }
  }, [providers])

  const availableModelOptions = useMemo(() => {
    const opts = providers.flatMap((provider) => {
      const models = providerModels[provider.id] ?? (provider.model ? [provider.model] : [])
      return models.filter(Boolean).map((model) => ({
        id: model,
        label: model,
        providerName: provider.name,
        providerId: provider.id,
      }))
    })
    const deduped = new Map<string, { id: string; label: string; providerName: string; providerId: string }>()
    for (const option of opts) {
      if (!deduped.has(option.id)) deduped.set(option.id, option)
    }
    return Array.from(deduped.values())
  }, [providerModels, providers])

  const filteredModelOptions = useMemo(() => {
    const q = modelSearch.trim().toLowerCase()
    if (!q) return availableModelOptions
    return availableModelOptions.filter((option) => option.label.toLowerCase().includes(q) || option.providerName.toLowerCase().includes(q))
  }, [availableModelOptions, modelSearch])

  const currentModelLabel = useMemo(() => {
    const found = availableModelOptions.find((option) => option.id === composerState.modelId)
    if (!found) return 'Current model'
    return found.label
  }, [availableModelOptions, composerState.modelId])

  useEffect(() => {
    if (!composerState.modelId && availableModelOptions.length > 0) {
      setComposerState((prev) => (prev.modelId ? prev : { ...prev, modelId: availableModelOptions[0].id }))
    }
  }, [availableModelOptions, composerState.modelId])

  useEffect(() => {
    if (!showModelMenu) setModelSearch('')
  }, [showModelMenu])

  useEffect(() => {
    if (!showModelMenu) return
    const updatePosition = () => {
      const rect = modelButtonRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.max(260, rect.width + 120)
      const estimatedHeight = 320
      setModelMenuPosition({
        top: Math.max(12, rect.top - estimatedHeight - 8),
        left: Math.max(12, rect.right - width),
        width,
      })
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (modelButtonRef.current?.contains(target) || modelMenuRef.current?.contains(target)) return
      setShowModelMenu(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowModelMenu(false)
    }
    updatePosition()
    requestAnimationFrame(() => {
      modelMenuRef.current?.animate(
        [
          { opacity: 0, transform: 'translateY(-6px) scale(0.98)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ],
        { duration: 140, easing: 'ease-out' },
      )
    })
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showModelMenu])

  const selectedRoom = filteredRooms.find((r) => r.id === selectedRoomId) ?? filteredRooms[0]
  const activeRoomId = selectedRoom?.id ?? null

  const { data: primeSessions = [] } = useQuery({
    queryKey: ['prime-agent-sessions', activeRoomId],
    queryFn: () => fetchPrimeSessions(25),
    enabled: !!activeRoomId,
    refetchInterval: 2_000,
  })

  const roomPrimeSessions = primeSessions.filter((session) =>
    session.trigger_type === 'prime_message' &&
    session.trigger_payload?.['thread_id'] === activeRoomId
  )
  const runningPrimeSessions = roomPrimeSessions.filter((session) => session.status === 'running')

  const { data: rawMessages = [] } = useQuery({
    queryKey: ['thread-messages', activeRoomId],
    queryFn: () => fetchThreadMessages(activeRoomId!),
    enabled: !!activeRoomId,
    refetchInterval: runningPrimeSessions.length > 0 ? 1_000 : 3_000,
  })

  const displayMessages = rawMessages.length >= 1
    ? rawMessages.map(msg => ({
        speaker: msg.sender || msg.role,
        text: msg.content,
        at: formatShortTime(msg.created_at),
        occurredAt: msg.created_at,
        key: msg.id,
        sessionId: typeof msg.metadata?.['session_id'] === 'string' ? msg.metadata['session_id'] : undefined,
      }))
    : (selectedRoom?.messages ?? []).map((msg, index) => ({
        ...msg,
        occurredAt: `${Date.now() + index}`,
        key: `${selectedRoom?.id ?? 'room'}-${index}`,
        sessionId: undefined,
      }))

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
        ...(selectedRoom.isOnboarding ? [primeName] : []),
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
            owner: item.owner_label || primeName,
            kind: 'work',
            messageId: typeof item.metadata?.['message_id'] === 'string' ? item.metadata['message_id'] : undefined,
            sourceSessionId: typeof item.metadata?.['source_session_id'] === 'string' ? item.metadata['source_session_id'] : undefined,
            actionType: typeof item.metadata?.['action_type'] === 'string' ? item.metadata['action_type'] : undefined,
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
              sourceSessionId: typeof item?.metadata?.['source_session_id'] === 'string' ? item.metadata['source_session_id'] : undefined,
              actionType: typeof item?.metadata?.['action_type'] === 'string' ? item.metadata['action_type'] : undefined,
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
            owner: item.owner_label || primeName,
            kind: 'work',
            messageId: typeof item.metadata?.['message_id'] === 'string' ? item.metadata['message_id'] : undefined,
            sourceSessionId: typeof item.metadata?.['source_session_id'] === 'string' ? item.metadata['source_session_id'] : undefined,
            actionType: typeof item.metadata?.['action_type'] === 'string' ? item.metadata['action_type'] : undefined,
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
              sourceSessionId: typeof item?.metadata?.['source_session_id'] === 'string' ? item.metadata['source_session_id'] : undefined,
              actionType: typeof item?.metadata?.['action_type'] === 'string' ? item.metadata['action_type'] : undefined,
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
    if (visiblePrimeSessions.length === 0 || !activeRoomId) {
      displayStartRef.current = { ts: 0, roomId: null }
      return
    }
    if (displayStartRef.current.roomId !== activeRoomId) {
      displayStartRef.current = { ts: Date.now(), roomId: activeRoomId }
    }
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [visiblePrimeSessions.length, activeRoomId])

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

  const processingSummary = runningPrimeWork.length > 0
    ? runningPrimeWork.slice(0, 2).map((item) => item.title).join(' · ')
    : 'thinking through the latest request'
  const processingElapsed = displayStartRef.current
    ? formatElapsed(Math.max(0, clockNow - displayStartRef.current.ts))
    : '0s'
  const processingTimeLabel = formatShortTime(primaryRunningSession?.started_at)
  const processingVerb = primaryRunningSession?.status && primaryRunningSession.status !== 'running'
    ? 'finalizing'
    : primaryRunningSession?.last_step === 'deciding'
      ? 'thinking'
      : primaryRunningSession?.last_step === 'dispatching'
        ? 'taking action'
        : 'processing'
  const activeArtifactSession = latestPrimeSession ?? null

  const roomTerminalLines = useMemo(() => {
    if (!activeRoomId || !activeArtifactSession) return []
    return events
      .filter((event) => {
        if (!event.type.startsWith('prime.turn.')) return false
        const threadId = typeof event.payload?.['thread_id'] === 'string' ? event.payload['thread_id'] : null
        if (threadId && threadId !== activeRoomId) return false
        const sessionId = typeof event.payload?.['session_id'] === 'string' ? event.payload['session_id'] : null
        return sessionId === activeArtifactSession.id
      })
      .map(eventToTerminalLine)
      .filter((line): line is TerminalLine => Boolean(line))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  }, [activeRoomId, activeArtifactSession, events])

  const chatTimelineEntries = useMemo<ChatTimelineEntry[]>(() => {
    const messageEntries: ChatTimelineEntry[] = displayMessages.map((msg) => ({
      kind: 'message' as const,
      key: `msg:${msg.key}`,
      occurredAt: msg.occurredAt,
      speaker: msg.speaker,
      text: msg.text,
      at: msg.at,
    }))

    if (!activeArtifactSession || roomTerminalLines.length === 0) return messageEntries

    const latestLine = roomTerminalLines[roomTerminalLines.length - 1]
    const artifactEntry: ChatTimelineEntry = {
      kind: 'artifact',
      key: `artifact-session:${activeArtifactSession.id}`,
      occurredAt: activeArtifactSession.started_at || latestLine.occurredAt,
      summary: latestLine.detail ? `${latestLine.command} · ${truncate(latestLine.detail, 88)}` : latestLine.command,
      live: activeArtifactSession.status === 'running',
      lines: roomTerminalLines,
    }

    const responseIndex = displayMessages.findIndex((msg) => msg.sessionId === activeArtifactSession.id)
    if (responseIndex >= 0) {
      return [
        ...messageEntries.slice(0, responseIndex),
        artifactEntry,
        ...messageEntries.slice(responseIndex),
      ]
    }

    return [...messageEntries, artifactEntry]
  }, [activeArtifactSession, displayMessages, roomTerminalLines])

  useEffect(() => {
    const node = chatScrollRef.current
    if (!node) return

    if (!followBottom) {
      const currentCount = chatTimelineEntries.length
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
      lastMessageCountRef.current = chatTimelineEntries.length
    })
  }, [chatTimelineEntries.length, followBottom, activeRoomId, visiblePrimeSessions.length])

  const sendMessage = useMutation({
    mutationFn: async () => {
      if (!activeRoomId) throw new Error('No active room')
      const content = composerState.text.trim()
      if (!content && composerState.attachments.length === 0 && !composerState.companionPrompt) {
        throw new Error('At least one of text, attachment, or companion prompt is required.')
      }
      // TODO: Map composerState to message payload with modelId, mode, tools
      return sendPrimeMessage(activeRoomId, { content: composerState.text, sender: 'james' })
    },
    onSuccess: async () => {
      setComposerState({
        text: '',
        modelId: null,
        mode: 'agent',
        attachments: [],
        companionPrompt: null,
        tools: { webSearch: false, shell: true, imageProcessing: false },
        validationState: 'valid',
        sendState: 'idle',
      })
      setShowCompanionPrompt(false)
      setShowComposerMenu(false)
      setShowModelMenu(false)
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
      // Restore focus to the chat input after re-renders complete
      requestAnimationFrame(() => chatInputRef.current?.focus())
    },
  })
  const canSendMessage = !!activeRoomId && (composerState.text.trim().length > 0 || composerState.attachments.length > 0 || composerState.companionPrompt !== null) && !sendMessage.isPending

  function submitMessage() {
    if (!canSendMessage) return
    sendMessage.mutate()
  }

  function appendAttachments(files: FileList | null, type: 'file' | 'image') {
    if (!files || files.length === 0) return
    const next = Array.from(files).map((file, index) => ({
      id: `${type}-${Date.now()}-${index}`,
      name: file.name,
      type,
      mimeType: file.type || (type === 'image' ? 'image/*' : 'application/octet-stream'),
      size: file.size,
      uploadState: 'uploaded' as const,
    }))
    setComposerState((prev) => ({ ...prev, attachments: [...prev.attachments, ...next] }))
  }

  function removeAttachment(id: string) {
    setComposerState((prev) => ({ ...prev, attachments: prev.attachments.filter((attachment) => attachment.id !== id) }))
  }

  function toggleCompanionPrompt() {
    setShowComposerMenu(false)
    setShowCompanionPrompt((current) => {
      const next = !current
      if (next) {
        requestAnimationFrame(() => companionPromptRef.current?.focus())
      } else {
        setComposerState((prev) => ({ ...prev, companionPrompt: null }))
      }
      return next
    })
  }

  function showComposerToastMessage(message: string) {
    setComposerToast(message)
    window.setTimeout(() => setComposerToast((current) => (current === message ? null : current)), 1400)
  }

  function selectWork(id: string) {
    setSelectedWorkId(id)
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

  function toggleArtifact(key: string) {
    setExpandedArtifactIds((current) => ({ ...current, [key]: !current[key] }))
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
                  {chatTimelineEntries.map((entry) => {
                    if (entry.kind === 'message') {
                      return (
                        <div
                          key={entry.key}
                          className="grid gap-2.5 rounded px-1.5 py-0.5"
                          style={{ gridTemplateColumns: '92px 132px 1fr' }}
                        >
                          <span className="whitespace-nowrap text-[var(--terminal-time)]">{entry.at}</span>
                          <span className={`whitespace-nowrap font-semibold ${speakerCls(entry.speaker)}`}>{speakerGlyph(entry.speaker)} {entry.speaker}</span>
                          <span className={entry.speaker === 'system' ? 'text-[var(--s-blk-tx)]' : 'text-[var(--text)]'}>{entry.text}</span>
                        </div>
                      )
                    }

                    const expanded = expandedArtifactIds[entry.key] === true
                    const activeLine = entry.lines[entry.lines.length - 1]
                    const integrityError = entry.lines.some((line) => /approval_id|foreign key|foreign-key|_fkey\b/i.test(`${line.command} ${line.detail ?? ''}`))
                    return (
                      <div key={entry.key} className="ml-[92px] pl-[22px]">
                        <div className={`relative rounded-md border px-3 py-2 text-xs ${entry.live ? 'border-emerald-400/15 bg-emerald-400/5 text-emerald-200' : 'border-white/6 bg-white/3 text-[var(--muted)]'}`}>
                          <span className={`absolute left-0 top-2.5 h-2 w-2 -translate-x-[13px] rounded-full ${entry.live ? 'bg-emerald-400 animate-pulse' : artifactRailClass(activeLine?.tone)}`} />
                          <span className={`absolute left-0 top-3 bottom-3 -translate-x-[10px] w-px ${entry.live ? 'bg-emerald-400/50' : `${artifactRailClass(activeLine?.tone)} opacity-50`}`} />
                          <button
                            type="button"
                            onClick={() => toggleArtifact(entry.key)}
                            className="flex w-full items-start gap-3 text-left"
                          >
                            <span className={`min-w-[52px] whitespace-nowrap text-[10px] uppercase tracking-[0.18em] ${entry.live ? 'text-emerald-300/80' : 'text-[var(--terminal-time)]'}`}>
                              {entry.live ? 'Live' : 'Turn'}
                            </span>
                            <span className={`min-w-0 flex-1 ${entry.live ? 'text-emerald-200' : toneClass(activeLine?.tone)}`}>
                              <span className="font-semibold">{entry.live ? processingVerb : activeLine?.command}</span>
                              <span className={`ml-2 ${entry.live ? 'text-emerald-300/70' : 'text-[var(--muted)]'}`}>
                                {entry.live ? `(${processingElapsed}) ${processingSummary}` : entry.summary}
                              </span>
                              {integrityError && <span className="ml-2 rounded-full border border-rose-400/30 bg-rose-400/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-rose-200">integrity</span>}
                            </span>
                            <span className={`text-[10px] ${entry.live ? 'text-emerald-300/70' : 'text-[var(--muted)]'}`}>{expanded ? '▼' : '▶'}</span>
                          </button>
                          {expanded && (
                            <div className="mt-2 space-y-1.5">
                              {entry.lines.map((line) => (
                                <div key={line.key} className="rounded border border-white/8 bg-black/20 px-2.5 py-2 text-[11px] leading-relaxed text-[var(--text)]">
                                  <div className="flex items-start gap-2">
                                    <span className={`mt-0.5 inline-block h-1.5 w-1.5 rounded-full ${artifactRailClass(line.tone)}`} />
                                    <div className="min-w-0 flex-1">
                                      <div className={`${toneClass(line.tone)} font-semibold`}>{line.command}</div>
                                      {line.detail && <div className="mt-1 whitespace-pre-wrap break-words text-[var(--text)]">{line.detail}</div>}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {!chatTimelineEntries.length && !hasLiveActivity && (
                    <div className="grid gap-2.5 rounded px-1.5 py-0.5" style={{ gridTemplateColumns: '92px 132px 1fr' }}>
                      <span className="whitespace-nowrap text-[var(--terminal-time)]">--:--</span>
                      <span className={`whitespace-nowrap font-semibold ${speakerCls(primeName)}`}>{speakerGlyph(primeName)} {primeName}</span>
                      <span className="text-[var(--text)]">Use this room to kick off the first task, incident, or repo workflow.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Chat input */}
              <div className="shrink-0 border-t border-[var(--border-soft)] bg-[var(--panel)] px-4 py-3">
                <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                  <div className="relative">
                    <input
                      ref={chatInputRef}
                      className="w-full bg-transparent px-0 py-1 font-mono text-sm text-[var(--text)] outline-none placeholder:text-[var(--muted)]"
                      placeholder="Message this room..."
                      value={composerState.text}
                      disabled={!activeRoomId || sendMessage.isPending}
                      onChange={(e) => setComposerState(prev => ({ ...prev, text: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          submitMessage()
                        }
                      }}
                    />
                    <div className={`absolute right-0 top-0 z-10 origin-top-right transition-all duration-200 ${composerState.text.trim().length > 0 && !showModelMenu ? 'translate-y-[-2px] scale-95 opacity-28 hover:opacity-100' : 'translate-y-0 scale-100 opacity-55 hover:opacity-100'}`}>
                      <button
                        ref={modelButtonRef}
                        type="button"
                        onClick={() => setShowModelMenu((current) => !current)}
                        disabled={!activeRoomId || sendMessage.isPending}
                        className="inline-flex max-w-[260px] items-center gap-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-[11px] font-medium text-[color:color-mix(in_srgb,var(--text)_72%,transparent)] transition duration-200 hover:border-[var(--border-soft)] hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                        title="Switch model"
                      >
                        <span className="truncate">{currentModelLabel}</span>
                        <span className={`text-[10px] opacity-60 transition ${showModelMenu ? 'rotate-180' : ''}`}>⌃</span>
                      </button>
                      {showModelMenu && activeRoomId && !sendMessage.isPending && createPortal(
                        <div
                          ref={modelMenuRef}
                          className="fixed z-[80] overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[color:color-mix(in_srgb,var(--panel)_90%,black)] p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.42)] backdrop-blur-sm"
                          style={{ top: modelMenuPosition.top, left: modelMenuPosition.left, width: modelMenuPosition.width }}
                        >
                          <div className="mb-1.5 flex items-center gap-2">
                            <input
                              value={modelSearch}
                              onChange={(e) => setModelSearch(e.target.value)}
                              placeholder="Search models..."
                              className="w-full rounded-md border border-[var(--border-soft)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--sel-bd)]"
                            />
                          </div>
                          <div className="max-h-64 overflow-y-auto">
                            {filteredModelOptions.length > 0 ? filteredModelOptions.map((option) => (
                              <button
                                key={`${option.providerId}:${option.id}`}
                                type="button"
                                onClick={() => {
                                  setComposerState((prev) => ({ ...prev, modelId: option.id }))
                                  setShowModelMenu(false)
                                }}
                                className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left font-mono text-[11px] transition hover:bg-white/6 ${composerState.modelId === option.id ? 'bg-sky-400/10 text-sky-100 ring-1 ring-sky-400/25' : 'text-[color:color-mix(in_srgb,var(--text)_94%,white_10%)]'}`}
                              >
                                <span className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_132px] items-center gap-x-3">
                                  <span className="truncate pr-1 text-[color:color-mix(in_srgb,var(--text)_96%,white_12%)]">{option.label}</span>
                                  <span className="truncate pl-2 text-right text-[color:color-mix(in_srgb,var(--text)_80%,white_12%)]">{option.providerName}</span>
                                </span>
                                {composerState.modelId === option.id && <span className="ml-3 text-sky-200">✓</span>}
                              </button>
                            )) : (
                              <div className="px-2.5 py-3 font-mono text-[11px] text-[var(--muted)]">No matching configured models.</div>
                            )}
                          </div>
                        </div>,
                        document.body,
                      )}
                    </div>
                  </div>

                  {(showCompanionPrompt || composerState.companionPrompt !== null) && (
                    <div className="mt-2 border-t border-[var(--border-soft)] pt-2">
                      <input
                        ref={companionPromptRef}
                        value={composerState.companionPrompt ?? ''}
                        onChange={(e) => setComposerState((prev) => ({ ...prev, companionPrompt: e.target.value || null }))}
                        placeholder="Companion prompt…"
                        disabled={!activeRoomId || sendMessage.isPending}
                        className="w-full rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] px-3 py-2 font-mono text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--sel-bd)]"
                      />
                    </div>
                  )}

                  {composerState.attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {composerState.attachments.map((attachment) => (
                        <span
                          key={attachment.id}
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--border-soft)] bg-[var(--panel)] px-2 py-1 font-mono text-[10px] text-[var(--text)]"
                        >
                          <span className="truncate max-w-[140px]">{attachment.name}</span>
                          <button
                            type="button"
                            onClick={() => removeAttachment(attachment.id)}
                            className="text-[var(--muted)] transition hover:text-[var(--text)]"
                            aria-label={`Remove ${attachment.name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-1 pt-1.5">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        appendAttachments(e.target.files, 'file')
                        e.currentTarget.value = ''
                      }}
                    />
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        appendAttachments(e.target.files, 'image')
                        e.currentTarget.value = ''
                      }}
                    />
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowComposerMenu((current) => !current)}
                        disabled={!activeRoomId || sendMessage.isPending}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-soft)] bg-[var(--panel)] text-[var(--muted)] transition hover:bg-[var(--panel-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-45"
                        aria-label="Composer actions"
                        title="Composer actions"
                      >
                        <Menu size={14} />
                      </button>
                      {showComposerMenu && activeRoomId && !sendMessage.isPending && (
                        <div className="absolute bottom-9 left-0 z-20 min-w-[170px] rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] p-1 shadow-lg shadow-black/20">
                          <button
                            type="button"
                            onClick={() => {
                              setShowComposerMenu(false)
                              fileInputRef.current?.click()
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-mono text-[11px] text-[var(--text)] transition hover:bg-[var(--panel-strong)]"
                          >
                            <Paperclip size={14} />
                            <span>Attach files</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowComposerMenu(false)
                              imageInputRef.current?.click()
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-mono text-[11px] text-[var(--text)] transition hover:bg-[var(--panel-strong)]"
                          >
                            <Paperclip size={14} />
                            <span>Attach image</span>
                          </button>
                          <button
                            type="button"
                            onClick={toggleCompanionPrompt}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-mono text-[11px] text-[var(--text)] transition hover:bg-[var(--panel-strong)]"
                          >
                            <Wand2 size={14} />
                            <span>{showCompanionPrompt || composerState.companionPrompt !== null ? 'Hide prompt' : 'Add prompt'}</span>
                          </button>
                        </div>
                      )}
                    </div>


                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const next = !composerState.tools.webSearch
                          setComposerState(prev => ({ ...prev, tools: { ...prev.tools, webSearch: next } }))
                          showComposerToastMessage(`Web search ${next ? 'On' : 'Off'}`)
                        }}
                        disabled={!activeRoomId || sendMessage.isPending}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
                          composerState.tools.webSearch
                            ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-400'
                            : 'border-[var(--border-soft)] bg-[var(--panel)] text-[var(--muted)] hover:bg-[var(--panel-strong)]'
                        }`}
                        aria-label="Toggle web search"
                        title="Web search"
                      >
                        <Globe size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !composerState.tools.shell
                          setComposerState(prev => ({ ...prev, tools: { ...prev.tools, shell: next } }))
                          showComposerToastMessage(`Shell ${next ? 'On' : 'Off'}`)
                        }}
                        disabled={!activeRoomId || sendMessage.isPending}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
                          composerState.tools.shell
                            ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-400'
                            : 'border-[var(--border-soft)] bg-[var(--panel)] text-[var(--muted)] hover:bg-[var(--panel-strong)]'
                        }`}
                        aria-label="Toggle shell"
                        title="Shell"
                      >
                        <TerminalSquare size={16} />
                      </button>
                    </div>

                    <div className="ml-auto flex shrink-0 items-center gap-1 rounded-xl border border-[var(--border-soft)] bg-[var(--panel)] p-0.5">
                      <button
                        type="button"
                        onClick={() => setComposerState(prev => ({ ...prev, mode: 'planning' }))}
                        disabled={!activeRoomId || sendMessage.isPending}
                        className={`rounded-lg px-2 py-2 font-mono text-[10px] uppercase tracking-wide transition ${
                          composerState.mode === 'planning'
                            ? 'bg-[var(--sel-bg)] text-blue-400'
                            : 'text-[var(--muted)] hover:bg-[var(--panel-strong)]'
                        }`}
                      >
                        Plan
                      </button>
                      <button
                        type="button"
                        onClick={() => setComposerState(prev => ({ ...prev, mode: 'agent' }))}
                        disabled={!activeRoomId || sendMessage.isPending}
                        className={`rounded-lg px-2 py-2 font-mono text-[10px] uppercase tracking-wide transition ${
                          composerState.mode === 'agent'
                            ? 'bg-[var(--sel-bg)] text-blue-400'
                            : 'text-[var(--muted)] hover:bg-[var(--panel-strong)]'
                        }`}
                      >
                        Agent
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={!canSendMessage}
                      onClick={submitMessage}
                      className="shrink-0 rounded-xl border border-[var(--sel-bd)] bg-[var(--sel-bg)] px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-blue-400 transition hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-45"
                      aria-label="Send message"
                    >
                      {sendMessage.isPending ? '…' : '↗'}
                    </button>
                  </div>
                </div>
              </div>
              {sendMessage.isError && (
                <div className="shrink-0 border-t border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)] px-4 py-2 font-mono text-xs text-[var(--s-blk-tx)]">
                  {(sendMessage.error as Error).message}
                </div>
              )}

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
                      <div className="mt-1 font-mono text-[11px] text-[var(--muted)]">{item.owner_label || primeName} · {laneLabel(item.status)}</div>
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

          {/* Bottom Action Toolbar Pane */}
          {activeRoomId && (
            <div className="shrink-0 border-t border-[var(--border-soft)] bg-[var(--panel)] px-4 py-2">
              <BottomActionToolbar
                drafts={toolbarDrafts}
                onOpenDraft={handleOpenDraft}
                onCancelDraft={handleCancelDraft}
                compact
                inline
              />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[var(--muted)]">
          <span className="font-mono text-xs uppercase tracking-widest">select a room</span>
        </div>
      )}

      {composerToast && (
        <div className="pointer-events-none fixed bottom-5 right-5 z-50">
          <div className="relative flex h-11 w-52 items-center overflow-hidden rounded-xl border border-cyan-400/40 bg-slate-950/90 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.25)] animate-[pulse_1.1s_ease-in-out_2]">
            <span className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(34,211,238,0.12)_45%,transparent_100%)] animate-[pulse_0.9s_ease-in-out_2]" />
            <span className="relative block w-full text-center">{composerToast}</span>
          </div>
        </div>
      )}
    </div>
  )
}
