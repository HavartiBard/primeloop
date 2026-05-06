import type { RegistryAgent, RuntimeDelegation, RuntimeThread, RuntimeWorkItem } from '../types'

type AgentHealth = {
  agent: string
  last_seen: string
  healthy: boolean
}

type LiveCircuitMapProps = {
  chiefName: string
  connected: boolean
  agents: RegistryAgent[]
  healthData: AgentHealth[]
  workItems: RuntimeWorkItem[]
  delegations: RuntimeDelegation[]
  threads: RuntimeThread[]
  pendingApprovals: number
}

type NodeTone = 'cyan' | 'orange' | 'emerald' | 'violet' | 'rose' | 'slate'

type AgentNode = {
  id: string
  name: string
  subtitle: string
  state: string
  tone: NodeTone
  healthy: boolean
  x: number
  y: number
}

type RoomNode = {
  id: string
  title: string
  subtitle: string
  state: string
  tone: NodeTone
  x: number
  y: number
}

type StreamNode = {
  id: string
  title: string
  subtitle: string
  state: string
  tone: NodeTone
  x: number
  y: number
}

type CircuitCardProps = {
  x: number
  y: number
  width: number
  height: number
  eyebrow: string
  title: string
  subtitle: string
  state: string
  tone: NodeTone
  align?: 'left' | 'center'
  emphasis?: 'normal' | 'strong'
}

const WIDTH = 1200
const HEIGHT = 720
const CARD_W = 188
const CARD_H = 92

