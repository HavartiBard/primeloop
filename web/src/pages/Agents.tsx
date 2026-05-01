import { useQuery } from '@tanstack/react-query'
import { fetchAgents } from '../api'

export function Agents() {
  const { data = [], isError } = useQuery({ queryKey: ['agents'], queryFn: fetchAgents, refetchInterval: 30_000 })
  return (
    <div className="p-4">
      <h2 className="text-sm text-gray-400 mb-3">Agent health</h2>
      {isError && <p className="text-red-400 text-sm">Failed to load agent status.</p>}
      {data.map((a) => (
        <div key={a.agent} className="bg-gray-900 rounded px-3 py-2 mb-2 flex items-center gap-2 text-xs">
          <span className={`w-2 h-2 rounded-full ${a.healthy ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-white font-mono">{a.agent}</span>
          <span className="text-gray-500 ml-auto">last seen {new Date(a.last_seen).toLocaleTimeString()}</span>
        </div>
      ))}
      {data.length === 0 && <p className="text-gray-500 text-sm">No agents seen yet.</p>}
    </div>
  )
}
