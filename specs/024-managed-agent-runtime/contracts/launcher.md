# Contract: Runtime-Container Launcher + Transport (FR-023, FR-025; supports US1/US3/US5)

The launcher is the runtime container's process manager **and** the cross-container
transport bridge. It lets the primary container's harness drive agents that run in a
separate container, while preserving ACP semantics end-to-end.

## Transport decision

- **Protocol**: ACP (JSON-RPC 2.0) — unchanged from today; only the stream moves.
- **Stream**: **TCP** on the **private compose network** (reachable only by the primary
  container, never published to the host/internet). Chosen over a unix socket because
  that would require a shared volume across containers; TCP needs none.
- **Auth**: the backend presents a **launcher bearer token** on connect (provisioned by
  the setup script / broker, rotated like other brokered credentials). The launcher
  rejects unauthenticated or wrong-token connections. **mTLS** on the private network is
  an optional hardening, not required for the single-host baseline.
- **Direction/roles**: the launcher **listens**; the backend **connects out**. Over the
  connection the backend is the ACP *client* (holds user/permission authority) and the
  spawned agent is the ACP *agent*; the launcher relays ACP frames between them.

## Launcher control surface (process lifecycle)

ACP's own `session/*` methods remain the work API (see `harness-wake.md`). The launcher
adds a thin control surface for what ACP does not cover — *which* runtime to start and
*how* to isolate it:

```ts
interface RuntimeLauncher {
  // Provision a UID-isolated agent slot, then hand back an ACP-speaking stream.
  startAgent(req: {
    runtimeFamily: 'pi' | 'acp' | 'opencode' | 'generic-http'
    agentId: string
    workdir: string                 // created + Landlock-scoped inside the runtime container
    env: Record<string, string>     // includes the per-agent scoped proxy token (never raw keys)
    egressAllowlist: string[]
  }): Promise<{ sessionEndpoint: string; uid: number }>

  stopAgent(agentId: string): Promise<void>   // kill the UID-isolated process, reclaim the slot
  health(): Promise<{ ok: boolean; runtimes: string[]; activeAgents: number }>
}
```

- `startAgent` spawns the real agent process at a distinct UID with Landlock + seccomp +
  per-UID default-deny egress (FR-025), injects `env` (scoped token only), and returns
  the ACP session endpoint the backend's `AcpClient` then drives.
- The backend's `RuntimeLease` (see `runtime-lease.md`) maps 1:1 onto `startAgent` /
  `stopAgent`; reclaiming an idle agent = `stopAgent`; an empty runtime container may be
  stopped entirely.

## Filesystem handling (relocation)

- The agent accesses its workspace **locally** in the runtime container (Landlock-scoped
  to `workdir`). The ACP client-side fs methods (`fs/read_text_file`,
  `fs/write_text_file`) are served by the **launcher** against that workspace, **not** by
  the backend. `backend/src/acp/fs-handler.ts` is no longer in the agent's fs path for
  remote runtimes — reinforcing the secret boundary (the backend never reads/writes on
  the agent's behalf).

## Non-ACP (HTTP) fallback

- For `runtime_family` = `opencode` / `generic-http`, the launcher starts the runtime's
  HTTP server (e.g., `opencode serve`) at a distinct UID; the backend's existing
  `AgentAdapter` connects over **HTTP** to the runtime container's host:port on the
  private network, using the same launcher token and isolation. ACP features
  (`session/load`, permissions) are unavailable on this path, so such runtimes use the
  checkpoint re-dispatch recovery fallback (FR-003).

## Failure & recovery

- On `session/cancel`, connection loss, or `stopAgent`, the launcher kills the agent
  process and frees the slot.
- A runtime-container restart kills all its agents at once (correlated failure); recovery
  is the US1 path — the backend `wake`s durable-staff sessions (`session/load`) or
  re-dispatches ephemerals from the last continuation. The launcher holds **no**
  authoritative state; the durable log remains the source of truth (Principle VI).

## Network/egress note

- Intra-compose traffic — backend → launcher, and agent → control-plane proxy — is
  **permitted**; default-deny egress (FR-019) governs **internet** destinations only.
- Every `startAgent`/`stopAgent` and auth rejection emits a `runtime_events` row
  (`runtime.leased`/`runtime.reclaimed`/`launcher.auth_denied`) for audit (FR-015).
