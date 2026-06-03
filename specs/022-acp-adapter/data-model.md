# Phase 1 Data Model: ACP Adapter Standardization

This feature is integration-layer; most state reuses existing tables. New/changed data is minimal and
single-tenant.

## Entities

### AcpSession (in-memory, correlated to durable records)

A live conversation with a spawned ACP agent. Not a new source of truth — correlated to existing
durable records.

| Field | Type | Notes |
|---|---|---|
| `sessionId` | string | From ACP `session/new` response (agent-assigned) |
| `agentId` | string | Registry agent id (FK → `agents.id`) |
| `delegationId` | string? | From dispatch prompt metadata (correlation) |
| `workItemId` | string? | From dispatch prompt metadata (correlation) |
| `cwd` | string | Sandbox root passed to `session/new` (worktree/workspace) |
| `state` | enum | `initializing` → `working` → `terminal` (`completed`/`failed`/`cancelled`) |
| `pid` | number | Subprocess pid, for reaping |

Lifecycle transitions:
`initializing` --(initialize ok)--> `working` --(stopReason end_turn)--> `terminal:completed`
`working` --(session/cancel)--> `terminal:cancelled`
`* ` --(crash / malformed / negotiation fail)--> `terminal:failed`

Persistence: lifecycle is surfaced through existing `runtime_events` (event_type
`agent.lifecycle.transition` and ACP-specific session events) and the `HarnessEvent` stream;
no dedicated sessions table in v1 (see research D7).

### PermissionPolicy (configuration)

Configurable classifier deciding auto-resolve vs gate for `session/request_permission`.

| Field | Type | Notes |
|---|---|---|
| `lowRiskTools` | string[] | Tool names/patterns auto-resolved (e.g., in-sandbox reads) |
| `sensitivePatterns` | rule[] | Out-of-sandbox writes, network, destructive ops → gate |
| `default` | enum | `gate` (treat-as-sensitive when uncertain — required default) |
| `timeoutMs` | number | Unanswered sensitive request → deny on expiry (fail-safe) |

Persistence: stored in existing per-agent config (`agents.config`) and/or
`agent_runtime_configs.tool_grant_defaults` / capability-profile `approval_rules`. No new table
required if these suffice; a single migration adds a typed column only if needed.

### PermissionRequest (maps to existing approval queue)

An agent-initiated authorization request. Sensitive ones become approval-queue items; low-risk ones
are auto-resolved and never persisted as approvals.

| Field | Type | Notes |
|---|---|---|
| `sessionId` | string | ACP session correlation |
| `toolCall` | object | `{ id, name, input }` from ACP request |
| `options` | AcpOption[] | `{ optionId, name, kind }` (allow_once/allow_always/reject_once/reject_always) |
| `classification` | enum | `low_risk` \| `sensitive` |
| `decision` | enum | `allow_once` \| `reject_once` \| `cancelled` (mapped to an `optionId`) |
| `approvalItemId` | string? | FK to existing approval-queue record (sensitive only) |

### AgentRegistration (extended existing `agents` row)

Reuses `RegistryAgent` (`registry.ts`). Relevant fields:

| Field | Type | Change |
|---|---|---|
| `runtime_family` | string | New value `acp` selects `AcpHarness` |
| `config` | jsonb | Adds ACP launch command/args/env + permission policy overrides |
| `capabilities` | string[] | **Reconciled** from negotiated `agentCapabilities` after `initialize` (hint for routing; runtime negotiation is authoritative) |
| `worktree_path` / `workspace_root` | string | Sandbox root → `cwd` and `fs/*` confinement |

## Relationships

- `AcpSession.agentId` → `agents.id`
- `AcpSession.delegationId` → `delegations.id` (existing)
- `AcpSession.workItemId` → `work_items.id` (existing)
- `PermissionRequest.approvalItemId` → existing approval-queue record (spec 008)
- `PermissionPolicy` resolved per-agent from `agents.config` (+ capability-profile defaults)

## Validation Rules

- `fs/*` `path` MUST resolve inside the agent's sandbox root; otherwise reject (FR-007).
- Permission classification defaults to `gate` when not confidently low-risk (FR-005).
- Unanswered sensitive request resolves to deny after `timeoutMs` (FR-006a).
- Work MUST NOT be dispatched against a capability absent from negotiated `agentCapabilities` (FR-013).
- ACP requires absolute paths and 1-based line numbers — enforce when constructing `fs` results.
