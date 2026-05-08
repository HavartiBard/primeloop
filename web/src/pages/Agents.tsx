import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchAgents } from '../api'
import { useAgentRegistry } from '../hooks/useAgentRegistry'
import { useProviders } from '../hooks/useProviders'
import type { Provider, RegistryAgent } from '../types'

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
  local_port: string
  worktree_path: string
  system_prompt: string
  soul: string
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
  local_port: '',
  worktree_path: '',
  system_prompt: '',
  soul: '',
  config_json: '{}',
  enabled: true,
}

// Fields that get auto-filled when a codex provider is selected
const CODEX_DEFAULTS = {
  runtime_family: 'codex-app-server',
  execution_mode: 'local',
}

interface AgentModalProps {
  mode: 'add' | 'edit'
  agent?: RegistryAgent
  providers: Provider[]
  onClose: () => void
  onSubmit: (data: AgentFormState) => void
}

function AgentModal({ mode, agent, providers, onClose, onSubmit }: AgentModalProps) {
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
    local_port: agent?.local_port != null ? String(agent.local_port) : '',
    worktree_path: agent?.worktree_path ?? '',
    system_prompt: agent?.system_prompt ?? '',
    soul: agent?.soul ?? '',
    config_json: agent?.config ? JSON.stringify(agent.config, null, 2) : '{}',
    enabled: agent?.enabled ?? true,
  })
  const [jsonError, setJsonError] = useState<string | null>(null)

  const setField =
    (field: keyof AgentFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))

  // Auto-populate fields when a codex provider is selected
  useEffect(() => {
    if (!form.provider_id) return
    const selected = providers.find((p) => p.id === form.provider_id)
    if (!selected || selected.type !== 'codex') return
    setForm((f) => ({
      ...f,
      runtime_family: CODEX_DEFAULTS.runtime_family,
      execution_mode: CODEX_DEFAULTS.execution_mode,
      endpoint: selected.base_url,
    }))
  }, [form.provider_id, providers])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    try { JSON.parse(form.config_json) } catch {
      setJsonError('Config JSON is not valid JSON')
      return
    }
    setJsonError(null)
    onSubmit(form)
  }

  const selectedProvider = providers.find((p) => p.id === form.provider_id)
  const isCodex = selectedProvider?.type === 'codex'

  const inputCls = 'w-full bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]'
  const labelCls = 'block text-xs text-[var(--muted)] mb-1'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[var(--panel)] border border-[var(--border-soft)] rounded-lg p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-sm font-semibold text-[var(--text)] mb-4">
          {mode === 'add' ? 'Add Agent' : 'Edit Agent'}
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">

          <div>
            <label className={labelCls}>Name *</label>
            <input required value={form.name} onChange={setField('name')} placeholder="e.g. Gouda" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Agent Type *</label>
            <input required value={form.type} onChange={setField('type')} placeholder="e.g. codex-thread, hermes, worker" className={inputCls} />
          </div>

          {/* Provider — selecting a codex provider auto-fills runtime fields */}
          <div>
            <label className={labelCls}>Provider</label>
            <select value={form.provider_id} onChange={setField('provider_id')}
              className="w-full bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--sel-bd)]">
              <option value="">— none —</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
              ))}
            </select>
          </div>

          {/* Runtime fields — shown with auto-fill notice for codex */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>
                Runtime Family *
                {isCodex && <span className="ml-1.5 text-[var(--s-ok-tx)]">auto</span>}
              </label>
              <input required value={form.runtime_family} onChange={setField('runtime_family')}
                placeholder="codex-app-server, hermes, custom" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>
                Execution Mode *
                {isCodex && <span className="ml-1.5 text-[var(--s-ok-tx)]">auto</span>}
              </label>
              <input required value={form.execution_mode} onChange={setField('execution_mode')}
                placeholder="local, external, remote-container" className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls}>
              Endpoint
              {isCodex && <span className="ml-1.5 text-[var(--s-ok-tx)]">auto from provider</span>}
            </label>
            <input value={form.endpoint} onChange={setField('endpoint')}
              placeholder="ws://localhost:10101 or https://agent.example/api" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Capabilities (comma-separated)</label>
            <input value={form.capabilities_csv} onChange={setField('capabilities_csv')}
              placeholder="code-exploration, implementation, research" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Host</label>
            <input value={form.host} onChange={setField('host')} placeholder="192.168.20.169 or hostname" className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Container Name</label>
              <input value={form.container_name} onChange={setField('container_name')} placeholder="for SSH lifecycle" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>SSH User</label>
              <input value={form.ssh_user} onChange={setField('ssh_user')} placeholder="override default" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Local Port</label>
              <input value={form.local_port} onChange={setField('local_port')} placeholder="10101" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Worktree Path</label>
              <input value={form.worktree_path} onChange={setField('worktree_path')} placeholder="/workspace/agent-foo" className={inputCls} />
            </div>
          </div>

          <div className="border-t border-[var(--border-soft)] pt-4 mt-1">
            <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">
              Agent Profile
            </h3>
            <div className="mb-3">
              <label className={labelCls}>
                Operating Instructions
                <span className="ml-1 text-[var(--muted)]">→ AGENTS.md</span>
              </label>
              <textarea value={form.system_prompt} onChange={setField('system_prompt')} rows={6}
                placeholder="How this agent should approach work, decision-making style, constraints..."
                className={`${inputCls} font-mono resize-y`} />
            </div>
            <div>
              <label className={labelCls}>
                Soul
                <span className="ml-1 text-[var(--muted)]">→ soul.md</span>
              </label>
              <textarea value={form.soul} onChange={setField('soul')} rows={4}
                placeholder="Who this agent is — identity, values, persona, tone..."
                className={`${inputCls} font-mono resize-y`} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Config JSON</label>
            <textarea value={form.config_json} onChange={setField('config_json')} rows={4}
              className={`${inputCls} font-mono resize-y`} />
            {jsonError && <p className="text-[var(--s-blk-tx)] text-xs mt-1">{jsonError}</p>}
          </div>

          <div className="flex items-center gap-2">
            <input id="enabled-checkbox" type="checkbox" checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="accent-blue-500" />
            <label htmlFor="enabled-checkbox" className="text-xs text-[var(--muted)]">Enabled</label>
          </div>

          <div className="flex gap-2 mt-2 justify-end">
            <button type="button" onClick={onClose}
              className="px-4 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel)]">
              Cancel
            </button>
            <button type="submit"
              className="px-4 py-1.5 text-xs bg-[var(--sel-bg)] border border-[var(--sel-bd)] text-blue-400 rounded hover:bg-blue-500/20">
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

  const providerMap = Object.fromEntries(providers.map((p) => [p.id, p.name]))

  const handleSubmit = (form: AgentFormState) => {
    let config: Record<string, unknown> = {}
    try { config = JSON.parse(form.config_json) } catch { /* validated in modal */ }
    const capabilities = form.capabilities_csv.split(',').map((v) => v.trim()).filter(Boolean)
    const parsedLocalPort = form.local_port.trim() ? Number(form.local_port) : undefined

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
      ...(parsedLocalPort != null && !Number.isNaN(parsedLocalPort) ? { local_port: parsedLocalPort } : {}),
      ...(form.worktree_path ? { worktree_path: form.worktree_path } : {}),
      ...(form.system_prompt ? { system_prompt: form.system_prompt } : {}),
      ...(form.soul ? { soul: form.soul } : {}),
    }

    if (modal?.mode === 'edit' && modal.agent) {
      update(modal.agent.id, payload)
    } else {
      create(payload)
    }
    setModal(null)
  }

  const handleDelete = (agent: RegistryAgent) => {
    if (deletingId === agent.id) { remove(agent.id); setDeletingId(null) }
    else setDeletingId(agent.id)
  }

  const handleLifecycle = (agent: RegistryAgent, action: 'restart' | 'stop' | 'start') => {
    lifecycle(agent.id, action)
    setLifecycleMsg({ id: agent.id, msg: `${action} sent…` })
    setTimeout(() => setLifecycleMsg(null), 3000)
  }

  const { data: healthData = [], isError: healthError } = useQuery({
    queryKey: ['agents'],
    queryFn: fetchAgents,
    refetchInterval: 30_000,
  })

  return (
    <div className="p-4">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm text-[var(--muted)]">Agent Registry</h2>
          <button onClick={() => setModal({ mode: 'add' })}
            className="px-3 py-1.5 text-xs bg-[var(--sel-bg)] border border-[var(--sel-bd)] text-blue-400 rounded hover:bg-blue-500/20">
            + Add Agent
          </button>
        </div>

        {isError && <p className="text-[var(--s-blk-tx)] text-sm mb-3">Failed to load agent registry.</p>}

        {isLoading ? (
          <p className="text-[var(--muted)] text-sm">Loading…</p>
        ) : agents.length === 0 ? (
          <p className="text-[var(--muted)] text-sm">No agents registered yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-[var(--muted)] border-b border-[var(--border-soft)]">
                  <th className="pb-2 pr-4 font-normal">Name</th>
                  <th className="pb-2 pr-4 font-normal">Type</th>
                  <th className="pb-2 pr-4 font-normal">Runtime</th>
                  <th className="pb-2 pr-4 font-normal">Endpoint</th>
                  <th className="pb-2 pr-4 font-normal">Provider</th>
                  <th className="pb-2 pr-4 font-normal">Enabled</th>
                  <th className="pb-2 font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="border-b border-[var(--border-soft)]/50 hover:bg-[var(--panel-subtle)]">
                    <td className="py-2 pr-4 text-[var(--text)] font-mono">{a.name}</td>
                    <td className="py-2 pr-4 text-[var(--muted)]">{a.type}</td>
                    <td className="py-2 pr-4">
                      <div className="font-mono text-[var(--text)]">{a.runtime_family}</div>
                      <div className="text-[11px] text-[var(--muted)]">{a.execution_mode}</div>
                    </td>
                    <td className="py-2 pr-4 text-[var(--muted)] font-mono max-w-[160px] truncate">
                      {a.endpoint ?? <span className="opacity-40">—</span>}
                    </td>
                    <td className="py-2 pr-4 text-[var(--muted)]">
                      {a.provider_id ? (providerMap[a.provider_id] ?? a.provider_id) : <span className="opacity-40">—</span>}
                    </td>
                    <td className="py-2 pr-4">
                      {a.enabled
                        ? <span className="px-1.5 py-0.5 rounded text-[11px] bg-[var(--s-ok-bg)] border border-[var(--s-ok-bd)] text-[var(--s-ok-tx)]">on</span>
                        : <span className="px-1.5 py-0.5 rounded text-[11px] bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)]">off</span>}
                    </td>
                    <td className="py-2">
                      <div className="flex gap-1.5 items-center flex-wrap">
                        {lifecycleMsg?.id === a.id && (
                          <span className="text-[var(--muted)] text-xs italic mr-1">{lifecycleMsg.msg}</span>
                        )}
                        <button onClick={() => handleLifecycle(a, 'restart')}
                          className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--s-att-bd)] text-[var(--s-att-tx)] rounded hover:bg-[var(--s-att-bg)]">
                          Restart
                        </button>
                        <button onClick={() => handleLifecycle(a, 'stop')}
                          className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel)]">
                          Stop
                        </button>
                        <button onClick={() => setModal({ mode: 'edit', agent: a })}
                          className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel)]">
                          Edit
                        </button>
                        {deletingId === a.id ? (
                          <>
                            <button onClick={() => handleDelete(a)}
                              className="px-2 py-1 text-xs bg-[var(--s-blk-bg)] border border-[var(--s-blk-bd)] text-[var(--s-blk-tx)] rounded">
                              Confirm
                            </button>
                            <button onClick={() => setDeletingId(null)}
                              className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded">
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button onClick={() => handleDelete(a)}
                            className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--s-blk-bd)]/60 text-[var(--s-blk-tx)] rounded hover:bg-[var(--s-blk-bg)]">
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

      <div>
        <h2 className="text-sm text-[var(--muted)] mb-3">Agent health</h2>
        {healthError && <p className="text-[var(--s-blk-tx)] text-sm">Failed to load agent status.</p>}
        {healthData.map((a) => (
          <div key={a.agent} className="bg-[var(--panel-subtle)] rounded px-3 py-2 mb-2 flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${a.healthy ? 'bg-[var(--s-ok-bd)]' : 'bg-[var(--s-blk-bd)]'}`} />
            <span className="text-[var(--text)] font-mono">{a.agent}</span>
            <span className="text-[var(--muted)] ml-auto">last seen {new Date(a.last_seen).toLocaleTimeString()}</span>
          </div>
        ))}
        {healthData.length === 0 && <p className="text-[var(--muted)] text-sm">No agents seen yet.</p>}
      </div>

      {modal && (
        <AgentModal
          mode={modal.mode}
          agent={modal.agent}
          providers={providers}
          onClose={() => setModal(null)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}
