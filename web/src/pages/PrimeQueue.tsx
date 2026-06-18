import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPrimeQueueItems, type PrimeQueueItem } from '../api'

const STATUS_COLORS: Record<PrimeQueueItem['status'], string> = {
  pending: '#6b7280',
  processing: '#3b82f6',
  done: '#22c55e',
  failed: '#ef4444',
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  'prime.message': 'Prime Message',
  'cron_fast': 'Fast Cron',
  'cron_slow': 'Slow Cron',
  'delegation.completed': 'Delegation Complete',
  'delegation.failed': 'Delegation Failed',
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)

  if (diffSecs < 60) return `${diffSecs}s ago`
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return date.toLocaleDateString()
}

function QueueItemRow({ item }: { item: PrimeQueueItem }) {
  const statusColor = STATUS_COLORS[item.status]
  const eventLabel = EVENT_TYPE_LABELS[item.event_type] || item.event_type

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1fr 80px 60px 100px 80px',
        gap: '12px',
        padding: '10px 12px',
        borderBottom: '1px solid var(--border-soft)',
        alignItems: 'center',
        fontSize: '13px',
      }}
    >
      {/* Status */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontWeight: 500,
        }}
      >
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: statusColor,
            boxShadow: item.status === 'processing' ? `0 0 6px ${statusColor}` : 'none',
          }}
        />
        <span style={{ color: statusColor }}>{item.status}</span>
      </div>

      {/* Event Type */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
        {eventLabel}
      </div>

      {/* Attempts */}
      <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
        {item.attempt}
      </div>

      {/* Actor (if any) */}
      <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
        {item.actor_agent_id ? 'agent' : '-'}
      </div>

      {/* Time */}
      <div style={{ color: 'var(--muted)', fontSize: '12px' }}>
        {formatRelativeTime(item.created_at)}
      </div>

      {/* Actions */}
      <div style={{ textAlign: 'center' }}>
        {item.status === 'failed' ? (
          <span style={{ color: '#ef4444', fontSize: '11px' }} title={item.error || 'Unknown error'}>
            Error
          </span>
        ) : (
          <span style={{ color: 'var(--muted)', fontSize: '11px' }}>-</span>
        )}
      </div>

      {/* Full error message on hover for failed items */}
      {item.status === 'failed' && item.error && (
        <div
          title={item.error}
          style={{
            gridColumn: '1 / -1',
            marginTop: '4px',
            padding: '6px 8px',
            background: 'rgba(239, 68, 68, 0.08)',
            borderRadius: '4px',
            fontSize: '11px',
            color: '#ef4444',
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.error}
        </div>
      )}
    </div>
  )
}

