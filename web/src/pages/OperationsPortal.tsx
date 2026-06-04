import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchAgents,
  fetchRuntimeAuditLoops,
  fetchRuntimeDelegations,
  fetchRuntimeEvents,
  fetchRuntimeMemory,
  fetchRuntimeOverview,
  fetchRuntimeWorkItems,
  fetchThreads,
} from '../api'
import { useApprovals } from '../hooks/useApprovals'
import { useAgentRegistry } from '../hooks/useAgentRegistry'
import { useWebSocket } from '../hooks/useWebSocket'
import { CollaborationRoomsView, type InspectorTabSnapshot } from '../components/CollaborationRoomsView'
import type { PrimeProfile } from '../types'

const DEFAULT_PROFILE: PrimeProfile = {
  name: 'Prime',
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

export function OperationsPortal({ onOpenInspector, activeInspectorId }: { onOpenInspector?: (tab: InspectorTabSnapshot) => void; activeInspectorId?: string | null } = {}) {
  const { approvals } = useApprovals()
  const { agents } = useAgentRegistry()
  const { connected, events } = useWebSocket('/ws')

  const { data: healthData = [] } = useQuery({
    queryKey: ['agents', 'health'],
    queryFn: fetchAgents,
    refetchInterval: 30_000,
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

  const { data: persistedEvents = [] } = useQuery({
    queryKey: ['runtime-events'],
    queryFn: () => fetchRuntimeEvents(500),
    refetchInterval: 15_000,
  })

  const profile: PrimeProfile = runtimeOverview?.prime
    ? {
        name: runtimeOverview.prime.name,
        persona: runtimeOverview.prime.persona,
        policy: runtimeOverview.prime.operating_policy,
        preferences: memories.filter((m) => m.category === 'preference').map((m) => m.content),
        recurringDuties: memories.filter((m) => m.category === 'recurring-duty').map((m) => m.content),
        priorDecisions: memories.filter((m) => m.category === 'prior-decision').map((m) => m.content),
      }
    : DEFAULT_PROFILE

  if (profile.preferences.length === 0) profile.preferences = DEFAULT_PROFILE.preferences
  if (profile.recurringDuties.length === 0) profile.recurringDuties = DEFAULT_PROFILE.recurringDuties
  if (profile.priorDecisions.length === 0) profile.priorDecisions = DEFAULT_PROFILE.priorDecisions

  const mergedEvents = useMemo(() => {
    const normalizedPersisted = persistedEvents.map((event) => ({
      id: event.id,
      agent: event.actor,
      type: event.event_type,
      payload: {
        ...event.payload,
        ...(event.thread_id ? { thread_id: event.thread_id } : {}),
        ...(event.work_item_id ? { work_item_id: event.work_item_id } : {}),
        ...(event.delegation_id ? { delegation_id: event.delegation_id } : {}),
      },
      created_at: event.created_at,
    }))
    const byId = new Map([...normalizedPersisted, ...events].map((event) => [event.id, event]))
    return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
  }, [persistedEvents, events])

  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending').length

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col px-3 py-3 sm:px-4 lg:px-5">
      <section className="min-h-0 flex-1 overflow-hidden rounded-[1.2rem] border border-[var(--border-soft)]">
        <CollaborationRoomsView
          primeName={profile.name}
          connected={connected}
          events={mergedEvents}
          agents={agents}
          healthData={healthData}
          workItems={workItems}
          delegations={delegations}
          threads={threads}
          pendingApprovals={pendingApprovals}
          auditLoops={auditLoops}
          onOpenInspector={onOpenInspector}
          activeInspectorId={activeInspectorId}
        />
      </section>
    </div>
  )
}
