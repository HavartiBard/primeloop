import type { PrimeEvent } from './prime-agent/events.js'

export interface CheckpointContinuation {
  id: string
  owner_type: 'prime_session' | 'delegation'
  owner_id: string
  actor_agent_id?: string
  step: string
  context_hash: string
  context_snapshot: Record<string, unknown>
  continuation: Record<string, unknown>
  status: 'pending' | 'resumed' | 'discarded'
  expires_at?: string
  created_at: string
  resumed_at?: string
}

export interface CheckpointStore {
  enqueueItem(event: PrimeEvent, actorAgentId?: string): Promise<string>
  claimNextItem(): Promise<{ id: string; event: PrimeEvent } | null>
  completeItem(id: string): Promise<void>
  failItem(id: string, error: string): Promise<void>
  recoverStaleItems(): Promise<number>

  saveContinuation(opts: {
    owner_type: 'prime_session' | 'delegation'
    owner_id: string
    actor_agent_id?: string
    step: string
    context_snapshot: Record<string, unknown>
    continuation: Record<string, unknown>
  }): Promise<CheckpointContinuation>

  loadContinuation(ownerId: string): Promise<CheckpointContinuation | null>
  markResumed(id: string): Promise<void>
  discardContinuation(id: string): Promise<void>

  contextChanged(
    saved: CheckpointContinuation,
    fresh: Record<string, unknown>
  ): boolean
}
