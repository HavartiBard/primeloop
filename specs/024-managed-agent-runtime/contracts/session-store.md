# Contract: SessionStore (FR-001, FR-005, FR-006)

Read model over `runtime_events` (primary) merged with `thread_messages`,
`delegations.trace`, and `checkpoint_continuations`. Backed by `(session_id, seq)`.

```ts
type SessionId = string

interface SessionEvent {
  session_id: SessionId
  seq: number            // monotonic within session
  event_type: string
  actor: string
  payload: Record<string, unknown>
  created_at: string
}

interface SessionHeader {
  session_id: SessionId
  owner_type: 'delegation' | 'prime_session'
  owner_id: string
  agent_id?: string
  first_seq: number
  last_seq: number
  status: string
}

interface EventRange {
  from?: number          // inclusive seq
  to?: number            // inclusive seq
  last?: number          // most-recent N (mutually exclusive with from/to)
}

interface SessionStore {
  appendEvent(sessionId: SessionId, e: Omit<SessionEvent,'seq'|'created_at'>): Promise<SessionEvent>
  getSession(sessionId: SessionId): Promise<SessionHeader | null>
  getEvents(sessionId: SessionId, range?: EventRange): Promise<SessionEvent[]>  // bounded; never full-history unless explicitly unbounded
}
```

**Guarantees**
- `getEvents` with `last`/`from`/`to` MUST issue a bounded SQL range query (no full
  table scan, no full-history materialization) — satisfies FR-006 / SC-005.
- `seq` is gap-tolerant but strictly increasing per session; ordering is by `seq`,
  not `created_at`.
- The merged timeline is read-only; writes go only through `appendEvent`
  (which wraps `insertRuntimeEvent`).
