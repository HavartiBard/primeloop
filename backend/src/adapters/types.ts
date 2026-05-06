import type { RegistryAgent } from '../registry.js'

export interface AgentCapabilities {
  name: string
  runtime_family: string
  execution_mode: string
  capabilities: string[]
  protocol?: string
  metadata?: Record<string, unknown>
}

export interface AgentHealth {
  healthy: boolean
  status: string
  details?: Record<string, unknown>
}

export interface AgentTaskRequest {
  task_id?: string
  capability: string
  input: Record<string, unknown>
  work_item_id?: string
  delegation_id?: string
}

export interface AgentMessageRequest {
  thread_id?: string
  content: string
  metadata?: Record<string, unknown>
}

export interface AgentTaskState {
  id: string
  status: string
  result?: Record<string, unknown>
}

export interface AgentRuntimeEvent {
  type: string
  payload: Record<string, unknown>
}

export interface AgentAdapter {
  discover(agent: RegistryAgent): Promise<AgentCapabilities>
  health(agent: RegistryAgent): Promise<AgentHealth>
  startTask(agent: RegistryAgent, request: AgentTaskRequest): AsyncIterable<AgentRuntimeEvent>
  sendMessage(agent: RegistryAgent, request: AgentMessageRequest): AsyncIterable<AgentRuntimeEvent>
  getTask(agent: RegistryAgent, taskId: string): Promise<AgentTaskState>
  cancelTask(agent: RegistryAgent, taskId: string): Promise<void>
}
