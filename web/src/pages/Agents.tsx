import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAgents } from '../api'
import { useAgentRegistry } from '../hooks/useAgentRegistry'
import { useProviders } from '../hooks/useProviders'
import type { RegistryAgent } from '../types'

interface AgentFormState {
  name: string
  type: string
  provider_id: string
  runtime_family: string
  execution_mode: string
  endpoint: string
  capabilities_csv: string
  host: string
  container_name: string
  ssh_user: string
  config_json: string
  enabled: boolean
}

const EMPTY_AGENT_FORM: AgentFormState = {
  name: '',
  type: 'custom',
  provider_id: '',
  runtime_family: 'custom',
  execution_mode: 'external',
  endpoint: '',
  capabilities_csv: '',
  host: '',
  container_name: '',
  ssh_user: '',
  config_json: '{}',
  enabled: true,
}

interface AgentModalProps {
  mode: 'add' | 'edit'
  agent?: RegistryAgent
  providerOptions: { id: string; name: string }[]
  onClose: () => void
  onSubmit: (data: AgentFormState) => void
}

function AgentModal({ mode, agent, providerOptions, onClose, onSubmit }: AgentModalProps) {
  const [form, setForm] = useState<AgentFormState>({
    name: agent?.name ?? '',
    type: agent?.type ?? 'custom',
    provider_id: agent?.provider_id ?? '',
    runtime_family: agent?.runtime_family ?? 'custom',
    execution_mode: agent?.execution_mode ?? 'external',
    endpoint: agent?.endpoint ?? '',
    capabilities_csv: agent?.capabilities.join(', ') ?? '',
    host: agent?.host ?? '',
    container_name: agent?.container_name ?? '',
    ssh_user: agent?.ssh_user ?? '',
    config_json: agent?.config ? JSON.stringify(agent.config, null, 2) : '{}',
    enabled: agent?.enabled ?? true,
  })
  const [jsonError, setJsonError] = useState<string | null>(null)

  const setField =
    (field: keyof AgentFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    try {
      JSON.parse(form.config_json)
    } catch {
      setJsonError('Config JSON is not valid JSON')
      return
    }
    setJsonError(null)
    onSubmit(form)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-sm font-semibold text-white mb-4">
          {mode === 'add' ? 'Add Agent' : 'Edit Agent'}
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name *</label>
            <input
              required
              value={form.name}
              onChange={setField('name')}
              placeholder="e.g. raclette"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Agent Type *</label>
            <input
              required
              value={form.type}
              onChange={setField('type')}
              placeholder="e.g. chief-of-staff, worker, reviewer"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Runtime Family *</label>
              <input
                required
                value={form.runtime_family}
                onChange={setField('runtime_family')}
                placeholder="e.g. hermes, openclaw, opencode, codex-app-server"
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Execution Mode *</label>
              <input
                required
                value={form.execution_mode}
                onChange={setField('execution_mode')}
                placeholder="e.g. external, portal-managed, remote-container, local"
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Endpoint</label>
            <input
              value={form.endpoint}
              onChange={setField('endpoint')}
              placeholder="e.g. https://agent.example/api"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Capabilities</label>
            <input
              value={form.capabilities_csv}
              onChange={setField('capabilities_csv')}
              placeholder="e.g. coordination, research, code-exploration, deploy"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Provider</label>
            <select
              value={form.provider_id}
              onChange={setField('provider_id')}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-400"
            >
              <option value="">— none —</option>
              {providerOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Host</label>
            <input
              value={form.host}
              onChange={setField('host')}
              placeholder="e.g. jetson.lab or 192.168.20.169"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Container Name</label>
            <input
              value={form.container_name}
              onChange={setField('container_name')}
              placeholder="e.g. raclette (for SSH lifecycle)"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">SSH User</label>
            <input
              value={form.ssh_user}
              onChange={setField('ssh_user')}
              placeholder="override default SSH user"
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Config JSON</label>
            <textarea
              value={form.config_json}
              onChange={setField('config_json')}
              rows={4}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white font-mono placeholder-gray-500 focus:outline-none focus:border-gray-400 resize-y"
            />
            {jsonError && <p className="text-red-400 text-xs mt-1">{jsonError}</p>}
          </div>
          <div className="flex items-center gap-2">
            <input
              id="enabled-checkbox"
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="accent-blue-500"
            />
            <label htmlFor="enabled-checkbox" className="text-xs text-gray-400">Enabled</label>
          </div>
          <div className="flex gap-2 mt-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs bg-gray-800 border border-gray-600 text-gray-300 rounded hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 text-xs bg-blue-900 border border-blue-600 text-blue-300 rounded hover:bg-blue-800"
            >
              {mode === 'add' ? 'Add' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function Agents() {
  const { agents, isLoading, isError, create, update, remove, lifecycle } = useAgentRegistry()
  const { providers } = useProviders()
  const [modal, setModal] = useState<{ mode: 'add' | 'edit'; agent?: RegistryAgent } | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [lifecycleMsg, setLifecycleMsg] = useState<{ id: string; msg: string } | null>(null)

  const providerOptions = providers.map((p) => ({ id: p.id, name: p.name }))
  const providerMap = Object.fromEntries(providers.map((p) => [p.id, p.name]))

  const handleSubmit = (form: AgentFormState) => {
    let config: Record<string, unknown> = {}
    try { config = JSON.parse(form.config_json) } catch { /* validated in modal */ }
    const capabilities = form.capabilities_csv
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)

    const payload: Omit<RegistryAgent, 'id' | 'created_at'> = {
      name: form.name,
      type: form.type,
      runtime_family: form.runtime_family,
      execution_mode: form.execution_mode,
      capabilities,
      enabled: form.enabled,
      config,
      ...(form.provider_id ? { provider_id: form.provider_id } : {}),
      ...(form.endpoint ? { endpoint: form.endpoint } : {}),
      ...(form.host ? { host: form.host } : {}),
      ...(form.container_name ? { container_name: form.container_name } : {}),
      ...(form.ssh_user ? { ssh_user: form.ssh_user } : {}),
    }

    if (modal?.mode === 'edit' && modal.agent) {
      update(modal.agent.id, payload)
    } else {
      create(payload)
    }
    setModal(null)
  }

  const handleDelete = (agent: RegistryAgent) => {
    if (deletingId === agent.id) {
      remove(agent.id)
      setDeletingId(null)
    } else {
      setDeletingId(agent.id)
    }
  }

  const handleLifecycle = (agent: RegistryAgent, action: 'restart' | 'stop' | 'start') => {
    lifecycle(agent.id, action)
    setLifecycleMsg({ id: agent.id, msg: `${action} sent…` })
    setTimeout(() => setLifecycleMsg(null), 3000)
  }

  // Live health data (original functionality)
  const { data: healthData = [], isError: healthError } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    refetchInterval: 30_000,
  })

  return (
    <div className="p-4">
      {/* Section 1: Agent Registry */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm text-gray-400">Agent Registry</h2>
          <button
            onClick={() => setModal({ mode: 'add' })}
            className="px-3 py-1.5 text-xs bg-blue-900 border border-blue-600 text-blue-300 rounded hover:bg-blue-800"
          >
            + Add Agent
          </button>
        </div>

        {isError && <p className="text-red-400 text-sm mb-3">Failed to load agent registry.</p>}

        {isLoading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : agents.length === 0 ? (
          <p className="text-gray-500 text-sm">No agents registered yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="pb-2 pr-4 font-normal">Name</th>
                  <th className="pb-2 pr-4 font-normal">Type</th>
                  <th className="pb-2 pr-4 font-normal">Runtime</th>
                  <th className="pb-2 pr-4 font-normal">Host</th>
                  <th className="pb-2 pr-4 font-normal">Container</th>
                  <th className="pb-2 pr-4 font-normal">Provider</th>
                  <th className="pb-2 pr-4 font-normal">Enabled</th>
                  <th className="pb-2 font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="border-b border-gray-800/50 hover:bg-gray-900/40">
                    <td className="py-2 pr-4 text-white font-mono">{a.name}</td>
                    <td className="py-2 pr-4 text-gray-300">{a.type}</td>
                    <td className="py-2 pr-4 text-gray-400">
                      <div className="font-mono">{a.runtime_family}</div>
                      <div className="text-[11px] text-gray-500">{a.execution_mode}</div>
                    </td>
                    <td className="py-2 pr-4 text-gray-400 font-mono">
                      {a.host ?? <span className="text-gray-600">—</span>}
                    </td>
                    <td className="py-2 pr-4 text-gray-400 font-mono">
                      {a.container_name ?? <span className="text-gray-600">—</span>}
                    </td>
                    <td className="py-2 pr-4 text-gray-400">
                      {a.provider_id ? (providerMap[a.provider_id] ?? a.provider_id) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="py-2 pr-4">
                      {a.enabled ? (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-green-900/40 border border-green-700 text-green-400">on</span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-gray-800 border border-gray-600 text-gray-500">off</span>
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1.5 items-center flex-wrap">
                        {lifecycleMsg?.id === a.id && (
                          <span className="text-gray-400 text-xs italic mr-1">{lifecycleMsg.msg}</span>
                        )}
                        <button
                          onClick={() => handleLifecycle(a, 'restart')}
                          className="px-2 py-1 text-xs bg-gray-800 border border-yellow-700 text-yellow-400 rounded hover:bg-yellow-900/30"
                        >
                          Restart
                        </button>
                        <button
                          onClick={() => handleLifecycle(a, 'stop')}
                          className="px-2 py-1 text-xs bg-gray-800 border border-orange-700 text-orange-400 rounded hover:bg-orange-900/30"
                        >
                          Stop
                        </button>
                        <button
                          onClick={() => setModal({ mode: 'edit', agent: a })}
                          className="px-2 py-1 text-xs bg-gray-800 border border-gray-600 text-gray-300 rounded hover:bg-gray-700"
                        >
                          Edit
                        </button>
                        {deletingId === a.id ? (
                          <>
                            <button
                              onClick={() => handleDelete(a)}
                              className="px-2 py-1 text-xs bg-red-900 border border-red-600 text-red-300 rounded hover:bg-red-800"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeletingId(null)}
                              className="px-2 py-1 text-xs bg-gray-800 border border-gray-600 text-gray-400 rounded hover:bg-gray-700"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleDelete(a)}
                            className="px-2 py-1 text-xs bg-gray-800 border border-red-800 text-red-400 rounded hover:bg-red-900/30"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 2: Live Agent Health */}
      <div>
        <h2 className="text-sm text-gray-400 mb-3">Agent health</h2>
        {healthError && <p className="text-red-400 text-sm">Failed to load agent status.</p>}
        {healthData.map((a) => (
          <div key={a.agent} className="bg-gray-900 rounded px-3 py-2 mb-2 flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${a.healthy ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-white font-mono">{a.agent}</span>
            <span className="text-gray-500 ml-auto">last seen {new Date(a.last_seen).toLocaleTimeString()}</span>
          </div>
        ))}
        {healthData.length === 0 && <p className="text-gray-500 text-sm">No agents seen yet.</p>}
      </div>

      {modal && (
        <AgentModal
          mode={modal.mode}
          agent={modal.agent}
          providerOptions={providerOptions}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}
