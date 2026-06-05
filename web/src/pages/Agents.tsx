import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchAgentLessons, fetchAgentLoopWarnings, fetchAgentMemories, fetchAgentSnapshots, fetchAgents, fetchRuntimeEvents, issueAgentControlPlaneToken } from '../api'
import { DisplayStatusBadge } from '../components/agentCanvas'
import { useAgentRegistry } from '../hooks/useAgentRegistry'
import { useMcpServers } from '../hooks/useMcpServers'
import { useProviders } from '../hooks/useProviders'
import type { AgentControlPlaneToken, Provider, RegistryAgent, RuntimeEvent } from '../types'

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
  mcp_server_ids: string[]
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
  mcp_server_ids: [],
  config_json: '{}',
  enabled: true,
}

// Fields that get auto-filled when a codex provider is selected
const CODEX_DEFAULTS = {
  runtime_family: 'codex-app-server',
  execution_mode: 'local',
}

interface AgentEditorProps {
  mode: 'add' | 'edit'
  agent?: RegistryAgent
  providers: Provider[]
  mcpServerOptions: Array<{ id: string; name: string; type: string }>
  onClose: () => void
  onSubmit: (data: AgentFormState) => void
}

function AgentEditor({ mode, agent, providers, mcpServerOptions, onClose, onSubmit }: AgentEditorProps) {
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
    mcp_server_ids: agent?.mcp_server_ids ?? [],
    config_json: agent?.config ? JSON.stringify(agent.config, null, 2) : '{}',
    enabled: agent?.enabled ?? true,
  })
  const [jsonError, setJsonError] = useState<string | null>(null)

  const setField =
    (field: keyof AgentFormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }))

  const toggleMcpServer = (serverId: string) =>
    setForm((current) => ({
      ...current,
      mcp_server_ids: current.mcp_server_ids.includes(serverId)
        ? current.mcp_server_ids.filter((id) => id !== serverId)
        : [...current.mcp_server_ids, serverId],
    }))

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
    <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--text)]">
          {mode === 'add' ? 'Add Agent' : `Edit ${agent?.name ?? 'Agent'}`}
        </h2>
        <button type="button" onClick={onClose}
          className="px-3 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel)]">
          Close
        </button>
      </div>
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

        <div className="border-t border-[var(--border-soft)] pt-4 mt-1">
          <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">
            MCP Servers
          </h3>
          {mcpServerOptions.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">No external MCP servers registered yet.</p>
          ) : (
            <div className="grid gap-2">
              {mcpServerOptions.map((server) => (
                <label key={server.id} className="flex items-center gap-2 text-xs text-[var(--text)]">
                  <input
                    type="checkbox"
                    checked={form.mcp_server_ids.includes(server.id)}
                    onChange={() => toggleMcpServer(server.id)}
                    className="accent-blue-500"
                  />
                  <span className="font-mono">{server.name}</span>
                  <span className="text-[var(--muted)]">{server.type}</span>
                </label>
              ))}
            </div>
          )}
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
  )
}

function formatHealthTime(value?: string) {
  return value ? new Date(value).toLocaleTimeString() : 'never'
}

function healthBadge(healthy?: boolean) {
  if (healthy == null) {
    return {
      dot: 'bg-slate-500/60',
      label: 'unknown',
      text: 'text-[var(--muted)]',
    }
  }
  if (healthy) {
    return {
      dot: 'bg-[var(--s-ok-bd)]',
      label: 'healthy',
      text: 'text-[var(--s-ok-tx)]',
    }
  }
  return {
    dot: 'bg-[var(--s-blk-bd)]',
    label: 'offline',
    text: 'text-[var(--s-blk-tx)]',
  }
}

