import type { AgentEvent } from '../types'

const TYPE_COLORS: Record<string, string> = {
  'run.started': 'border-green-500',
  'run.completed': 'border-green-500',
  'approval.needed': 'border-red-500',
  'approval.decided': 'border-orange-500',
  'session.active': 'border-blue-400',
  'session.ended': 'border-gray-500',
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
        <div className="text-sm text-gray-500">No events yet — waiting for agent activity</div>
      )}
      {events.map((e) => (
        <div
          key={e.id}
          className={`bg-gray-900 rounded px-3 py-2 border-l-4 ${TYPE_COLORS[e.type] ?? 'border-gray-600'}`}
        >
          <span className="text-gray-500 text-xs mr-2">{formatTime(e.created_at)}</span>
          <span className="text-blue-300 text-xs mr-2">{e.agent}</span>
          <span className="text-white text-xs font-mono">{e.type}</span>
        </div>
      ))}
    </div>
  )
}