function laneLabel(value: string) {
  return value
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

function statusTone(state: string): NodeTone {
  if (state === 'active' || state === 'live' || state === 'running') return 'cyan'
  if (state === 'blocked' || state === 'stalled') return 'rose'
  if (state === 'review' || state === 'approval' || state === 'waiting') return 'violet'
  if (state === 'healthy' || state === 'ready') return 'emerald'
  if (state === 'degraded' || state === 'offline') return 'slate'
  return 'orange'
}

function cardTone(tone: NodeTone) {
  if (tone === 'cyan') return 'border-cyan-300/30 bg-cyan-300/10 text-cyan-50'
  if (tone === 'orange') return 'border-orange-300/30 bg-orange-300/10 text-orange-50'
  if (tone === 'emerald') return 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50'
  if (tone === 'violet') return 'border-violet-300/30 bg-violet-300/10 text-violet-50'
  if (tone === 'rose') return 'border-rose-300/30 bg-rose-300/10 text-rose-50'
  return 'border-white/12 bg-white/6 text-slate-100'
}

function chipTone(tone: NodeTone) {
  if (tone === 'cyan') return 'border-cyan-300/25 bg-cyan-300/12 text-cyan-100'
  if (tone === 'orange') return 'border-orange-300/25 bg-orange-300/12 text-orange-100'
  if (tone === 'emerald') return 'border-emerald-300/25 bg-emerald-300/12 text-emerald-100'
  if (tone === 'violet') return 'border-violet-300/25 bg-violet-300/12 text-violet-100'
  if (tone === 'rose') return 'border-rose-300/25 bg-rose-300/12 text-rose-100'
  return 'border-white/10 bg-white/8 text-slate-200'
}

function lineTone(tone: NodeTone) {
  if (tone === 'cyan') return 'rgba(103,232,249,0.9)'
  if (tone === 'orange') return 'rgba(253,186,116,0.9)'
  if (tone === 'emerald') return 'rgba(110,231,183,0.88)'
  if (tone === 'violet') return 'rgba(196,181,253,0.88)'
  if (tone === 'rose') return 'rgba(251,113,133,0.88)'
  return 'rgba(148,163,184,0.75)'
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value
}

function pickStateLabel(state: string) {
  return laneLabel(state)
}

function summarizeAgentState(agent: RegistryAgent, health: AgentHealth | undefined, workItems: RuntimeWorkItem[], delegations: RuntimeDelegation[]) {
  const owned = workItems.filter((item) => item.owner_agent_id === agent.id)
  const active = owned.filter((item) => item.status === 'active').length
  const blocked = owned.filter((item) => item.status === 'blocked').length
  const inbound = delegations.filter((item) => item.to_agent_id === agent.id && item.status !== 'completed').length

  if (!agent.enabled) return { state: 'offline', subtitle: 'disabled in registry', healthy: false }
  if (health && !health.healthy) return { state: 'degraded', subtitle: 'heartbeat degraded', healthy: false }
  if (blocked > 0) return { state: 'blocked', subtitle: `${blocked} blocked item${blocked === 1 ? '' : 's'}`, healthy: true }
  if (active > 0 || inbound > 0) {
    return { state: 'active', subtitle: `${active + inbound} active handoff${active + inbound === 1 ? '' : 's'}`, healthy: true }
  }
  return { state: 'healthy', subtitle: agent.capabilities[0] ?? agent.runtime_family, healthy: true }
}

function buildRoomLaneMap(workItems: RuntimeWorkItem[]) {
  const roomLaneMap = new Map<string, Map<string, number>>()
  for (const item of workItems) {
    if (!item.thread_id) continue
    let laneMap = roomLaneMap.get(item.thread_id)
    if (!laneMap) {
      laneMap = new Map<string, number>()
      roomLaneMap.set(item.thread_id, laneMap)
    }
    laneMap.set(item.lane, (laneMap.get(item.lane) ?? 0) + 1)
  }
  return roomLaneMap
}

function buildDominantLaneLookup(workItems: RuntimeWorkItem[]) {
  const roomLaneMap = buildRoomLaneMap(workItems)
  const lookup = new Map<string, string>()
  for (const [threadId, lanes] of roomLaneMap.entries()) {
    const topLane = [...lanes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (topLane) lookup.set(threadId, topLane)
  }
  return lookup
}

function slotY(index: number, start: number, gap: number) {
  return start + index * gap
}

function CircuitCard({
  x,
  y,
  width,
  height,
  eyebrow,
  title,
  subtitle,
  state,
  tone,
  align = 'left',
  emphasis = 'normal',
}: CircuitCardProps) {
  const titleClass = emphasis === 'strong' ? 'text-lg font-semibold' : 'text-base font-semibold'
  const alignClass = align === 'center' ? 'items-center text-center' : 'items-start text-left'
  return (
    <div
      className={`absolute rounded-2xl border p-4 shadow-[0_18px_42px_rgba(2,6,23,0.34)] backdrop-blur ${cardTone(tone)} ${alignClass}`}
      style={{ left: x, top: y, width, height }}
    >
      <div className="text-[10px] uppercase tracking-[0.24em] text-white/60">{eyebrow}</div>
      <div className={`mt-2 ${titleClass} text-white`}>{title}</div>
      <div className="mt-1 text-xs leading-5 text-white/70">{subtitle}</div>
      <div className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${chipTone(tone)}`}>
        {pickStateLabel(state)}
      </div>
    </div>
  )
}

function circuitPath(points: Array<[number, number]>) {
  if (points.length === 0) return ''
  const [firstX, firstY] = points[0]
  return points.slice(1).reduce((path, [x, y]) => `${path} L ${x} ${y}`, `M ${firstX} ${firstY}`)
}

function Line({
  points,
  tone,
  width = 2,
  dash = false,
}: {
  points: Array<[number, number]>
  tone: NodeTone
  width?: number
  dash?: boolean
}) {
  return (
    <path
      d={circuitPath(points)}
      fill="none"
      stroke={lineTone(tone)}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={dash ? '5 9' : undefined}
    />
  )
}

export function LiveCircuitMap({
  chiefName,
  connected,
  agents,
  healthData,
  workItems,
  delegations,
  threads,
  pendingApprovals,
}: LiveCircuitMapProps) {
  const chief = agents.find((agent) => {
    const key = `${agent.name} ${agent.type}`.toLowerCase()
    return key.includes('chief') || key.includes('staff') || key.includes('coord')
  })
  const healthByName = new Map(healthData.map((entry) => [entry.agent.toLowerCase(), entry]))
  const visibleAgents = agents
    .filter((agent) => chief ? agent.id !== chief.id : true)
    .filter((agent) => agent.enabled || workItems.some((item) => item.owner_agent_id === agent.id))
    .slice(0, 5)
    .map((agent, index) => {
      const summary = summarizeAgentState(agent, healthByName.get(agent.name.toLowerCase()), workItems, delegations)
      return {
        id: agent.id,
        name: truncate(agent.name, 20),
        subtitle: truncate(summary.subtitle, 28),
        state: summary.state,
        tone: statusTone(summary.state),
        healthy: summary.healthy,
        x: 560,
        y: slotY(index, 86, 108),
      } satisfies AgentNode
    })

  const dominantLaneByRoom = buildDominantLaneLookup(workItems)
  const visibleRooms = threads.slice(0, 4).map((thread, index) => {
    const tone = thread.status === 'active' ? 'cyan' : thread.status === 'blocked' ? 'rose' : 'violet'
    return {
      id: thread.id,
      title: truncate(thread.title || 'Untitled room', 22),
      subtitle: dominantLaneByRoom.get(thread.id)
        ? `${laneLabel(dominantLaneByRoom.get(thread.id) as string)} stream`
        : `status: ${thread.status}`,
      state: thread.status || 'waiting',
      tone,
      x: 834,
      y: slotY(index, 118, 124),
    } satisfies RoomNode
  })

  const laneTotals = new Map<string, { total: number; active: number; blocked: number; review: number }>()
  for (const item of workItems) {
    const bucket = laneTotals.get(item.lane) ?? { total: 0, active: 0, blocked: 0, review: 0 }
    bucket.total += 1
    if (item.status === 'active') bucket.active += 1
    if (item.status === 'blocked') bucket.blocked += 1
    if (item.status === 'review' || item.status === 'approval') bucket.review += 1
    laneTotals.set(item.lane, bucket)
  }
  if (pendingApprovals > 0) {
    laneTotals.set('approval-lane', {
      total: pendingApprovals,
      active: 0,
      blocked: 0,
      review: pendingApprovals,
    })
  }

  const visibleStreams = [...laneTotals.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)
    .map(([lane, metrics], index) => {
      const state = metrics.blocked > 0 ? 'blocked' : metrics.review > 0 ? 'approval' : metrics.active > 0 ? 'active' : 'ready'
      const title = lane === 'approval-lane' ? 'Approvals' : laneLabel(lane)
      const subtitle = `${metrics.total} item${metrics.total === 1 ? '' : 's'} tracked`
      return {
        id: lane,
        title,
        subtitle,
        state,
        tone: statusTone(state),
        x: 224 + index * 180,
        y: 578,
      } satisfies StreamNode
    })

  const roomToStreamLines: Array<{ room: RoomNode; stream: StreamNode }> = []
  for (const room of visibleRooms) {
    const lane = dominantLaneByRoom.get(room.id)
    if (!lane) continue
    const stream = visibleStreams.find((item) => item.id === lane)
    if (!stream) continue
    roomToStreamLines.push({ room, stream })
  }

  const activeDelegations = delegations.filter((item) => item.status !== 'completed')
  const activeDelegationTargets = new Set(activeDelegations.map((item) => item.to_agent_id).filter(Boolean))

  return (
    <div className="overflow-x-auto">
      <div className="relative min-w-[1100px] overflow-hidden rounded-[1.4rem] border border-[var(--border-soft)] bg-[var(--panel)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_20%,rgba(56,189,248,0.1),transparent_22%),radial-gradient(circle_at_80%_18%,rgba(251,146,60,0.08),transparent_18%),radial-gradient(circle_at_50%_84%,rgba(168,85,247,0.06),transparent_20%)]" />
        <div className="relative flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--muted)]">Live Circuit Map</div>
            <div className="mt-1 text-sm text-[var(--muted)]">Agents, rooms, and workstreams wired to runtime state.</div>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-cyan-300 shadow-[0_0_18px_rgba(103,232,249,0.95)]' : 'bg-slate-500'}`} />
            {connected ? 'live feed' : 'polling'}
          </div>
        </div>

        <div className="relative h-[720px]">
          <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none">
            <defs>
              <filter id="circuitGlow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <g opacity="0.25">
              <Line points={[[380, 196], [530, 196], [530, 70], [560, 70]]} tone="orange" width={2.2} />
              <Line points={[[380, 196], [530, 196], [530, 178], [560, 178]]} tone="orange" width={2.2} />
              <Line points={[[380, 196], [530, 196], [530, 286], [560, 286]]} tone="orange" width={2.2} />
              <Line points={[[380, 196], [530, 196], [530, 394], [560, 394]]} tone="orange" width={2.2} />
              <Line points={[[380, 196], [530, 196], [530, 502], [560, 502]]} tone="orange" width={2.2} />
              <Line points={[[380, 196], [774, 196], [774, 164], [834, 164]]} tone="violet" width={2.2} />
              <Line points={[[380, 196], [774, 196], [774, 288], [834, 288]]} tone="violet" width={2.2} />
              <Line points={[[380, 196], [774, 196], [774, 412], [834, 412]]} tone="violet" width={2.2} />
              <Line points={[[380, 196], [774, 196], [774, 536], [834, 536]]} tone="violet" width={2.2} />
              <Line points={[[380, 288], [380, 540], [314, 540], [314, 578]]} tone="emerald" width={2.2} />
              <Line points={[[380, 288], [380, 540], [494, 540], [494, 578]]} tone="emerald" width={2.2} />
              <Line points={[[380, 288], [380, 540], [674, 540], [674, 578]]} tone="emerald" width={2.2} />
              <Line points={[[380, 288], [380, 540], [854, 540], [854, 578]]} tone="emerald" width={2.2} />
              <Line points={[[380, 288], [380, 540], [1034, 540], [1034, 578]]} tone="emerald" width={2.2} />
            </g>

            <g filter="url(#circuitGlow)">
              {visibleAgents.map((agent) => (
                <Line
                  key={`agent-line-${agent.id}`}
                  points={[
                    [380, 196],
                    [530, 196],
                    [530, agent.y + CARD_H / 2],
                    [560, agent.y + CARD_H / 2],
                  ]}
                  tone={activeDelegationTargets.has(agent.id) ? 'cyan' : agent.tone}
                  width={activeDelegationTargets.has(agent.id) ? 3.4 : 2.4}
                  dash={!agent.healthy}
                />
              ))}

              {visibleRooms.map((room) => (
                <Line
                  key={`room-line-${room.id}`}
                  points={[
                    [380, 196],
                    [774, 196],
                    [774, room.y + CARD_H / 2],
                    [834, room.y + CARD_H / 2],
                  ]}
                  tone={room.tone}
                  width={2.4}
                />
              ))}

              {visibleStreams.map((stream) => (
                <Line
                  key={`stream-line-${stream.id}`}
                  points={[
                    [380, 288],
                    [380, 540],
                    [stream.x + CARD_W / 2, 540],
                    [stream.x + CARD_W / 2, stream.y],
                  ]}
                  tone={stream.tone}
                  width={2.4}
                />
              ))}

              {roomToStreamLines.map(({ room, stream }) => (
                <Line
                  key={`room-stream-${room.id}-${stream.id}`}
                  points={[
                    [room.x, room.y + CARD_H / 2],
                    [room.x - 32, room.y + CARD_H / 2],
                    [room.x - 32, stream.y - 18],
                    [stream.x + CARD_W / 2, stream.y - 18],
                  ]}
                  tone="violet"
                  width={1.6}
                  dash
                />
              ))}

              <circle cx="380" cy="196" r="5.5" fill={lineTone('orange')} />
              <circle cx="530" cy="196" r="4.5" fill={lineTone('orange')} />
              <circle cx="774" cy="196" r="4.5" fill={lineTone('violet')} />
              <circle cx="380" cy="540" r="4.5" fill={lineTone('emerald')} />
            </g>
          </svg>

          <CircuitCard
            x={192}
            y={138}
            width={188}
            height={150}
            eyebrow="Primary Agent"
            title={truncate(chiefName, 20)}
            subtitle={pendingApprovals > 0 ? `${pendingApprovals} approvals waiting for routing` : connected ? 'routing work and keeping state warm' : 'operating from cached state until stream resumes'}
            state={connected ? 'active' : 'degraded'}
            tone="orange"
            emphasis="strong"
          />

          {visibleAgents.map((agent) => (
            <CircuitCard
              key={agent.id}
              x={agent.x}
              y={agent.y}
              width={CARD_W}
              height={CARD_H}
              eyebrow="Agent"
              title={agent.name}
              subtitle={agent.subtitle}
              state={agent.state}
              tone={activeDelegationTargets.has(agent.id) ? 'cyan' : agent.tone}
            />
          ))}

          {visibleRooms.map((room) => (
            <CircuitCard
              key={room.id}
              x={room.x}
              y={room.y}
              width={CARD_W}
              height={CARD_H}
              eyebrow="Room"
              title={room.title}
              subtitle={room.subtitle}
              state={room.state}
              tone={room.tone}
            />
          ))}

          {visibleStreams.map((stream) => (
            <CircuitCard
              key={stream.id}
              x={stream.x}
              y={stream.y}
              width={CARD_W}
              height={CARD_H}
              eyebrow="Workstream"
              title={stream.title}
              subtitle={stream.subtitle}
              state={stream.state}
              tone={stream.tone}
            />
          ))}

          <div className="absolute bottom-6 left-6 flex flex-wrap gap-2">
            {[
              ['active path', 'cyan'],
              ['attention', 'violet'],
              ['healthy', 'emerald'],
              ['blocked', 'rose'],
            ].map(([label, tone]) => (
              <div key={label} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] ${chipTone(tone as NodeTone)}`}>
                <span className="h-2 w-2 rounded-full bg-current" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
