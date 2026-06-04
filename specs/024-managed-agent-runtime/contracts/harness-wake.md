# Contract: AgentHarness.wake + Recovery (FR-002, FR-003, FR-004, FR-016)

Extends the existing `AgentHarness` interface in `fleet-executor/harness.ts`.

```ts
interface AgentHarness {
  start(opts: { cwd: string; model: ModelRef }): Promise<void>
  dispatch(prompt: TaskPrompt): Promise<TaskHandle>
  abort(taskId: string): Promise<void>
  close(): Promise<void>
  wake(sessionId: string): Promise<WakeResult>      // NEW
}

type WakeResult =
  | { outcome: 'resumed'; handle: TaskHandle }       // native ACP loadSession
  | { outcome: 'redispatched'; handle: TaskHandle }  // checkpoint re-dispatch fallback
  | { outcome: 'noop'; reason: 'already_completed' | 'already_resumed' }
```

**Recovery service** (`recovery/service.ts`, invoked at process-manager boot):

```ts
interface RecoveryService {
  recoverInflight(): Promise<RecoveryReport>   // scans in-flight delegations
}

interface RecoveryReport {
  resumed: string[]        // delegation ids resumed in place (durable)
  redispatched: string[]   // delegation ids re-dispatched (ephemeral or no loadSession)
  recovered_failed: string[] // unrecoverable → recorded outcome, never silent
}
```

**Rules**
- Branch by `agents.tier`: `durable` → `wake` in place (ACP `session/load` if the agent
  advertised `load_session`, else fallback); `ephemeral` → re-dispatch fresh from the
  latest `checkpoint_continuations` row.
- Idempotency: claim each delegation with `FOR UPDATE SKIP LOCKED` and bump
  `delegations.recovery_epoch`; a duplicate `wake` returns `noop`. No side effect
  (tool call) runs twice — approvals are re-evaluated, not replayed.
- Every result emits a `runtime_events` row (`session.resumed` / `delegation.recovered`
  / `delegation.recovered_failed`). No delegation may be left silently failed (SC-001).
- Behind feature flag `RESUME_ON_RESTART`; off → legacy fail-and-requeue (FR-017).
