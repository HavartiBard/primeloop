import { useQuery } from '@tanstack/react-query'
import {
  fetchAgents,
  fetchEvents,
  fetchRuntimeAuditLoops,
  fetchRuntimeDelegations,
  fetchRuntimeMemory,
  fetchRuntimeOverview,
  fetchRuntimeWorkItems,
  fetchThreads,
} from '../api'
import { useApprovals } from '../hooks/useApprovals'
import { useAgentRegistry } from '../hooks/useAgentRegistry'
import { useWebSocket } from '../hooks/useWebSocket'
import { CollaborationRoomsView } from '../components/CollaborationRoomsView'
import type { AgentEvent, ChiefProfile } from '../types'

const DEFAULT_PROFILE: ChiefProfile = {
  name: 'Chief of Staff',
  persona: 'Pragmatic executive operations agent for homelab planning, delegation, and approvals.',
  policy: 'Keep work moving with bounded delegation, durable memory, scoped escalation, and concise status reporting.',
  preferences: [
    'Prefer direct execution over excessive planning.',
    'Route risky actions through explicit approval lanes.',
    'Surface blockers and stale work before opening new threads.',
  ],
  recurringDuties: [
    'Review open work hourly.',
    'Audit stale approvals and blocked tasks.',
    'Track PRs, reviews, deployments, and follow-ups through completion.',
  ],
  priorDecisions: [
    'Use a single persistent coordinator rather than stateless chat.',
    'Keep subagents specialist and bounded by scope.',
    'Preserve concise human-readable status updates in the portal.',
  ],
}

function cardClass(extra = '') {
  return `rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] shadow-[0_18px_48px_rgba(2,6,23,0.18)] backdrop-blur ${extra}`.trim()
}

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Waiting'
}

function findChiefTypeName(name?: string, type?: string) {
  return type ?? name ?? 'Persistent coordinator'
}

function mergeEvents(liveEvents: AgentEvent[], historyEvents: AgentEvent[]) {
  const pool = liveEvents.length > 0 ? [...liveEvents, ...historyEvents] : historyEvents
  const seen = new Set<string>()
  return pool.filter((event) => {
    if (seen.has(event.id)) return false
    seen.add(event.id)
    return true
  }).slice(0, 12)
}

export function OperationsPortal() {
  const { approvals } = useApprovals()
  const { agents } = useAgentRegistry()
  const { events: liveEvents, connected } = useWebSocket('/ws')

  const { data: healthData = [] } = useQuery({
    queryKey: ['agents', 'health'],
    queryFn: fetchAgents,
    refetchInterval: 30_000,
  })

  const { data: historyEvents = [] } = useQuery({
    queryKey: ['events', 'operations-portal'],
    queryFn: () => fetchEvents({ limit: 24 }),
    refetchInterval: 20_000,
  })

  const { data: runtimeOverview } = useQuery({
    queryKey: ['runtime-overview'],
    queryFn: fetchRuntimeOverview,
    refetchInterval: 15_000,
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

  const { data: memories = [] } = useQuery({
    queryKey: ['runtime-memory'],
    queryFn: () => fetchRuntimeMemory(),
    refetchInterval: 30_000,
  })

  const { data: auditLoops = [] } = useQuery({
    queryKey: ['runtime-audit-loops'],
    queryFn: fetchRuntimeAuditLoops,
    refetchInterval: 30_000,
  })

  const profile: ChiefProfile = runtimeOverview?.chief
    ? {
        name: runtimeOverview.chief.name,
        persona: runtimeOverview.chief.persona,
        policy: runtimeOverview.chief.operating_policy,
        preferences: memories.filter((m) => m.category === 'preference').map((m) => m.content),
        recurringDuties: memories.filter((m) => m.category === 'recurring-duty').map((m) => m.content),
        priorDecisions: memories.filter((m) => m.category === 'prior-decision').map((m) => m.content),
      }
    : DEFAULT_PROFILE

  if (profile.preferences.length === 0) profile.preferences = DEFAULT_PROFILE.preferences
  if (profile.recurringDuties.length === 0) profile.recurringDuties = DEFAULT_PROFILE.recurringDuties
  if (profile.priorDecisions.length === 0) profile.priorDecisions = DEFAULT_PROFILE.priorDecisions

  const chief = agents.find((agent) => {
    const key = `${agent.name} ${agent.type}`.toLowerCase()
    return key.includes('chief') || key.includes('staff') || key.includes('coord')
  })

  const visibleEvents = mergeEvents(liveEvents, historyEvents)
  const latestEvent = visibleEvents[0]
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending').length
  const activeWork = workItems.filter((item) => item.status === 'active').length
  const openRooms = threads.filter((thread) => thread.status !== 'closed').length
  const memoryCount = profile.preferences.length + profile.recurringDuties.length + profile.priorDecisions.length

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col px-4 py-4 sm:px-6 lg:px-8">
      <section className={`${cardClass()} mb-4 px-4 py-3 shrink-0`}>
        <div className="flex flex-wrap items-center gap-2">
          {[
            `${activeWork} active work`,
            `${pendingApprovals} approvals`,
            `${openRooms} open rooms`,
            `${memoryCount} memory`,
            `${agents.filter((agent) => agent.enabled).length} agents`,
            `${auditLoops.length} audits`,
            connected ? 'streaming' : 'polling',
            latestEvent ? `event ${formatTime(latestEvent.created_at)}` : 'awaiting events',
          ].map((item) => (
            <div key={item} className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-hidden rounded-[1.2rem] border border-[var(--border-soft)]">
        <CollaborationRoomsView
          chiefName={profile.name}
          connected={connected}
          agents={agents}
          healthData={healthData}
          workItems={workItems}
          delegations={delegations}
          threads={threads}
          pendingApprovals={pendingApprovals}
          auditLoops={auditLoops}
        />
      </section>
    </div>
  )
}
