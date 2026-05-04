export interface AgentEvent {
  id: string
  agent: string
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

export interface Provider {
  id: string
  name: string
  type: string
  base_url: string
  api_key?: string
  created_at: string
}

export interface RegistryAgent {
  id: string
  name: string
  type: string
  provider_id?: string
  host?: string
  container_name?: string
  ssh_user?: string
  config: Record<string, unknown>
  enabled: boolean
  created_at: string
}

export interface LifecycleResult {
  ok: boolean
  output: string
}
