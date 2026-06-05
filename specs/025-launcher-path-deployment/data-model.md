# Data Model: Runtime Harness Container Isolation — Deploy the Launcher Path

## Overview

This feature introduces a launcher-managed OpenSandbox runtime layer for managed local OpenCode agents while preserving backend ownership of durable records and worktree lifecycle. The model below focuses on the entities and state transitions that must exist conceptually, regardless of implementation storage details.

## Entities

### 1. Managed Local Agent

Represents an existing PrimeLoop agent that should run through the launcher-managed isolated OpenCode runtime path.

**Key fields**
- `agent_id`
- `runtime_family` (`opencode` remote target)
- `execution_mode` (managed local)
- `enabled`
- `tier` (durable or ephemeral)
- `worktree_path`
- `provider_binding`
- `expected_runtime_mode` (launcher-managed isolated via OpenSandbox)

**Rules**
- Each managed local agent maps to exactly one assigned worktree.
- Each managed local agent maps to at most one active launcher slot/runtime at a time.
- Managed local OpenCode agents default to launcher-managed isolated execution in phase 1.

### 2. Assigned Worktree

Represents the backend-owned writable filesystem scope for one managed local agent.

**Key fields**
- `agent_id`
- `worktree_path`
- `repo_root`
- `workspace_root` (optional effective root)
- `state` (prepared, mounted, reset_required, invalid)
- `last_prepared_at`

**Rules**
- Worktrees are created, reset, and mutated only by the backend.
- The launcher may mount the assigned worktree but may not create or mutate it.
- A worktree may be reused across runtime reprovisioning for the same agent.

### 3. Launcher Slot

Represents the launcher’s durable record of a provisioned OpenSandbox runtime assignment for one managed local agent.

**Key fields**
- `slot_id`
- `agent_id`
- `runtime_family`
- `runtime_image` (OpenCode runtime image)
- `container_identity`
- `session_endpoint`
- `health_status`
- `created_at`
- `updated_at`

**Rules**
- One launcher slot belongs to one agent.
- A slot must expose a session endpoint before the backend marks the runtime dispatchable.
- Slot state is authoritative only for launcher runtime mechanics; backend durable records remain the system source of truth.

### 4. Isolated Runtime Container

Represents the actual OpenSandbox-backed execution environment behind a launcher slot.

**Key fields**
- `agent_id`
- `container_identity`
- `mounts`
- `network_policy`
- `credential_scope`
- `runtime_process_state`
- `health_status`

**Rules**
- One persistent runtime container exists per managed local agent while that agent is active.
- The container mounts only the assigned worktree plus explicitly allowed runtime scratch paths.
- The container never mounts backend source or direct database credentials.

### 5. Runtime Credential Scope

Represents the brokered credentials and runtime-scoped tokens that may enter the isolated runtime.

**Key fields**
- `agent_id`
- `launcher_auth_token`
- `runtime_tokens`
- `provider_proxy_tokens`
- `issued_at`
- `expires_at`
- `revocation_state`

**Rules**
- Raw provider secrets must not be written into worktree files.
- Credentials are short-lived, scoped to runtime use, and revocable at teardown.
- Credential scope is re-issued or refreshed during reprovisioning as needed.

### 6. Runtime Recovery Outcome

Represents the backend’s durable record of what happened when reconciling runtime state after restart or failure.

**Key fields**
- `agent_id`
- `trigger` (backend restart, runtime exit, health failure, teardown)
- `observed_slot_state`
- `resolution` (reattached, reprovisioned, unavailable, cleaned_up)
- `reason`
- `recorded_at`

**Rules**
- Recovery outcomes must be explicitly recorded; silent loss is not allowed.
- Recovery decisions are made from backend durable state plus launcher inspection, not from transient in-memory assumptions.

## Relationships

- **Managed Local Agent 1:1 Assigned Worktree**
- **Managed Local Agent 1:0..1 Launcher Slot**
- **Launcher Slot 1:1 Isolated Runtime Container**
- **Managed Local Agent 1:many Runtime Recovery Outcomes**
- **Isolated Runtime Container 1:1 Runtime Credential Scope** during active execution windows

## State Transitions

### Managed Local Agent Runtime Lifecycle

1. `unprovisioned`
2. `provisioning`
3. `ready`
4. `dispatching`
5. `unhealthy`
6. `reprovisioning`
7. `tearing_down`
8. `stopped` or `unavailable`

**Transition notes**
- `unprovisioned -> provisioning`: backend requests launcher provisioning for an enabled managed local agent.
- `provisioning -> ready`: launcher reports healthy runtime and usable session endpoint.
- `ready -> dispatching`: harness sends work through the session endpoint.
- `dispatching -> ready`: task finishes and runtime remains healthy.
- `ready/dispatching -> unhealthy`: launcher or backend health check detects failure.
- `unhealthy -> reprovisioning`: backend/launcher attempts recovery.
- `reprovisioning -> ready`: replacement runtime becomes healthy.
- `reprovisioning -> unavailable`: recovery fails and explicit outcome is recorded.
- `ready/unhealthy -> tearing_down`: agent disable/delete or controlled stop.
- `tearing_down -> stopped`: runtime resources are removed and credentials revoked.

## Validation Rules

- A managed local OpenCode agent cannot be marked launcher-ready without a valid ACP session endpoint.
- A runtime cannot be considered compliant unless its mounts are limited to the assigned worktree and explicitly allowed scratch paths.
- A runtime cannot be considered compliant unless its network policy is default-deny with explicit allowlisting.
- Recovery handling must emit a recorded outcome whenever reattach or reprovisioning does not succeed.
