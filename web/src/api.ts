import type { Approval, AgentEvent, Provider, RegistryAgent, LifecycleResult } from './types'

const BASE = '/webhook/langgraph'
const API_BASE = '/api'

export async function fetchPendingApprovals(): Promise<Approval[]> {
  const res = await fetch(`${BASE}/approvals/pending`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<Approval[]>
}

export async function approveAction(approvalId: string): Promise<void> {
  const res = await fetch(`${BASE}/approvals/${approvalId}/approve`, { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function denyAction(approvalId: string): Promise<void> {
  const res = await fetch(`${BASE}/approvals/${approvalId}/deny`, { method: 'POST' })
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
