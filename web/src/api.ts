import type {
  Approval,
  AgentEvent,
  Provider,
  RegistryAgent,
  LifecycleResult,
  PortalState,
  RuntimeOverview,
  RuntimeThread,
  ThreadMessage,
  RuntimeWorkItem,
  RuntimeDelegation,
  RuntimeMemory,
  RuntimeAuditLoop,
  RuntimeEvent,
  ChiefMessageResult,
  CodexAuthStatus,
  CodexDeviceAuthResult,
  CodexDeviceAuthPoll,
} from './types'

const BASE = '/api/approvals'
const API_BASE = '/api'

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
  const res = await fetch(`/events?${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchAgents(): Promise<{ agent: string; last_seen: string; healthy: boolean }[]> {
  const res = await fetch('/agents')
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
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<Provider>
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

export async function deleteProvider(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/providers/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
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

export async function sendChiefMessage(
  threadId: string,
  data: { content: string; sender?: string }
): Promise<ChiefMessageResult> {
  const res = await fetch(`${API_BASE}/threads/${threadId}/chief/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<ChiefMessageResult>
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

export async function fetchCodexAuthStatus(providerId: string): Promise<CodexAuthStatus> {
  const res = await fetch(`${API_BASE}/providers/${providerId}/codex/auth`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<CodexAuthStatus>
}

export async function startCodexDeviceAuth(providerId: string): Promise<CodexDeviceAuthResult> {
  const res = await fetch(`${API_BASE}/providers/${providerId}/codex/auth/device`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<CodexDeviceAuthResult>
}

export async function pollCodexDeviceAuth(providerId: string, sessionId: string): Promise<CodexDeviceAuthPoll> {
  const res = await fetch(`${API_BASE}/providers/${providerId}/codex/auth/device/${sessionId}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<CodexDeviceAuthPoll>
}

export async function codexApiKeyAuth(providerId: string, apiKey: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${API_BASE}/providers/${providerId}/codex/auth/apikey`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey }),
  })
  return res.json()
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
