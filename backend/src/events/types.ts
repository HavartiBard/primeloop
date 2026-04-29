export interface AgentEvent {
  id: string
  agent: 'langgraph' | 'raclette'
  type: string
  payload: Record<string, unknown>
  created_at: string
}
