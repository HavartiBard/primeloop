// Session types for the session store (FR-001, FR-005, FR-006)

export type SessionId = string

export interface SessionEvent {
  session_id: SessionId
  seq: number            // monotonic within session
  event_type: string
  actor: string
  payload: Record<string, unknown>
  created_at: string
}

export interface SessionHeader {
  session_id: SessionId
  owner_type: 'delegation' | 'prime_session'
  owner_id: string
  agent_id?: string
  first_seq: number
  last_seq: number
  status: string
}

export interface EventRange {
  from?: number          // inclusive seq
  to?: number            // inclusive seq
  last?: number          // most-recent N (mutually exclusive with from/to)
}
