import type {
  Approval,
  AgentEvent,
  Provider,
  RegistryAgent,
  LifecycleResult,
  AgentControlPlaneToken,
  PortalState,
  RuntimeOverview,
  RuntimeThread,
  ThreadMessage,
  RuntimeWorkItem,
  RuntimeDelegation,
  RuntimeMemory,
  FleetPattern,
  FleetLearning,
  AgentMemoryRecord,
  AgentLessonRecord,
  LoopWarning,
  LoopWarningDrilldown,
  FleetLoopWarning,
  AgentSnapshot,
  FleetSnapshot,
  RuntimeAuditLoop,
  RuntimeEvent,
  PrimeSession,
  AgentWorkspaceStatus,
  AgentWorkspaceFile,
  PrimeMessageResult,
  CodexAuthStatus,
  CodexDeviceAuthResult,
  CodexDeviceAuthPoll,
  MCPServer,
} from './types'

const API_ORIGIN = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '')
const ROOT_BASE = API_ORIGIN || ''
const BASE = `${ROOT_BASE}/api/approvals`
const API_BASE = `${ROOT_BASE}/api`

export function getApiOrigin(): string {
  return API_ORIGIN
}

export async function readResponseBody<T>(res: Response): Promise<T | { error?: string; raw?: string } | null> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return { error: text, raw: text }
  }
}

