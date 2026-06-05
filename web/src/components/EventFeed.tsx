import type { AgentEvent, DisplayStatus } from '../types'
import { DisplayStatusBadge } from './agentCanvas/DisplayStatusBadge'
import { AgentActivityTimeline } from './agentCanvas/AgentActivityTimeline'

const TYPE_COLORS: Record<string, string> = {
  'run.started': 'border-green-500',
  'run.completed': 'border-green-500',
  'approval.needed': 'border-red-500',
  'approval.decided': 'border-orange-500',
  'session.active': 'border-blue-400',
  'session.ended': 'border-gray-500',
  'session.resumed': 'border-indigo-400',
  'delegation.recovered': 'border-teal-400',
  'delegation.recovered_failed': 'border-red-500',
  'credential.issued': 'border-emerald-500',
  'credential.rotated': 'border-sky-500',
  'credential.revoked': 'border-slate-500',
  'credential.risk_flagged': 'border-amber-500',
  'runtime.leased': 'border-indigo-500',
  'runtime.reclaimed': 'border-violet-500',
  'egress.denied': 'border-rose-500',
  'fs.denied': 'border-red-500',
  'llm.proxied': 'border-cyan-500',
  'launcher.auth_denied': 'border-red-500',
}

const EVENT_TYPE_STATUS: Record<string, DisplayStatus> = {
  'run.started': 'running',
  'run.completed': 'success',
  'approval.needed': 'pending',
  'approval.decided': 'resolved',
  'session.active': 'streaming',
  'session.ended': 'cancelled',
  'session.resumed': 'resumed',
  'delegation.recovered': 'recovered',
  'delegation.recovered_failed': 'failed',
  'credential.issued': 'success',
  'credential.rotated': 'resolved',
  'credential.revoked': 'cancelled',
  'credential.risk_flagged': 'risky',
  'runtime.leased': 'running',
  'runtime.reclaimed': 'cancelled',
  'egress.denied': 'blocked',
  'fs.denied': 'blocked',
  'llm.proxied': 'streaming',
  'launcher.auth_denied': 'failed',
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString()
}

function summarizePayload(type: string, payload: Record<string, unknown>): string | null {
  switch (type) {
    case 'credential.issued':
    case 'credential.rotated':
    case 'credential.revoked':
      return [payload['kind'], payload['agent_id']].filter(Boolean).join(' · ') || null
    case 'credential.risk_flagged':
      return [payload['kind'], payload['reason'], payload['agent_id']].filter(Boolean).join(' · ') || null
    case 'runtime.leased':
    case 'runtime.reclaimed':
      return [payload['agent_id'], payload['lease_id'], payload['status']].filter(Boolean).join(' · ') || null
    case 'egress.denied':
      return [payload['host'], payload['agent_id'], payload['reason']].filter(Boolean).join(' · ') || null
    case 'fs.denied':
      return [payload['path'], payload['agent_id'], payload['reason']].filter(Boolean).join(' · ') || null
    case 'llm.proxied':
      return [payload['provider'], payload['agent_id'], payload['model']].filter(Boolean).join(' · ') || null
    case 'launcher.auth_denied':
      return [payload['agent_id'], payload['reason']].filter(Boolean).join(' · ') || null
    case 'session.resumed':
    case 'delegation.recovered':
    case 'delegation.recovered_failed':
      return [payload['delegation_id'], payload['agent_id'], payload['error']].filter(Boolean).join(' · ') || null
    default:
      return null
  }
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
        const status = EVENT_TYPE_STATUS[e.type] || 'unavailable'
        const payloadSummary = summarizePayload(e.type, e.payload)
        return (
          <div
            key={e.id}
            className={`bg-gray-900 rounded px-3 py-2 border-l-4 ${TYPE_COLORS[e.type] ?? 'border-gray-600'}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-gray-500 text-xs">{formatTime(e.created_at)}</span>
              <DisplayStatusBadge status={status} compact showIcon={false} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-blue-300 text-xs font-mono">{e.agent}</span>
              <span className="text-white text-xs font-mono">{e.type}</span>
            </div>
            {payloadSummary && (
              <div className="mt-1 text-[11px] text-gray-400 break-all">{payloadSummary}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
