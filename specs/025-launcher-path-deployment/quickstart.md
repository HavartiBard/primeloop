# Quickstart: Runtime Harness Container Isolation — Deploy the Launcher Path

## Goal

Validate that managed local OpenCode agents now run through launcher-managed isolated OpenSandbox runtime containers in the default Docker Compose deployment path.

## Prerequisites

- Docker and Docker Compose available on the host
- A checked-out PrimeLoop repository
- A valid `.env` file for the backend
- Launcher authentication token configured for backend-to-launcher calls (`LAUNCHER_AUTH_SECRET`)
- OpenSandbox service configured and reachable from the launcher
- OpenCode runtime image available to the launcher/OpenSandbox backend
- Any remote ACP transport prerequisite defined by the implementation

## 1. Start the deployment

Bring up the single-host deployment with the launcher and OpenSandbox services enabled alongside the backend and database.

Expected result:
- backend becomes healthy
- launcher becomes healthy
- OpenSandbox becomes healthy
- no managed local agent is yet marked failed because of missing launcher connectivity

## 2. Verify launcher health

Check the operator-visible health surface for the launcher service.

Expected result:
- launcher reports healthy
- OpenSandbox reachability is healthy
- backend can reach launcher
- no launcher-auth error is present

## 3. Create or enable a managed local OpenCode agent

Use the existing agent management flow to create or enable a managed local OpenCode agent.

Expected result:
- backend prepares the worktree
- launcher provisions one persistent isolated OpenSandbox runtime container for that agent
- the runtime boots `opencode serve`
- backend receives a usable remote ACP session endpoint
- agent becomes dispatchable through the launcher-managed path

## 4. Create or enable a second managed local OpenCode agent

Repeat the same validation for a second managed local OpenCode agent.

Expected result:
- launcher provisions one persistent isolated OpenSandbox runtime container for that agent
- runtime is isolated from the first agent runtime
- both agents remain independently healthy and dispatchable

## 5. Verify containment expectations

Inspect deployment/runtime status using the implementation’s verification surfaces.

Confirm:
- each runtime mounts only its assigned worktree plus any explicitly allowed scratch paths
- runtime does not mount backend source
- runtime does not receive direct database credentials
- runtime uses brokered or environment-scoped credentials only
- runtime egress is restricted to the intended allowlist behavior

## 6. Verify restart recovery

Restart the backend while launcher-managed runtimes exist.

Expected result:
- backend reconciles launcher state
- runtime status resolves to reattached, reprovisioned, or explicit unavailable outcome
- remote ACP session continuity or replacement is operationally visible
- no silent loss of in-flight or expected runtime state occurs

## 7. Verify teardown

Disable or delete one managed local agent.

Expected result:
- launcher tears down the runtime container for that agent
- credentials are revoked
- stale runtime status is cleared
- other managed local agent runtimes remain unaffected

## 8. Validate rollback path

Follow the documented rollback procedure for returning to the prior backend-managed local runtime mode if launcher-backed isolation fails.

Expected result:
- operator can restore a safe runtime path
- durable records and worktrees remain intact
- rollback outcome is operationally visible