export function Agents() {
  const { agents, isLoading, isError, create, update, remove, lifecycle } = useAgentRegistry()
  const { providers } = useProviders()
  const { mcpServers } = useMcpServers()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [lifecycleMsg, setLifecycleMsg] = useState<{ id: string; msg: string } | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [issuedToken, setIssuedToken] = useState<AgentControlPlaneToken | null>(null)
  const [showIssuedToken, setShowIssuedToken] = useState(false)
  const [panelMode, setPanelMode] = useState<'empty' | 'inspect' | 'edit' | 'create'>('empty')

  const providerMap = Object.fromEntries(providers.map((p) => [p.id, p.name]))

  const handleSubmit = (form: AgentFormState) => {
    let config: Record<string, unknown> = {}
    try { config = JSON.parse(form.config_json) } catch { /* validated in editor */ }
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
      mcp_server_ids: form.mcp_server_ids,
    }

    if (panelMode === 'edit' && selectedAgentId) {
      update(selectedAgentId, payload)
      setSelectedAgentId(selectedAgentId)
      setPanelMode('inspect')
    } else {
      create(payload)
      setPanelMode('empty')
    }
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
  const healthMap = new Map(healthData.map((item) => [item.agent, item]))
  const effectiveSelectedAgentId = selectedAgentId ?? agents[0]?.id
  const { data: selectedLoopWarnings = [] } = useQuery({
    queryKey: ['agent-loop-warnings', effectiveSelectedAgentId],
    queryFn: () => effectiveSelectedAgentId ? fetchAgentLoopWarnings(effectiveSelectedAgentId, 8) : Promise.resolve([]),
    enabled: Boolean(effectiveSelectedAgentId),
    refetchInterval: 30_000,
  })
  const { data: selectedSnapshots = [] } = useQuery({
    queryKey: ['agent-snapshots', effectiveSelectedAgentId],
    queryFn: () => effectiveSelectedAgentId ? fetchAgentSnapshots(effectiveSelectedAgentId, 6) : Promise.resolve([]),
    enabled: Boolean(effectiveSelectedAgentId),
    refetchInterval: 30_000,
  })
  const { data: selectedMemories = [] } = useQuery({
    queryKey: ['agent-memories', effectiveSelectedAgentId],
    queryFn: () => effectiveSelectedAgentId ? fetchAgentMemories(effectiveSelectedAgentId, 6) : Promise.resolve([]),
    enabled: Boolean(effectiveSelectedAgentId),
    refetchInterval: 30_000,
  })
  const { data: selectedLessons = [] } = useQuery({
    queryKey: ['agent-lessons', effectiveSelectedAgentId],
    queryFn: () => effectiveSelectedAgentId ? fetchAgentLessons(effectiveSelectedAgentId, 6) : Promise.resolve([]),
    enabled: Boolean(effectiveSelectedAgentId),
    refetchInterval: 30_000,
  })
  const issueTokenMutation = useMutation({
    mutationFn: ({ agentId, rotate }: { agentId: string; rotate: boolean }) => issueAgentControlPlaneToken(agentId, rotate),
    onSuccess: (token) => {
      setIssuedToken(token)
      setSelectedAgentId(token.agent_id)
      setShowIssuedToken(false)
      setPanelMode((current) => current === 'empty' ? 'inspect' : current)
    },
  })
  const selectedAgent = agents.find((agent) => agent.id === effectiveSelectedAgentId)
  const { data: runtimeEvents = [], isLoading: runtimeEventsLoading, isError: runtimeEventsError } = useQuery({
    queryKey: ['runtime-events', 'credential-risk'],
    queryFn: () => fetchRuntimeEvents(200),
    refetchInterval: 30_000,
  })
  const selectedAgentRiskEvent = useMemo(() => {
    if (!selectedAgent) return null
    return runtimeEvents.find((event: RuntimeEvent) =>
      event.event_type === 'credential.risk_flagged' && event.payload?.['agent_id'] === selectedAgent.id,
    ) ?? null
  }, [runtimeEvents, selectedAgent])

  useEffect(() => {
    if (agents.length === 0) {
      setSelectedAgentId(null)
      if (panelMode !== 'create') setPanelMode('empty')
      return
    }
    if (!selectedAgentId) {
      setSelectedAgentId(agents[0].id)
      if (panelMode === 'empty') setPanelMode('inspect')
      return
    }
    if (!agents.some((agent) => agent.id === selectedAgentId)) {
      setSelectedAgentId(agents[0].id)
      if (panelMode !== 'create') setPanelMode('inspect')
    }
  }, [agents, selectedAgentId, panelMode])

  const maskToken = (token: string) => {
    if (token.length <= 12) return '••••••••'
    return `${token.slice(0, 6)}••••••••${token.slice(-4)}`
  }

  return (
    <div className="p-4">
      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm text-[var(--muted)]">Agent Registry</h2>
            {healthError && <p className="mt-1 text-xs text-[var(--s-blk-tx)]">Heartbeat status is temporarily unavailable.</p>}
          </div>
          <button onClick={() => setPanelMode('create')}
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
          <div className="overflow-x-auto rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)]">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-[var(--border-soft)] text-[var(--muted)]">
                  <th className="px-4 py-3 font-normal">Name</th>
                  <th className="px-4 py-3 font-normal">Type</th>
                  <th className="px-4 py-3 font-normal">Runtime</th>
                  <th className="px-4 py-3 font-normal">Endpoint</th>
                  <th className="px-4 py-3 font-normal">Provider</th>
                  <th className="px-4 py-3 font-normal">Health</th>
                  <th className="px-4 py-3 font-normal">Enabled</th>
                  <th className="px-4 py-3 font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const health = healthMap.get(a.name)
                  const badge = healthBadge(health?.healthy)
                  const isSelected = effectiveSelectedAgentId === a.id && panelMode !== 'create'
                  return (
                    <tr
                      key={a.id}
                      onClick={() => {
                        setSelectedAgentId(a.id)
                        setPanelMode('inspect')
                      }}
                      className={`cursor-pointer border-b border-[var(--border-soft)]/50 transition hover:bg-[var(--panel-subtle)] ${isSelected ? 'bg-[var(--sel-bg)]/35' : ''}`}
                    >
                      <td className="px-4 py-3 text-[var(--text)] font-mono">
                        {a.name}
                        {!!a.config?.onboarding_created && (
                          <span className="ml-1.5 px-1 py-0.5 rounded text-[10px] bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)]">onboarding</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">{a.type}</td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-[var(--text)]">{a.runtime_family}</div>
                        <div className="text-[11px] text-[var(--muted)]">{a.execution_mode}</div>
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)] font-mono max-w-[160px] truncate">
                        {a.endpoint ?? <span className="opacity-40">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">
                        {a.provider_id ? (providerMap[a.provider_id] ?? a.provider_id) : <span className="opacity-40">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${badge.dot}`} />
                          <div>
                            <div className={`text-[11px] ${badge.text}`}>{badge.label}</div>
                            <div className="text-[10px] text-[var(--muted)]">seen {formatHealthTime(health?.last_seen)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {a.enabled
                          ? <span className="px-1.5 py-0.5 rounded text-[11px] bg-[var(--s-ok-bg)] border border-[var(--s-ok-bd)] text-[var(--s-ok-tx)]">on</span>
                          : <span className="px-1.5 py-0.5 rounded text-[11px] bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)]">off</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5 items-center flex-wrap">
                          {lifecycleMsg?.id === a.id && (
                            <span className="text-[var(--muted)] text-xs italic mr-1">{lifecycleMsg.msg}</span>
                          )}
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              handleLifecycle(a, 'restart')
                            }}
                            className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--s-att-bd)] text-[var(--s-att-tx)] rounded hover:bg-[var(--s-att-bg)]"
                          >
                            Restart
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              handleLifecycle(a, 'stop')
                            }}
                            className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel)]"
                          >
                            Stop
                          </button>
                          <button
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedAgentId(a.id)
                              setPanelMode('edit')
                            }}
                            className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel)]"
                          >
                            Edit
                          </button>
                          {deletingId === a.id ? (
                            <>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleDelete(a)
                                }}
                                className="px-2 py-1 text-xs bg-[var(--s-blk-bg)] border border-[var(--s-blk-bd)] text-[var(--s-blk-tx)] rounded"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setDeletingId(null)
                                }}
                                className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={(event) => {
                                event.stopPropagation()
                                handleDelete(a)
                              }}
                              className="px-2 py-1 text-xs bg-[var(--panel-subtle)] border border-[var(--s-blk-bd)]/60 text-[var(--s-blk-tx)] rounded hover:bg-[var(--s-blk-bg)]"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mb-8 rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
        {panelMode === 'create' ? (
          <AgentEditor
            key="create"
            mode="add"
            providers={providers}
            mcpServerOptions={mcpServers.map((server) => ({ id: server.id, name: server.name, type: server.type }))}
            onClose={() => setPanelMode(selectedAgent ? 'inspect' : 'empty')}
            onSubmit={handleSubmit}
          />
        ) : panelMode === 'edit' && selectedAgent ? (
          <AgentEditor
            key={`edit:${selectedAgent.id}`}
            mode="edit"
            agent={selectedAgent}
            providers={providers}
            mcpServerOptions={mcpServers.map((server) => ({ id: server.id, name: server.name, type: server.type }))}
            onClose={() => setPanelMode('inspect')}
            onSubmit={handleSubmit}
          />
        ) : selectedAgent ? (
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-[0.28em] text-[var(--muted)]">Selected Agent</div>
                <h3 className="mt-1 text-lg font-semibold text-[var(--text)]">{selectedAgent.name}</h3>
                <div className="mt-1 text-sm text-[var(--muted)]">{selectedAgent.type} · {selectedAgent.runtime_family} · {selectedAgent.execution_mode}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setPanelMode('edit')}
                  className="px-3 py-1.5 text-xs bg-[var(--sel-bg)] border border-[var(--sel-bd)] text-blue-300 rounded hover:bg-blue-500/20"
                >
                  Edit Agent
                </button>
                <button
                  onClick={() => issueTokenMutation.mutate({ agentId: selectedAgent.id, rotate: false })}
                  className="px-3 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--sel-bd)] text-blue-300 rounded hover:bg-blue-500/10"
                >
                  Issue CP Token
                </button>
                <button
                  onClick={() => issueTokenMutation.mutate({ agentId: selectedAgent.id, rotate: true })}
                  className="px-3 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel)]"
                >
                  Rotate Token
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Runtime</div>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="text-[var(--text)]">Endpoint: <span className="font-mono">{selectedAgent.endpoint ?? '—'}</span></div>
                  <div className="text-[var(--text)]">Provider: {selectedAgent.provider_id ? (providerMap[selectedAgent.provider_id] ?? selectedAgent.provider_id) : '—'}</div>
                  <div className="text-[var(--text)]">Host: {selectedAgent.host ?? '—'}</div>
                  <div className="text-[var(--text)]">Container: {selectedAgent.container_name ?? '—'}</div>
                  <div className="text-[var(--text)]">Local port: {selectedAgent.local_port ?? '—'}</div>
                  <div className="text-[var(--text)]">Worktree: <span className="font-mono">{selectedAgent.worktree_path ?? '—'}</span></div>
                </div>
              </div>

              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Capabilities & MCP</div>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="text-[var(--text)]">
                    Capabilities: {selectedAgent.capabilities.length > 0 ? selectedAgent.capabilities.join(', ') : '—'}
                  </div>
                  <div className="text-[var(--text)]">
                    MCP servers: {selectedAgent.mcp_server_ids && selectedAgent.mcp_server_ids.length > 0 ? selectedAgent.mcp_server_ids.length : 0}
                  </div>
                  <div className="text-[var(--text)]">Enabled: {selectedAgent.enabled ? 'yes' : 'no'}</div>
                </div>
              </div>

              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 xl:col-span-2">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Credential Risk</div>
                <div className="mt-3 text-sm">
                  {runtimeEventsLoading ? (
                    <div className="text-[var(--muted)]">Loading credential status…</div>
                  ) : runtimeEventsError ? (
                    <div className="text-[var(--s-blk-tx)]">Failed to load credential status.</div>
                  ) : selectedAgentRiskEvent ? (
                    <div className="flex flex-col gap-2">
                      <div><DisplayStatusBadge status="risky" /></div>
                      <div className="text-[var(--text)]">
                        Latest risk event: <span className="font-mono">{new Date(selectedAgentRiskEvent.created_at).toLocaleString()}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[var(--muted)]">No risky credentials flagged.</div>
                  )}
                </div>
              </div>

              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4 xl:col-span-2">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">Profile</div>
                <div className="mt-3 grid gap-4 xl:grid-cols-2">
                  <div>
                    <div className="mb-2 text-xs text-[var(--muted)]">Operating Instructions</div>
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-[var(--panel)] p-3 text-[12px] text-[var(--text)]">{selectedAgent.system_prompt ?? '—'}</pre>
                  </div>
                  <div>
                    <div className="mb-2 text-xs text-[var(--muted)]">Soul</div>
                    <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-[var(--panel)] p-3 text-[12px] text-[var(--text)]">{selectedAgent.soul ?? '—'}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-sm text-[var(--muted)]">Agent Details</div>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Select an agent in the registry to inspect it here, or add a new agent to open the creation form.
            </p>
          </div>
        )}
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-2">
        <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5 xl:col-span-2">
          <h3 className="text-sm text-[var(--muted)] mb-3">External Agent Bridge</h3>
          {effectiveSelectedAgentId ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => issueTokenMutation.mutate({ agentId: effectiveSelectedAgentId, rotate: false })}
                  className="px-3 py-1.5 text-xs bg-[var(--sel-bg)] border border-[var(--sel-bd)] text-blue-300 rounded hover:bg-blue-500/20"
                >
                  Issue Token
                </button>
                <button
                  onClick={() => issueTokenMutation.mutate({ agentId: effectiveSelectedAgentId, rotate: true })}
                  className="px-3 py-1.5 text-xs bg-[var(--panel-subtle)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel)]"
                >
                  Rotate Token
                </button>
                {issueTokenMutation.isPending && <span className="text-xs text-[var(--muted)]">issuing…</span>}
              </div>

              <div className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="text-xs text-[var(--muted)]">Bridge endpoint</div>
                <div className="mt-1 font-mono text-sm text-[var(--text)]">POST /api/control-plane/tools/:name</div>
                <div className="mt-3 text-xs text-[var(--muted)]">Tool discovery</div>
                <div className="mt-1 font-mono text-sm text-[var(--text)]">GET /api/control-plane/tools</div>
              </div>

              {issuedToken?.agent_id === effectiveSelectedAgentId ? (
                <div className="rounded-[1rem] border border-[var(--sel-bd)] bg-[var(--sel-bg)]/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-[var(--muted)]">Bearer token</div>
                    <button
                      onClick={() => setShowIssuedToken((current) => !current)}
                      className="px-2 py-1 text-xs bg-[var(--panel)] border border-[var(--border-soft)] text-[var(--muted)] rounded hover:bg-[var(--panel-subtle)]"
                    >
                      {showIssuedToken ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <div className="mt-1 break-all font-mono text-sm text-[var(--text)]">
                    {showIssuedToken ? issuedToken.token : maskToken(issuedToken.token)}
                  </div>
                  <div className="mt-3 text-xs text-[var(--muted)]">Example</div>
                  <pre className="mt-1 overflow-x-auto rounded bg-[var(--panel)] p-3 text-[11px] text-[var(--text)]">{`curl -X POST http://localhost:3100${issuedToken.endpoint}/memory_store \\
  -H "Authorization: ${issuedToken.auth_scheme} ${showIssuedToken ? issuedToken.token : '<token>'}" \\
  -H "Content-Type: application/json" \\
  -d '{"arguments":{"content":"Remember deployment context","category":"ops","importance":4}}'`}</pre>
                </div>
              ) : (
                <p className="text-[var(--muted)] text-sm">
                  Issue a token for the selected agent to let an external runtime call the control-plane tool surface over HTTP.
                </p>
              )}
            </div>
          ) : (
            <p className="text-[var(--muted)] text-sm">Select or inspect an agent first.</p>
          )}
        </div>

        <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
          <h3 className="text-sm text-[var(--muted)] mb-3">Loop warnings</h3>
          <div className="space-y-3">
            {selectedLoopWarnings.map((warning, index) => (
              <div key={`${warning.kind}:${warning.created_at}:${index}`} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[var(--text)]">{warning.summary}</div>
                  <div className="text-xs text-[var(--muted)]">{warning.severity}</div>
                </div>
                <div className="mt-2 text-xs text-[var(--muted)]">{warning.kind}</div>
              </div>
            ))}
            {selectedLoopWarnings.length === 0 && (
              <p className="text-[var(--muted)] text-sm">No loop warnings for the selected agent.</p>
            )}
          </div>
        </div>

        <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
          <h3 className="text-sm text-[var(--muted)] mb-3">Recent snapshots</h3>
          <div className="space-y-3">
            {selectedSnapshots.map((snapshot) => (
              <div key={snapshot.id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="text-sm font-semibold text-[var(--text)]">{snapshot.title}</div>
                {snapshot.summary && <div className="mt-2 text-sm text-[var(--text)]">{snapshot.summary}</div>}
                <div className="mt-2 text-xs text-[var(--muted)]">{new Date(snapshot.created_at).toLocaleString()}</div>
              </div>
            ))}
            {selectedSnapshots.length === 0 && (
              <p className="text-[var(--muted)] text-sm">No snapshots for the selected agent.</p>
            )}
          </div>
        </div>
        <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
          <h3 className="text-sm text-[var(--muted)] mb-3">Recent memories</h3>
          <div className="space-y-3">
            {selectedMemories.map((memory) => (
              <div key={memory.id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[var(--text)]">{memory.category ?? 'general'}</div>
                  <div className="text-xs text-[var(--muted)]">importance {memory.importance}</div>
                </div>
                <div className="mt-2 text-sm text-[var(--text)]">{memory.content}</div>
              </div>
            ))}
            {selectedMemories.length === 0 && (
              <p className="text-[var(--muted)] text-sm">No memories for the selected agent.</p>
            )}
          </div>
        </div>
        <div className="rounded-[1.2rem] border border-[var(--border-soft)] bg-[var(--panel)] p-5">
          <h3 className="text-sm text-[var(--muted)] mb-3">Recent lessons</h3>
          <div className="space-y-3">
            {selectedLessons.map((lesson) => (
              <div key={lesson.id} className="rounded-[1rem] border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-[var(--text)]">{lesson.category ?? 'general'}</div>
                  <div className="text-xs text-[var(--muted)]">{lesson.severity}</div>
                </div>
                <div className="mt-2 text-sm text-[var(--text)]">{lesson.content}</div>
                {lesson.context && <div className="mt-2 text-xs text-[var(--muted)]">Context: {lesson.context}</div>}
              </div>
            ))}
            {selectedLessons.length === 0 && (
              <p className="text-[var(--muted)] text-sm">No lessons for the selected agent.</p>
            )}
          </div>
        </div>
      </div>

    </div>
  )
}
