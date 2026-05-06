import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createThread,
  fetchAgents,
  fetchEvents,
  fetchRuntimeAuditLoops,
  fetchRuntimeDelegations,
  fetchRuntimeMemory,
  fetchRuntimeOverview,
  fetchRuntimeWorkItems,
  fetchThreadMessages,
  fetchThreads,
  runRuntimeDelegation,
  sendChiefMessage,
} from '../api'
import { useApprovals } from '../hooks/useApprovals'
import { useAgentRegistry } from '../hooks/useAgentRegistry'
import { useProviders } from '../hooks/useProviders'
import { useWebSocket } from '../hooks/useWebSocket'
import { LiveCircuitMap } from '../components/LiveCircuitMap'
import type {
  AgentEvent,
  RegistryAgent,
  StatusUpdate,
  ChiefProfile,
  PermissionRule,
  RuntimeWorkItem,
} from '../types'

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

const DEFAULT_STATUS_UPDATES: StatusUpdate[] = [
  {
    id: 'su-1',
    text: 'Portal bootstrap started. Chief of Staff is assembling live context from agents, tools, and approvals.',
    created_at: new Date().toISOString(),
  },
]

const DEFAULT_RULES: PermissionRule[] = [
  { scope: 'Filesystem writes', mode: 'Scoped', note: 'Allow within approved workspace roots only.' },
  { scope: 'Shell escalation', mode: 'Approval', note: 'Require explicit approval before unrestricted execution.' },
  { scope: 'GitHub/Gitea', mode: 'Delegated', note: 'Permit PR, review, and issue actions through tracked work items.' },
  { scope: 'Browser/docs/slides/sheets', mode: 'Open', note: 'Read-first unless a task requires edits or publication.' },
]

const TOOL_CAPABILITIES = [
  'Files',
  'Shell',
  'Browser',
  'GitHub / Gitea',
  'Docs',
  'Slides',
  'Spreadsheets',
]

function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString() : 'Waiting'
}

function cardClass(extra = '') {
  return `rounded-[1.6rem] border border-white/10 bg-white/6 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur ${extra}`.trim()
}

function toneClass(status: string) {
  if (status === 'active') return 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100'
  if (status === 'blocked') return 'border-rose-300/20 bg-rose-300/10 text-rose-100'
  if (status === 'approval') return 'border-amber-300/20 bg-amber-300/10 text-amber-100'
  if (status === 'review') return 'border-violet-300/20 bg-violet-300/10 text-violet-100'
  if (status === 'deploy') return 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100'
  return 'border-slate-300/20 bg-slate-300/10 text-slate-100'
}

function findChief(agents: RegistryAgent[]) {
  return agents.find((agent) => {
    const key = `${agent.name} ${agent.type}`.toLowerCase()
    return key.includes('chief') || key.includes('staff') || key.includes('coord')
  })
}

function mergeEvents(liveEvents: AgentEvent[], historyEvents: AgentEvent[]) {
  const pool = liveEvents.length > 0 ? [...liveEvents, ...historyEvents] : historyEvents
  const seen = new Set<string>()
  return pool.filter((event) => {
    if (seen.has(event.id)) return false
    seen.add(event.id)
    return true
  }).slice(0, 8)
}

