import type { AgentEvent } from '../types'
import { DisplayStatusBadge } from './agentCanvas/DisplayStatusBadge'
import { ContextAttachmentList } from './agentCanvas/ContextAttachmentList'
import { AgentActivityTimeline } from "./agentCanvas/AgentActivityTimeline"

const TYPE_COLORS: Record<string, string> = {
  'run.started': 'border-green-500',
  'run.completed': 'border-green-500',
  'approval.needed': 'border-red-500',
  'approval.decided': 'border-orange-500',
  'session.active': 'border-blue-400',
  'session.ended': 'border-gray-500',
}

// Status mapping for new agent canvas UX
const EVENT_TYPE_STATUS: Record<string, string> = {
  'run.started': 'running',
  'run.completed': 'success',
  'approval.needed': 'pending',
  'approval.decided': 'resolved',
  'session.active': 'streaming',
  'session.ended': 'cancelled',
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString()
}

interface Props {
  events: AgentEvent[]
  connected: boolean
}

export function EventFeed({ events, connected }: Props) {
  return (
    <div className="flex flex-col gap-2 p-4">
      {!connected && (
        <div className="text-sm text-red-400 mb-2">● Disconnected — reconnecting…</div>
      )}
      {events.length === 0 && connected && (
        <AgentActivityTimeline events={[]} />
      )}
      {events.map((e) => {
        const status = EVENT_TYPE_STATUS[e.type] || 'neutral'
        return (
          <div
            key={e.id}
            className={`bg-gray-900 rounded px-3 py-2 border-l-4 ${TYPE_COLORS[e.type] ?? 'border-gray-600'}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-gray-500 text-xs">{formatTime(e.created_at)}</span>
              <DisplayStatusBadge status={status as any} compact showIcon={false} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-blue-300 text-xs font-mono">{e.agent}</span>
              <span className="text-white text-xs font-mono">{e.type}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
