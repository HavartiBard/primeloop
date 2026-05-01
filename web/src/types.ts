export interface AgentEvent {
  id: string
  agent: 'langgraph' | 'raclette'
  type: string
  payload: Record<string, unknown>
  created_at: string
}

export interface Approval {
  approval_id: string
  run_id: string
  action: string
  status: 'pending' | 'approved' | 'denied'
  created_at: string
  decided_at?: string
}
