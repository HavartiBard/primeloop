import type { Approval, AgentEvent } from './types'

const BASE = '/webhook/langgraph'

export async function fetchPendingApprovals(): Promise<Approval[]> {
  const res = await fetch(`${BASE}/approvals/pending`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<Approval[]>
}

export async function approveAction(approvalId: string): Promise<void> {
  await fetch(`${BASE}/approvals/${approvalId}/approve`, { method: 'POST' })
}

export async function denyAction(approvalId: string): Promise<void> {
  await fetch(`${BASE}/approvals/${approvalId}/deny`, { method: 'POST' })
}

export async function fetchEvents(params?: { agent?: string; limit?: number }): Promise<AgentEvent[]> {
  const qs = new URLSearchParams()
  if (params?.agent) qs.set('agent', params.agent)
  if (params?.limit) qs.set('limit', String(params.limit))
  const res = await fetch(`/events?${qs}`)
  return res.json()
}

export async function fetchAgents(): Promise<{ agent: string; last_seen: string; healthy: boolean }[]> {
  const res = await fetch('/agents')
  return res.json()
}
