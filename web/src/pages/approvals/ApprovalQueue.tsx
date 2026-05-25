import { useMemo, useState } from 'react'
import { useApprovals } from '../../hooks/useApprovals'

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString()
}

export function ApprovalQueue() {
  const { approvals, isLoading, approve, deny } = useApprovals()
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState('')

  const pendingApprovals = useMemo(
    () => approvals.filter((item) => item.status === 'pending'),
    [approvals],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return pendingApprovals
    return pendingApprovals.filter((item) => `${item.action} ${item.run_id}`.toLowerCase().includes(q))
  }, [pendingApprovals, query])

  const selectedIds = Object.entries(selected).filter(([, value]) => value).map(([id]) => id)

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelected({})
      return
    }
    const next: Record<string, boolean> = {}
    for (const item of filtered) next[item.approval_id] = true
    setSelected(next)
  }

  const handleBulk = (decision: 'approve' | 'deny') => {
    for (const id of selectedIds) {
      if (decision === 'approve') approve(id)
      else deny(id)
    }
    setSelected({})
  }

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm text-[var(--muted)]">Approval Queue</h2>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter approvals"
            className="w-full max-w-64 rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-1.5 text-xs text-[var(--text)]"
          />
        </div>

        {isLoading ? (
          <p className="mt-4 text-sm text-[var(--muted)]">Loading approvals…</p>
        ) : filtered.length === 0 ? (
          <div className="mt-4 rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
            No pending approvals.
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && selectedIds.length === filtered.length}
                  onChange={(event) => toggleAll(event.target.checked)}
                />
                Select all
              </label>
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={() => handleBulk('approve')}
                className="rounded border border-[var(--s-ok-bd)] bg-[var(--s-ok-bg)] px-2 py-1 text-xs text-[var(--s-ok-tx)] disabled:opacity-50"
              >
                Approve selected
              </button>
              <button
                type="button"
                disabled={selectedIds.length === 0}
                onClick={() => handleBulk('deny')}
                className="rounded border border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)] px-2 py-1 text-xs text-[var(--s-blk-tx)] disabled:opacity-50"
              >
                Deny selected
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {filtered.map((approval) => (
                <div key={approval.approval_id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <label className="inline-flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selected[approval.approval_id] === true}
                        onChange={(event) => setSelected((prev) => ({ ...prev, [approval.approval_id]: event.target.checked }))}
                      />
                      <div>
                        <div className="text-sm text-[var(--text)]">{approval.action}</div>
                        <div className="text-xs text-[var(--muted)]">Run {approval.run_id}</div>
                        <div className="text-xs text-[var(--muted)]">Requested {formatDateTime(approval.created_at)}</div>
                      </div>
                    </label>
                    <div className="flex gap-2">
                      <button onClick={() => approve(approval.approval_id)} className="rounded border border-[var(--s-ok-bd)] bg-[var(--s-ok-bg)] px-2 py-1 text-xs text-[var(--s-ok-tx)]">Approve</button>
                      <button onClick={() => deny(approval.approval_id)} className="rounded border border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)] px-2 py-1 text-xs text-[var(--s-blk-tx)]">Deny</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
