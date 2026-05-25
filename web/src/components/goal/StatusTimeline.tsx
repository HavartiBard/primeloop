export interface TimelineEvent {
  id: string
  label: string
  timestamp: string | null
  detail?: string
  tone?: 'neutral' | 'ok' | 'warn' | 'risk'
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function toneClasses(tone: TimelineEvent['tone']) {
  switch (tone) {
    case 'ok': return 'bg-[var(--s-ok-bd)]'
    case 'warn': return 'bg-[var(--s-att-bd)]'
    case 'risk': return 'bg-[var(--s-blk-bd)]'
    default: return 'bg-[var(--border-soft)]'
  }
}

export function StatusTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-[var(--muted)]">No status transitions recorded yet.</p>
  }

  return (
    <ol data-testid="status-timeline" className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className={`mt-1 h-2.5 w-2.5 rounded-full ${toneClasses(event.tone)}`} />
            <span className="mt-1 h-full w-px bg-[var(--border-soft)]" />
          </div>
          <div className="min-w-0 pb-3">
            <div className="text-sm text-[var(--text)]">{event.label}</div>
            <div className="text-xs text-[var(--muted)]">{formatDateTime(event.timestamp)}</div>
            {event.detail && <div className="mt-1 text-xs text-[var(--muted)]">{event.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}