export function PrimeQueue() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [eventTypeFilter, setEventTypeFilter] = useState<string | undefined>(undefined)
  const [offset, setOffset] = useState(0)
  const limit = 50

  const { data: queueItems, isLoading, error, refetch } = useQuery({
    queryKey: ['prime-queue-items', statusFilter, eventTypeFilter, offset, limit],
    queryFn: () => fetchPrimeQueueItems({ status: statusFilter, event_type: eventTypeFilter, limit, offset }),
    refetchInterval: (data) => {
      // Poll more frequently if there are processing items
      const hasProcessing = data?.some(item => item.status === 'processing')
      return hasProcessing ? 2000 : 5000
    },
  })

  const statusCounts = {
    pending: queueItems?.filter(i => i.status === 'pending').length ?? 0,
    processing: queueItems?.filter(i => i.status === 'processing').length ?? 0,
    failed: queueItems?.filter(i => i.status === 'failed').length ?? 0,
  }

  return (
    <div
      style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: '24px',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px' }}>Prime Queue</h1>
        <p style={{ color: 'var(--muted)', fontSize: '14px' }}>
          View and monitor Prime Agent queue items as they flow through the system.
        </p>
      </div>

      {/* Stats */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            background: 'var(--panel-subtle)',
            borderRadius: '8px',
            border: '1px solid var(--border-soft)',
          }}
        >
          <div style={{ fontSize: '24px', fontWeight: 600 }}>
            {statusCounts.pending}
          </div>
          <div style={{ color: 'var(--muted)', fontSize: '12px' }}>Pending</div>
        </div>
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(59, 130, 246, 0.08)',
            borderRadius: '8px',
            border: '1px solid rgba(59, 130, 246, 0.2)',
          }}
        >
          <div style={{ fontSize: '24px', fontWeight: 600, color: '#3b82f6' }}>
            {statusCounts.processing}
          </div>
          <div style={{ color: 'rgba(59, 130, 246, 0.8)', fontSize: '12px' }}>Processing</div>
        </div>
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(239, 68, 68, 0.08)',
            borderRadius: '8px',
            border: '1px solid rgba(239, 68, 68, 0.2)',
          }}
        >
          <div style={{ fontSize: '24px', fontWeight: 600, color: '#ef4444' }}>
            {statusCounts.failed}
          </div>
          <div style={{ color: 'rgba(239, 68, 68, 0.8)', fontSize: '12px' }}>Failed</div>
        </div>
      </div>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '16px',
          alignItems: 'center',
        }}
      >
        <select
          value={statusFilter || ''}
          onChange={(e) => {
            setStatusFilter(e.target.value || undefined)
            setOffset(0)
          }}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border-soft)',
            background: 'var(--panel-subtle)',
            color: 'var(--text)',
            fontSize: '13px',
          }}
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="done">Done</option>
          <option value="failed">Failed</option>
        </select>

        <select
          value={eventTypeFilter || ''}
          onChange={(e) => {
            setEventTypeFilter(e.target.value || undefined)
            setOffset(0)
          }}
          style={{
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border-soft)',
            background: 'var(--panel-subtle)',
            color: 'var(--text)',
            fontSize: '13px',
          }}
        >
          <option value="">All Event Types</option>
          <option value="prime.message">Prime Message</option>
          <option value="cron_fast">Fast Cron</option>
          <option value="cron_slow">Slow Cron</option>
          <option value="delegation.completed">Delegation Complete</option>
          <option value="delegation.failed">Delegation Failed</option>
        </select>

        <button
          onClick={() => refetch()}
          style={{
            padding: '8px 16px',
            borderRadius: '6px',
            border: '1px solid var(--border-soft)',
            background: 'var(--panel-subtle)',
            color: 'var(--text)',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>

        <div style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '12px' }}>
          Auto-refresh: {queueItems?.some(i => i.status === 'processing') ? '2s' : '5s'}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div
          style={{
            padding: '16px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '8px',
            color: '#ef4444',
            marginBottom: '16px',
          }}
        >
          Failed to load queue items: {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Table Header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '120px 1fr 80px 60px 100px 80px',
          gap: '12px',
          padding: '10px 12px',
          borderBottom: '2px solid var(--border)',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        <div>Status</div>
        <div>Event Type</div>
        <div style={{ textAlign: 'center' }}>Attempts</div>
        <div style={{ textAlign: 'center' }}>Actor</div>
        <div>Time</div>
        <div style={{ textAlign: 'center' }}>Error</div>
      </div>

      {/* Queue Items */}
      {isLoading ? (
        <div
          style={{
            padding: '40px',
            textAlign: 'center',
            color: 'var(--muted)',
          }}
        >
          Loading queue items...
        </div>
      ) : queueItems && queueItems.length > 0 ? (
        <>
          {queueItems.map((item) => (
            <QueueItemRow key={item.id} item={item} />
          ))}

          {/* Pagination */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '12px',
              marginTop: '24px',
            }}
          >
            <button
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
              disabled={offset === 0}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid var(--border-soft)',
                background: offset === 0 ? 'var(--panel-subtle)' : 'var(--panel)',
                color: offset === 0 ? 'var(--muted)' : 'var(--text)',
                cursor: offset === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Previous
            </button>
            <button
              onClick={() => setOffset((o) => o + limit)}
              disabled={(queueItems?.length ?? 0) < limit}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid var(--border-soft)',
                background: (queueItems?.length ?? 0) < limit ? 'var(--panel-subtle)' : 'var(--panel)',
                color: (queueItems?.length ?? 0) < limit ? 'var(--muted)' : 'var(--text)',
                cursor: (queueItems?.length ?? 0) < limit ? 'not-allowed' : 'pointer',
              }}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <div
          style={{
            padding: '40px',
            textAlign: 'center',
            color: 'var(--muted)',
          }}
        >
          No queue items found
        </div>
      )}
    </div>
  )
}
