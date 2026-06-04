# Contract: RuntimeLease (FR-012, FR-013, FR-014)

Drives on-demand (cattle) provisioning of durable runtimes and idle reclamation.

```ts
interface RuntimeLease {
  // Acquire a runtime for an agent, provisioning on first use. Concurrent callers
  // for a still-provisioning agent await the same lease (no double-provision).
  acquire(agentId: string): Promise<{ leaseId: string; harness: AgentHarness }>
  touch(leaseId: string): Promise<void>          // reset idle clock on activity
  release(leaseId: string): Promise<void>        // explicit release
  reclaimIdle(): Promise<string[]>               // sweep: tear down >10min idle, return agentIds
}
```

**Rules**
- `OpenCodeProcessManager.initialize()` no longer eagerly spawns durable agents; the
  dispatcher calls `acquire` when routing work (FR-012).
- Provisioning MUST reach `ready` within ≤5s p95 / ≤10s p99 from `acquire` to accept
  (FR-014); no pre-warm pool. Work routed during `provisioning` queues on the lease.
- `reclaimIdle` (a `node-cron` sweep over `runtime_leases` where
  `last_activity_at < now()-10min`) tears down the sandbox, sets `status='reclaimed'`,
  and emits `runtime.reclaimed`. The agent's DB identity/records are untouched (FR-013).
- Re-acquiring a reclaimed agent re-provisions a fresh sandbox; in-flight work is
  recovered via `wake` (FR-013 + harness-wake contract).
- Behind feature flag `LAZY_PROVISIONING`; off → legacy eager boot (FR-017).
- Lifecycle transitions map onto existing `agents.state`
  (`provisioning/ready/busy/idle/retiring/terminated`) and emit `runtime.leased`.