export async function fetchPendingApprovals(): Promise<Approval[]> {
  const res = await fetch(`${BASE}/pending`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<Approval[]>
}

export async function approveAction(approvalId: string): Promise<void> {
  const res = await fetch(`${BASE}/${approvalId}/approve`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function denyAction(approvalId: string): Promise<void> {
  const res = await fetch(`${BASE}/${approvalId}/deny`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function fetchEvents(params?: { agent?: string; limit?: number }): Promise<AgentEvent[]> {
  const qs = new URLSearchParams()
  if (params?.agent) qs.set('agent', params.agent)
  if (params?.limit != null) qs.set('limit', String(params.limit))
  const res = await fetch(`${ROOT_BASE}/events?${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchAgents(): Promise<{ agent: string; last_seen: string; healthy: boolean }[]> {
  const res = await fetch(`${ROOT_BASE}/agents`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Providers
export async function fetchProviders(): Promise<Provider[]> {
  const res = await fetch(`${API_BASE}/providers`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<Provider[]>
}

export async function createProvider(data: Omit<Provider, 'id' | 'created_at'>): Promise<Provider> {
  const res = await fetch(`${API_BASE}/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const body = await readResponseBody<Partial<Provider> & { error?: string }>(res) as Partial<Provider> & { error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  if (!body) throw new Error('Empty response from provider create endpoint')
  return body as Provider
}

export async function updateProvider(id: string, data: Partial<Omit<Provider, 'id' | 'created_at'>>): Promise<Provider> {
  const res = await fetch(`${API_BASE}/providers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<Provider>
}

export async function replaceProviderKey(id: string, api_key: string): Promise<Provider> {
  const res = await fetch(`${API_BASE}/providers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key }),
  })
  if (!res.ok) throw new Error('Failed to replace API key')
  return res.json() as Promise<Provider>
}

export async function deleteProvider(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/providers/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function fetchSetupProviderModels(data: {
  type: string
  base_url: string
  api_key?: string
}): Promise<{ models: string[]; error?: string }> {
  const res = await fetch(`${API_BASE}/setup/provider-models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const body = await readResponseBody<{ models?: string[]; error?: string }>(res) as { models?: string[]; error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  if (!body) throw new Error('Empty response from model discovery endpoint')
  return { models: body.models ?? [], error: body.error }
}

// Agent Registry
export async function fetchAgentRegistry(): Promise<RegistryAgent[]> {
  const res = await fetch(`${API_BASE}/agents`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RegistryAgent[]>
}

export async function createAgent(data: Omit<RegistryAgent, 'id' | 'created_at'>): Promise<RegistryAgent> {
  const res = await fetch(`${API_BASE}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RegistryAgent>
}

export async function updateAgent(id: string, data: Partial<Omit<RegistryAgent, 'id' | 'created_at'>>): Promise<RegistryAgent> {
  const res = await fetch(`${API_BASE}/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RegistryAgent>
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/agents/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function agentLifecycle(id: string, action: 'restart' | 'stop' | 'start'): Promise<LifecycleResult> {
  const res = await fetch(`${API_BASE}/agents/${id}/lifecycle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<LifecycleResult>
}

export async function issueAgentControlPlaneToken(id: string, rotate = false): Promise<AgentControlPlaneToken> {
  const res = await fetch(`${API_BASE}/agents/${id}/control-plane-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rotate }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<AgentControlPlaneToken>
}

export async function fetchMcpServers(): Promise<MCPServer[]> {
  const res = await fetch(`${API_BASE}/mcp-servers`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<MCPServer[]>
}

export async function createMcpServer(data: Omit<MCPServer, 'id' | 'created_at'>): Promise<MCPServer> {
  const res = await fetch(`${API_BASE}/mcp-servers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<MCPServer>
}

export async function updateMcpServer(id: string, data: Partial<Omit<MCPServer, 'id' | 'created_at'>>): Promise<MCPServer> {
  const res = await fetch(`${API_BASE}/mcp-servers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<MCPServer>
}

export async function deleteMcpServer(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/mcp-servers/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function fetchPortalState(): Promise<PortalState> {
  const res = await fetch(`${API_BASE}/portal/state`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<PortalState>
}

export async function updatePortalState(state: PortalState): Promise<PortalState> {
  const res = await fetch(`${API_BASE}/portal/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<PortalState>
}

export async function fetchRuntimeOverview(): Promise<RuntimeOverview> {
  const res = await fetch(`${API_BASE}/runtime/overview`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RuntimeOverview>
}

export async function fetchRuntimeEvents(limit = 100): Promise<RuntimeEvent[]> {
  const res = await fetch(`${API_BASE}/runtime/events?limit=${limit}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RuntimeEvent[]>
}

export async function fetchPrimeSessions(limit = 50): Promise<PrimeSession[]> {
  const res = await fetch(`${API_BASE}/prime-agent/sessions?limit=${limit}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<PrimeSession[]>
}

export async function fetchAgentWorkspace(): Promise<AgentWorkspaceStatus> {
  const res = await fetch(`${API_BASE}/prime-agent/workspace`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<AgentWorkspaceStatus>
}

export async function updateAgentWorkspace(data: {
  mode?: 'local' | 'git'
  root_path?: string
  remote_url?: string | null
  branch?: string
}): Promise<AgentWorkspaceStatus> {
  const res = await fetch(`${API_BASE}/prime-agent/workspace`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<AgentWorkspaceStatus>
}

export async function initAgentWorkspace(): Promise<AgentWorkspaceStatus> {
  const res = await fetch(`${API_BASE}/prime-agent/workspace/init`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<AgentWorkspaceStatus>
}

export async function fetchAgentWorkspaceFile(filePath: string): Promise<AgentWorkspaceFile> {
  const res = await fetch(`${API_BASE}/prime-agent/workspace/file?path=${encodeURIComponent(filePath)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<AgentWorkspaceFile>
}

export async function saveAgentWorkspaceFile(
  filePath: string,
  content: string,
  expectedVersion?: string
): Promise<AgentWorkspaceFile> {
  const res = await fetch(`${API_BASE}/prime-agent/workspace/file`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content, expected_version: expectedVersion }),
  })
  if (!res.ok) {
    const body = await readResponseBody<{ error?: string }>(res)
    throw new Error(body && typeof body === 'object' && 'error' in body && body.error ? body.error : `HTTP ${res.status}`)
  }
  return res.json() as Promise<AgentWorkspaceFile>
}

export async function fetchThreads(): Promise<RuntimeThread[]> {
  const res = await fetch(`${API_BASE}/threads`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RuntimeThread[]>
}

export async function createThread(data: { title: string; metadata?: Record<string, unknown> }): Promise<RuntimeThread> {
  const res = await fetch(`${API_BASE}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RuntimeThread>
}

export async function fetchThreadMessages(threadId: string): Promise<ThreadMessage[]> {
  const res = await fetch(`${API_BASE}/threads/${threadId}/messages`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<ThreadMessage[]>
}

export async function appendThreadMessage(
  threadId: string,
  data: { role: string; sender: string; content: string; metadata?: Record<string, unknown> }
): Promise<ThreadMessage> {
  const res = await fetch(`${API_BASE}/threads/${threadId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<ThreadMessage>
}

export async function sendPrimeMessage(
  threadId: string,
  data: { content: string; sender?: string }
): Promise<PrimeMessageResult> {
  const res = await fetch(`${API_BASE}/threads/${threadId}/prime/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<PrimeMessageResult>
}

export async function fetchRuntimeWorkItems(params?: { status?: string }): Promise<RuntimeWorkItem[]> {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  const res = await fetch(`${API_BASE}/work-items?${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RuntimeWorkItem[]>
}

export async function createRuntimeWorkItem(data: Partial<RuntimeWorkItem> & { title: string }): Promise<RuntimeWorkItem> {
  const res = await fetch(`${API_BASE}/work-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RuntimeWorkItem>
}

export async function fetchRuntimeDelegations(params?: { status?: string }): Promise<RuntimeDelegation[]> {
  const qs = new URLSearchParams()
  if (params?.status) qs.set('status', params.status)
  const res = await fetch(`${API_BASE}/delegations?${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RuntimeDelegation[]>
}

export async function createRuntimeDelegation(data: {
  work_item_id?: string
  from_agent_id?: string
  to_agent_id?: string
  capability: string
  request?: Record<string, unknown>
}): Promise<RuntimeDelegation> {
  const res = await fetch(`${API_BASE}/delegations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RuntimeDelegation>
}

export async function runRuntimeDelegation(id: string): Promise<{
  delegation: RuntimeDelegation
  status: string
  blocked: boolean
  reason?: string
}> {
  const res = await fetch(`${API_BASE}/delegations/${id}/run`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchRuntimeMemory(category?: string): Promise<RuntimeMemory[]> {
  const qs = new URLSearchParams()
  if (category) qs.set('category', category)
  const res = await fetch(`${API_BASE}/memory?${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RuntimeMemory[]>
}

export async function fetchFleetPatterns(agentId?: string): Promise<FleetPattern[]> {
  const qs = new URLSearchParams()
  if (agentId) qs.set('agent_id', agentId)
  const res = await fetch(`${API_BASE}/fleet/patterns?${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<FleetPattern[]>
}

export async function fetchFleetLearnings(params?: { agentId?: string; query?: string; limit?: number }): Promise<FleetLearning[]> {
  const qs = new URLSearchParams()
  if (params?.agentId) qs.set('agent_id', params.agentId)
  if (params?.query) qs.set('query', params.query)
  if (params?.limit != null) qs.set('limit', String(params.limit))
  const res = await fetch(`${API_BASE}/fleet/learnings?${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<FleetLearning[]>
}

export async function fetchFleetLoopWarnings(params?: { agentId?: string; limit?: number }): Promise<FleetLoopWarning[]> {
  const qs = new URLSearchParams()
  if (params?.agentId) qs.set('agent_id', params.agentId)
  if (params?.limit != null) qs.set('limit', String(params.limit))
  const res = await fetch(`${API_BASE}/fleet/loop-warnings?${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<FleetLoopWarning[]>
}

export async function fetchFleetSnapshots(params?: { agentId?: string; limit?: number }): Promise<FleetSnapshot[]> {
  const qs = new URLSearchParams()
  if (params?.agentId) qs.set('agent_id', params.agentId)
  if (params?.limit != null) qs.set('limit', String(params.limit))
  const res = await fetch(`${API_BASE}/fleet/snapshots?${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<FleetSnapshot[]>
}

export async function publishFleetPattern(data: {
  type?: 'best_practice' | 'antipattern'
  content: string
  severity?: string
  source_agent_id?: string
  target_agent_ids?: string[]
}): Promise<{ pattern: FleetPattern; assigned_agent_ids: string[] }> {
  const res = await fetch(`${API_BASE}/fleet/patterns/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<{ pattern: FleetPattern; assigned_agent_ids: string[] }>
}

export async function fetchAgentLoopWarnings(agentId: string, limit = 20): Promise<LoopWarning[]> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/loop-warnings?limit=${limit}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<LoopWarning[]>
}

export async function fetchLoopWarningDrilldown(agentId: string, warningId: string): Promise<LoopWarningDrilldown> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/loop-warnings/${warningId}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<LoopWarningDrilldown>
}

export async function fetchAgentMemories(agentId: string, limit = 20): Promise<AgentMemoryRecord[]> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/memories?limit=${limit}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<AgentMemoryRecord[]>
}

export async function fetchAgentLessons(agentId: string, limit = 20): Promise<AgentLessonRecord[]> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/lessons?limit=${limit}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<AgentLessonRecord[]>
}

export async function fetchAgentSnapshots(agentId: string, limit = 20): Promise<AgentSnapshot[]> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/snapshots?limit=${limit}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<AgentSnapshot[]>
}

export async function resolveApprovalAsPrime(
  approvalId: string,
  decision: 'approved' | 'denied',
): Promise<{ approval: Approval; resumed?: unknown }> {
  const res = await fetch(`${BASE}/${approvalId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<{ approval: Approval; resumed?: unknown }>
}

// Codex auth
export async function fetchCodexAuthStatus(providerId: string): Promise<CodexAuthStatus> {
  const res = await fetch(`${API_BASE}/providers/${providerId}/codex/auth`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<CodexAuthStatus>
}

export async function startCodexDeviceAuth(providerId: string): Promise<CodexDeviceAuthResult> {
  const res = await fetch(`${API_BASE}/providers/${providerId}/codex/auth/device`, { method: 'POST' })
  const body = await readResponseBody<Partial<CodexDeviceAuthResult> & { error?: string; raw?: string }>(res) as Partial<CodexDeviceAuthResult> & { error?: string; raw?: string } | null
  if (!res.ok) throw new Error(body?.error ?? body?.raw ?? `HTTP ${res.status}`)
  if (!body) throw new Error('Empty response from device auth endpoint')
  return body as CodexDeviceAuthResult
}

export async function pollCodexDeviceAuth(providerId: string, sessionId: string): Promise<CodexDeviceAuthPoll> {
  const res = await fetch(`${API_BASE}/providers/${providerId}/codex/auth/device/${sessionId}`)
  const body = await readResponseBody<CodexDeviceAuthPoll & { error?: string }>(res) as CodexDeviceAuthPoll & { error?: string } | null
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
  if (!body) throw new Error('Empty response from device auth poll endpoint')
  return body
}

export async function codexApiKeyAuth(providerId: string, apiKey: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/providers/${providerId}/codex/auth/apikey`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  })
  const body = await readResponseBody<{ ok: boolean; error?: string }>(res) as { ok: boolean; error?: string } | null
  if (!body) return { ok: false, error: 'Empty response from API key auth endpoint' }
  return body
}

export async function codexLogout(providerId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_BASE}/providers/${providerId}/codex/auth/logout`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchRuntimeAuditLoops(): Promise<RuntimeAuditLoop[]> {
  const res = await fetch(`${API_BASE}/audit-loops`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<RuntimeAuditLoop[]>
}
