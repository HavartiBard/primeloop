export interface AgentEvent {
  id: string
  agent: string
  type: string
  payload: Record<string, unknown>
  created_at: string
}