export function OperationsPortal() {
  const queryClient = useQueryClient()
  const { approvals, approve, deny } = useApprovals()
  const { agents } = useAgentRegistry()
  const { providers } = useProviders()
  const { events: liveEvents, connected } = useWebSocket('/ws')
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

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

  const activeThreadId = selectedThreadId ?? threads[0]?.id

  const { data: messages = [] } = useQuery({
    queryKey: ['thread-messages', activeThreadId],
    queryFn: () => fetchThreadMessages(activeThreadId as string),
    enabled: Boolean(activeThreadId),
    refetchInterval: 10_000,
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

  const sendMessage = useMutation({
    mutationFn: async (content: string) => {
      let threadId = activeThreadId
      if (!threadId) {
        const thread = await createThread({ title: content.slice(0, 80) || 'Operations thread' })
        threadId = thread.id
        setSelectedThreadId(thread.id)
      }

      await sendChiefMessage(threadId, {
        content,
        sender: 'james',
      })

      return threadId
    },
    onSuccess: (threadId) => {
      setDraft('')
      setSelectedThreadId(threadId)
      queryClient.invalidateQueries({ queryKey: ['threads'] })
      queryClient.invalidateQueries({ queryKey: ['thread-messages', threadId] })
      queryClient.invalidateQueries({ queryKey: ['runtime-work-items'] })
      queryClient.invalidateQueries({ queryKey: ['runtime-delegations'] })
      queryClient.invalidateQueries({ queryKey: ['runtime-overview'] })
    },
  })

  const runDelegation = useMutation({
    mutationFn: runRuntimeDelegation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runtime-delegations'] })
      queryClient.invalidateQueries({ queryKey: ['runtime-work-items'] })
      queryClient.invalidateQueries({ queryKey: ['runtime-overview'] })
      if (activeThreadId) {
        queryClient.invalidateQueries({ queryKey: ['thread-messages', activeThreadId] })
      }
    },
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

  const permissionRules = DEFAULT_RULES
  const chief = findChief(agents)
  const healthyAgents = healthData.filter((agent) => agent.healthy).length
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending')
  const activeItems = workItems.filter((item) => item.status === 'active')
  const blockedItems = workItems.filter((item) => item.status === 'blocked')
  const visibleEvents = useMemo(() => mergeEvents(liveEvents, historyEvents), [historyEvents, liveEvents])
  const latestEvent = visibleEvents[0]
  const computedStatusUpdates = useMemo<StatusUpdate[]>(() => {
    const staleBlockedWork = workItems.some((item) => item.status === 'blocked')
    const nextText = staleBlockedWork
      ? `Blocked work detected. Chief of Staff is holding ${blockedItems.length} blocked items and ${pendingApprovals.length} pending approvals in view.`
      : `Control loop healthy. ${activeItems.length} active items, ${pendingApprovals.length} pending approvals, ${providers.length} connected tool providers.`

    return [
      { id: 'live-summary', text: nextText, created_at: new Date().toISOString() },
      ...(runtimeOverview?.recent_events ?? []).map((event) => ({
        id: event.id,
        text: `${event.actor}: ${event.event_type}`,
        created_at: event.created_at,
      })),
      ...DEFAULT_STATUS_UPDATES,
    ].slice(0, 8)
  }, [activeItems.length, blockedItems.length, pendingApprovals.length, providers.length, runtimeOverview?.recent_events, workItems])

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault()
    const content = draft.trim()
    if (!content || sendMessage.isPending) return
    sendMessage.mutate(content)
  }

  return (
    <div className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <section className={`${cardClass()} mb-5 px-4 py-3 sm:px-5`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--muted)]">
            {profile.name}
          </div>
          <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-xs text-[var(--muted)]">
            {chief?.type ?? 'Persistent coordinator'}
          </div>
          <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-xs text-[var(--muted)]">
            {connected ? 'Streaming' : 'Polling'}
          </div>
          <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-xs text-[var(--muted)]">
            {agents.filter((agent) => agent.enabled).length} agents
          </div>
          <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-xs text-[var(--muted)]">
            {healthyAgents} healthy
          </div>
          <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-xs text-[var(--muted)]">
            {TOOL_CAPABILITIES.length} tools
          </div>
          <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-xs text-[var(--muted)]">
            {profile.preferences.length + profile.recurringDuties.length + profile.priorDecisions.length} memory
          </div>
          <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-xs text-[var(--muted)]">
            {pendingApprovals.length} approvals
          </div>
          {latestEvent && (
            <div className="rounded-full border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1 text-xs text-[var(--muted)]">
              Event {formatTime(latestEvent.created_at)}
            </div>
          )}
        </div>
      </section>

      <section className={`${cardClass()} mb-5 grid gap-4 p-5 sm:p-6 xl:grid-cols-[0.75fr_1.25fr]`}>
        <div>
          <h2 className="text-xl font-semibold text-white">Chief Desk</h2>
          <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
            {threads.map((thread) => (
              <button
                key={thread.id}
                onClick={() => setSelectedThreadId(thread.id)}
                className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                  activeThreadId === thread.id
                    ? 'border-cyan-300/30 bg-cyan-300/10 text-white'
                    : 'border-white/10 bg-black/16 text-slate-300 hover:bg-white/8'
                }`}
              >
                <div className="font-medium">{thread.title}</div>
                <div className="mt-1 text-xs text-slate-500">{thread.status} · {formatTime(thread.updated_at)}</div>
              </button>
            ))}
            {threads.length === 0 && (
              <div className="rounded-lg border border-dashed border-white/12 bg-black/14 p-4 text-sm text-slate-400">
                No active threads yet.
              </div>
            )}
          </div>
        </div>

        <div className="flex min-h-[18rem] flex-col rounded-lg border border-white/10 bg-black/16">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((message) => (
              <div key={message.id} className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{message.sender} · {message.role}</div>
                  <div className="text-xs text-slate-500">{formatTime(message.created_at)}</div>
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-100">{message.content}</div>
              </div>
            ))}
            {messages.length === 0 && (
              <div className="rounded-lg border border-dashed border-white/12 bg-black/14 p-4 text-sm text-slate-400">
                Send a request to persist a thread message and open an intake work item.
              </div>
            )}
          </div>
          <form onSubmit={handleSend} className="border-t border-white/10 p-3">
            <div className="flex gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask the Chief of Staff to plan, delegate, audit, review, or follow up..."
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-300/40 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!draft.trim() || sendMessage.isPending}
                className="rounded-lg border border-cyan-300/30 bg-cyan-300/12 px-4 py-2 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="grid gap-5 2xl:grid-cols-[1.15fr_0.85fr]">
        <div className="grid gap-5">
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Live Circuit Map</h2>
                <p className="mt-1 text-sm text-slate-400">Visible routing between user, primary agent, specialist agents, collaboration rooms, and active workstreams.</p>
              </div>
              <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-slate-300">
                Long-running workflow graph
              </div>
            </div>
            <LiveCircuitMap
              chiefName={profile.name}
              connected={connected}
              agents={agents}
              healthData={healthData}
              workItems={workItems}
              delegations={delegations}
              threads={threads}
              pendingApprovals={pendingApprovals.length}
            />
          </div>

          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className={`${cardClass()} p-5 sm:p-6`}>
              <h2 className="text-xl font-semibold text-white">Persistent Memory</h2>
              <p className="mt-1 text-sm text-slate-400">Cross-turn context for preferences, recurring duties, and prior decisions.</p>
              <div className="mt-4 space-y-4">
                <div className="rounded-[1.2rem] border border-white/10 bg-black/16 p-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Preferences</div>
                  <div className="mt-2 space-y-2 text-sm text-slate-300">
                    {profile.preferences.map((item) => <div key={item}>{item}</div>)}
                  </div>
                </div>
                <div className="rounded-[1.2rem] border border-white/10 bg-black/16 p-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Recurring Duties</div>
                  <div className="mt-2 space-y-2 text-sm text-slate-300">
                    {profile.recurringDuties.map((item) => <div key={item}>{item}</div>)}
                  </div>
                </div>
                <div className="rounded-[1.2rem] border border-white/10 bg-black/16 p-4">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Prior Decisions</div>
                  <div className="mt-2 space-y-2 text-sm text-slate-300">
                    {profile.priorDecisions.map((item) => <div key={item}>{item}</div>)}
                  </div>
                </div>
              </div>
            </div>

            <div className={`${cardClass()} p-5 sm:p-6`}>
              <h2 className="text-xl font-semibold text-white">Work Ledger</h2>
              <p className="mt-1 text-sm text-slate-400">Track handoffs, blockers, approvals, PRs, reviews, deployments, and follow-ups.</p>
              <div className="mt-4 space-y-3">
                {workItems.map((item) => (
                  <div key={item.id} className="rounded-[1.25rem] border border-white/10 bg-black/16 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">{item.title}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{item.owner_label} · {item.lane} · {item.priority}</div>
                      </div>
                      <div className={`rounded-full border px-3 py-1 text-xs ${toneClass(item.status)}`}>
                        {item.status}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-400">Updated {formatTime(item.updated_at)}</div>
                  </div>
                ))}
                {workItems.length === 0 && (
                  <div className="rounded-[1.25rem] border border-dashed border-white/12 bg-black/14 p-4 text-sm text-slate-400">
                    No work items are currently tracked.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-5">
          <div className={`${cardClass()} p-5 sm:p-6`}>
            <h2 className="text-xl font-semibold text-white">Governance</h2>
            <p className="mt-1 text-sm text-slate-400">Approvals, escalations, and scoped command rules.</p>
            <div className="mt-4 space-y-3">
              {permissionRules.map((rule) => (
                <div key={rule.scope} className="rounded-[1.2rem] border border-white/10 bg-black/16 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">{rule.scope}</div>
                    <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-slate-200">{rule.mode}</div>
                  </div>
                  <div className="mt-2 text-sm text-slate-300">{rule.note}</div>
                </div>
              ))}
            </div>
            <div className="mt-5 space-y-3">
              {pendingApprovals.slice(0, 3).map((approval) => (
                <div key={approval.approval_id} className="rounded-[1.2rem] border border-amber-300/20 bg-amber-300/10 p-4">
                  <div className="text-sm font-medium text-white">{approval.action}</div>
                  <div className="mt-1 text-xs text-amber-50/70">Run {approval.run_id}</div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => approve(approval.approval_id)}
                      className="rounded-full border border-emerald-300/20 bg-emerald-300/12 px-3 py-1.5 text-xs text-emerald-50 transition hover:bg-emerald-300/20"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => deny(approval.approval_id)}
                      className="rounded-full border border-rose-300/20 bg-rose-300/12 px-3 py-1.5 text-xs text-rose-50 transition hover:bg-rose-300/20"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
              {pendingApprovals.length === 0 && (
                <div className="rounded-[1.2rem] border border-dashed border-white/12 bg-black/14 p-4 text-sm text-slate-400">
                  No pending approvals. Escalation lanes are currently clear.
                </div>
              )}
            </div>
          </div>

          <div className={`${cardClass()} p-5 sm:p-6`}>
            <h2 className="text-xl font-semibold text-white">Delegation Queue</h2>
            <p className="mt-1 text-sm text-slate-400">Queued and blocked subagent work with explicit execution controls.</p>
            <div className="mt-4 space-y-3">
              {delegations.slice(0, 6).map((delegation) => {
                const agent = agents.find((item) => item.id === delegation.to_agent_id)
                return (
                  <div key={delegation.id} className="rounded-[1.2rem] border border-white/10 bg-black/16 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-white">{delegation.capability}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                          {agent?.name ?? 'unassigned'} · {delegation.status}
                        </div>
                      </div>
                      {delegation.status === 'queued' && (
                        <button
                          onClick={() => runDelegation.mutate(delegation.id)}
                          disabled={runDelegation.isPending}
                          className="rounded-lg border border-emerald-300/25 bg-emerald-300/12 px-3 py-1.5 text-xs font-medium text-emerald-50 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Run
                        </button>
                      )}
                    </div>
                    <div className="mt-2 text-xs text-slate-400">Updated {formatTime(delegation.updated_at)}</div>
                  </div>
                )
              })}
              {delegations.length === 0 && (
                <div className="rounded-[1.2rem] border border-dashed border-white/12 bg-black/14 p-4 text-sm text-slate-400">
                  No delegations are queued.
                </div>
              )}
            </div>
          </div>

          <div className={`${cardClass()} p-5 sm:p-6`}>
            <h2 className="text-xl font-semibold text-white">Proactive Audit Loops</h2>
            <p className="mt-1 text-sm text-slate-400">Background operating loops for stale work, queue drift, and incomplete follow-through.</p>
            <div className="mt-4 space-y-3">
              {auditLoops.map((loop) => (
                <div key={loop.id} className="rounded-[1.2rem] border border-white/10 bg-black/16 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-white">{loop.name}</div>
                    <div className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs text-slate-200">{loop.cadence_cron}</div>
                  </div>
                  <div className="mt-2 text-sm text-slate-300">{loop.purpose}</div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                    <div>Last run: {formatTime(loop.last_run_at)}</div>
                    <div>Next run: {formatTime(loop.next_run_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={`${cardClass()} p-5 sm:p-6`}>
            <h2 className="text-xl font-semibold text-white">Status Updates</h2>
            <p className="mt-1 text-sm text-slate-400">Concise updates whenever work starts, branches, blocks, changes, or completes.</p>
            <div className="mt-4 space-y-3">
              {computedStatusUpdates.map((update) => (
                <div key={update.id} className="rounded-[1.2rem] border border-white/10 bg-black/16 p-4">
                  <div className="text-sm text-white">{update.text}</div>
                  <div className="mt-2 text-xs text-slate-400">{formatTime(update.created_at)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className={`${cardClass()} p-5 sm:p-6`}>
            <h2 className="text-xl font-semibold text-white">Live Operations Feed</h2>
            <p className="mt-1 text-sm text-slate-400">Recent activity from agents and operational systems.</p>
            <div className="mt-4 space-y-3">
              {visibleEvents.map((event) => (
                <div key={event.id} className="rounded-[1.2rem] border border-white/10 bg-black/16 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-white">{event.type}</div>
                    <div className="text-xs text-slate-500">{formatTime(event.created_at)}</div>
                  </div>
                  <div className="mt-2 text-sm text-slate-300">{event.agent}</div>
                </div>
              ))}
              {visibleEvents.length === 0 && (
                <div className="rounded-[1.2rem] border border-dashed border-white/12 bg-black/14 p-4 text-sm text-slate-400">
                  No events received yet. The portal will populate this feed when agents begin emitting activity.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
