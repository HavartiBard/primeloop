export interface ModelRef {
  providerID: string
  id: string
}

export interface TaskPrompt {
  text: string
  allowed_files: string[]
  read_files: string[]
  verification_cmd?: string
  metadata?: Record<string, unknown>
}

export interface TaskResult {
  text: string
  tokens: number
  changed_files?: string[]
  verification?: { command: string; exit_code: number; output: string }
  error?: string
}

export type HarnessEvent =
  | { type: 'task_start' }
  | { type: 'tool_call_start'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_call_end'; tool: string; result?: unknown; error?: string }
  | { type: 'message_update'; delta: string }
  | { type: 'progress'; summary: string }
  | { type: 'task_end'; result: TaskResult }

export interface TaskHandle {
  id: string
  events: AsyncIterable<HarnessEvent>
  done: Promise<TaskResult>
}

export type WakeOutcome = 'resumed' | 'redispatched' | 'noop'

export interface WakeResult {
  outcome: WakeOutcome
  reason?: string
}

export interface AgentHarness {
  start(opts: { cwd: string; model: ModelRef }): Promise<void>
  dispatch(prompt: TaskPrompt): Promise<TaskHandle>
  abort(taskId: string): Promise<void>
  close(): Promise<void>
  /**
   * Re-attach to an existing agent session after a restart (US1). Returns
   * `resumed` when the runtime natively reloaded the session (ACP `session/load`),
   * `redispatched` when the caller should re-dispatch from the durable checkpoint,
   * or `noop` when there is nothing to resume.
   */
  wake(sessionId: string): Promise<WakeResult>
}
