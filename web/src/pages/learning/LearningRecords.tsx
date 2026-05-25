import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

interface LearningRecord {
  id: string
  kind: string
  content: string
  category?: string
  severity?: string
  created_at: string
}

const API_ORIGIN = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '')

async function fetchLearningRecords(): Promise<LearningRecord[]> {
  const res = await fetch(`${API_ORIGIN}/api/runtime/fleet/learnings?limit=200`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function LearningRecords() {
  const [category, setCategory] = useState('all')
  const [signalType, setSignalType] = useState('all')
  const { data, isLoading, isError } = useQuery({
    queryKey: ['learning-records'],
    queryFn: fetchLearningRecords,
    refetchInterval: 30_000,
  })

  const records = useMemo(() => {
    const list = data ?? []
    return list.filter((record) => {
      if (category !== 'all' && (record.category ?? 'uncategorized') !== category) return false
      if (signalType !== 'all' && (record.kind ?? 'unknown') !== signalType) return false
      return true
    })
  }, [data, category, signalType])

  return (
    <div className="p-4 space-y-4">
      <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm text-[var(--muted)]">Learning Records</h2>
          <div className="flex gap-2">
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-1 text-xs text-[var(--text)]">
              <option value="all">All categories</option>
              <option value="best_practice">best_practice</option>
              <option value="antipattern">antipattern</option>
              <option value="recovery">recovery</option>
            </select>
            <select value={signalType} onChange={(event) => setSignalType(event.target.value)} className="rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-2 py-1 text-xs text-[var(--text)]">
              <option value="all">All signal types</option>
              <option value="memory">memory</option>
              <option value="lesson">lesson</option>
            </select>
          </div>
        </div>

        {isLoading ? <p className="text-sm text-[var(--muted)]">Loading learning records…</p> : null}
        {isError ? <p className="text-sm text-[var(--s-blk-tx)]">Failed to load learning records.</p> : null}

        {!isLoading && !isError && records.length === 0 ? (
          <div className="rounded-[1rem] border border-dashed border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 text-sm text-[var(--muted)]">
            No learning records match the current filters.
          </div>
        ) : (
          <div className="space-y-3">
            {records.map((record) => (
              <div key={record.id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm text-[var(--text)]">{record.content}</div>
                  <span className="rounded border border-[var(--border-soft)] bg-[var(--panel)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">{record.kind}</span>
                </div>
                <div className="mt-2 text-xs text-[var(--muted)]">
                  {(record.category ?? 'uncategorized').replace('_', ' ')}
                  {record.severity ? ` · ${record.severity}` : ''}
                  {' · '}
                  {new Date(record.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
