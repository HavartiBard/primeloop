# Contract: Egress Allowlist + Sandbox Boundary (FR-018, FR-019, FR-021, FR-022)

Per-agent default-deny network egress and scoped filesystem, enforced by the sandbox.

## Allowlist management

```ts
interface EgressAllowlist {
  list(agentId: string): Promise<string[]>
  deriveDefaults(agentId: string): Promise<string[]>   // from capabilities + MCP assignments
  requestHost(agentId: string, host: string): Promise<'allowed' | 'pending_approval'>
}
```

**Rules**
- Default-deny: only `egress_allowlist` rows permit egress (FR-019).
- `deriveDefaults` seeds rows with `source IN ('capability','mcp_assignment')`.
- `requestHost` for an unknown host returns `pending_approval` and routes to the
  existing approval queue (`source='operator'`); never a silent allow (spec Edge Case).

## Sandbox boundary (gVisor-class — R5)

Not a code interface; a provisioning contract enforced by `process-manager` when it
wraps the runtime:

- **Filesystem (FR-018)**: read/write bind-mount limited to the agent's working
  directory. No mount of credential paths or other agents' worktrees. Out-of-scope
  read/write is denied by the sandbox and emits `fs.denied`.
- **Network (FR-019)**: sandbox network namespace with no DNS and no raw outbound TCP;
  all egress flows through the control-plane proxy (`llm-proxy.md`), which applies the
  allowlist. The agent cannot reconfigure this away (FR-021).
- **Strength (FR-022)**: gVisor-class userspace-kernel sandbox is the security
  boundary (semi-trusted baseline). Not microVM. Re-evaluate if untrusted code is
  introduced.
- **Validation**: the SC-007 isolation test asserts out-of-dir write, secret/other-
  workspace read, and non-allowlisted connect all fail and are recorded, while an
  allowlisted op succeeds.
