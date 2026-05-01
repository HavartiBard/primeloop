import { useQuery } from '@tanstack/react-query'
import { fetchEvents } from '../api'

export function Runs() {
  const { data = [] } = useQuery({ queryKey: ['runs'], queryFn: () => fetchEvents({ agent: 'langgraph', limit: 50 }) })
  const runs = data.filter((e) => e.type === 'run.started' || e.type === 'run.completed')
  return (
    <div className="p-4">
      <h2 className="text-sm text-gray-400 mb-3">Run history</h2>
      {runs.map((e) => (
        <div key={e.id} className="bg-gray-900 rounded px-3 py-2 mb-2 text-xs font-mono text-gray-300">
          {e.type} — {(e.payload as { run_id?: string }).run_id ?? 'unknown'} — {new Date(e.created_at).toLocaleString()}
        </div>
      ))}
      {runs.length === 0 && <p className="text-gray-500 text-sm">No runs recorded yet.</p>}
    </div>
  )
}
