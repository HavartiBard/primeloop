# Feature Specification: Credential Broker

**Feature Branch**: `010-credential-broker`

**Created**: 2026-05-21

**Status**: Draft

**Depends on**: 002 (agent lifecycle + sandbox)

## Summary

Issues short-lived, per-agent, scoped credentials at spawn time and revokes them on teardown. Prevents credential sprawl in the shared harness environment: no agent holds a long-lived secret directly; all secrets are brokered tokens valid for the agent's lifespan. The broker also handles credential rotation for durable agents without restarting them. Supports at minimum: API keys (LLM providers), Gitea tokens, and operator-defined named secrets. Secret values are never written to the worktree or workdir; they are injected as environment variables at process start.

## Key Decisions (Do Not Re-Open Without Amending the Constitution)

- **Brokered tokens only**: No agent receives long-lived secrets directly; all credentials pass through the broker
- **Env-only injection**: Plaintext credentials returned once via environment variables; never written to files, worktrees, or configs
- **Short-lived by default**: Ephemeral agents get 24h TTL; durable agents configurable but bounded
- **Auto-rotation**: Rotatable credentials automatically refreshed before expiry; non-rotatable flagged as risky
- **Scoped permissions**: Gitea tokens derived with minimal repo/capability scopes (least privilege)
- **Synchronous revocation**: Credentials revoked at teardown; no grace period for ephemerals
- **Hashed storage**: Only SHA256 hash of plaintext stored in DB; plaintext never persisted
- **Fallback safety**: If upstream (Gitea) unavailable, broker issues random tokens to maintain functionality

## User Scenarios & Testing

### User Story 1 - Spawn with brokered credentials (Priority: P1)

When an agent spawns, it receives only the credentials it needs, scoped to its task, and never holds long-lived secrets.

**Why this priority**: Credential sprawl is a primary security risk; every long-lived secret increases attack surface.

**Independent Test**: Provision an agent → scan worktree/workdir/config for secret values (none found) → verify brokered credentials injected via env vars only.

**Acceptance Scenarios**:

1. **Given** an agent with Gitea and LLM proxy access, **When** it spawns, **Then** it receives `GITEA_TOKEN` and `LLM_PROXY_TOKEN` env vars with short-lived values
2. **Given** an agent's credentials are brokered, **When** its worktree is scanned for secret strings, **Then** no plaintext secrets appear (only random tokens)
3. **Given** a brokered credential expires, **When** the sweep job runs, **Then** rotatable credentials rotate, non-rotatable flag as `risky`

---

### User Story 2 - Durable agents rotate credentials without restart (Priority: P2)

A durable agent's credentials rotate automatically within ≤24h without requiring a restart or identity change.

**Why this priority**: Long-lived credentials increase breach risk; rotation without restart maintains agent stability.

**Independent Test**: Start a durable agent → wait ≤24h → verify `credential.rotated` event emitted → verify new env var value active without restart.

**Acceptance Scenarios**:

1. **Given** a durable agent with rotatable credentials, **When** 24h passes since issuance, **Then** the broker rotates the credential and emits `credential.rotated`
2. **Given** a rotated credential, **When** the agent's next operation requires it, **Then** it uses the new value without restart
3. **Given** a non-rotatable credential expires, **When** the sweep runs, **Then** it flags as `risky` and emits `credential.risk_flagged`

---

### User Story 3 - Teardown revokes all credentials (Priority: P1)

When an agent tears down, all its brokered credentials are synchronously revoked and rejected for reuse.

**Why this priority**: Revoked credentials must not be usable; asynchronous revocation creates a window for abuse.

**Independent Test**: Start an agent → note its credential IDs → tear it down immediately → attempt to validate each credential (all rejected).

**Acceptance Scenarios**:

1. **Given** an ephemeral agent tears down, **When** teardown completes, **Then** all its brokered credentials have `status = 'revoked'`
2. **Given** a revoked credential, **When** the broker validates it, **Then** validation returns `null` (not found)
3. **Given** a durable agent's credentials are revoked, **When** the sweep runs, **Then** no further rotation occurs for those credentials

---

### User Story 4 - Gitea tokens are scoped (Priority: P2)

Gitea tokens issued by the broker include minimal repo and capability scopes derived from agent permissions.

**Why this priority**: Overly broad Gitea tokens violate least privilege; scoped tokens limit blast radius of compromise.

**Independent Test**: Provision an agent with `repo.read` capability → verify Gitea token has only `repository` scope (no `write:repository` or `admin:org`).

**Acceptance Scenarios**:

1. **Given** an agent needs `repo.read` and `issue` capabilities, **When** the broker issues a Gitea token, **Then** it requests scopes `['repository', 'issue']`
2. **Given** a Gitea token with capability scopes, **When** the agent attempts a write operation, **Then** Gitea rejects it (scope mismatch)
3. **Given** Gitea is unavailable, **When** the broker issues a token, **Then** it falls back to a random token (not a real Gitea token)

---

### User Story 5 - Proxy token authorizes LLM calls (Priority: P1)

The control-plane proxy validates brokered proxy tokens before forwarding LLM requests to providers.

**Why this priority**: Raw provider keys must never leave the proxy; brokered tokens enforce this boundary.

**Independent Test**: Start an agent → attempt direct-to-provider call (blocked) → verify all LLM traffic routes through proxy with valid `LLM_PROXY_TOKEN`.

**Acceptance Scenarios**:

1. **Given** an agent's runtime config, **When** it attempts a direct provider API call, **Then** the call is blocked (egress deny)
2. **Given** an agent makes an LLM call, **When** the proxy receives it, **Then** it validates `LLM_PROXY_TOKEN` against broker before forwarding
3. **Given** an invalid proxy token, **When** the proxy receives it, **Then** it returns 401 Unauthorized

---

## Requirements

### FR-001: Broker must issue credentials at agent spawn time
The broker MUST accept an `AgentScope` describing required credentials and return an array of `IssuedCredential` objects with env var names and plaintext values.

### FR-002: Plaintext must never be written to disk
The broker MUST return plaintext credentials only via environment variable injection; they MUST NOT appear in config files, worktrees, or persistent storage.

### FR-003: Credentials must have bounded TTL
Each credential MUST include an `expiresAt` timestamp; ephemeral agents MUST default to ≤24h TTL.

### FR-004: Broker must maintain a registry of provider adapters describing transport type, lifecycle behavior, required credentials, and capability mappings
The broker MUST track which credentials each adapter requires and reject grants if credentials are unavailable.

### FR-005: Broker must support auto-rotation for rotatable credentials
The broker MUST provide a `rotate()` method and a scheduled sweep job that rotates expired rotatable credentials before expiry.

### FR-006: Broker must flag non-rotatable expired credentials as risky
The broker MUST set `status = 'risky'` for non-rotatable credentials past their expiry and emit `credential.risk_flagged` events.

### FR-007: Broker must revoke all credentials on agent teardown
The broker MUST provide `revokeAllForAgent()` that synchronously sets `status = 'revoked'` for all active credentials of an agent.

### FR-008: Broker must hash plaintext tokens before storage
The broker MUST store only the SHA256 hash of each credential's plaintext (`secret_ref`) and never persist the raw token.

### FR-009: Broker must support named secrets for operator-defined values
The broker MUST accept `NamedSecretSpec` entries in `AgentScope` and inject them as env vars without rotation (non-rotatable).

### FR-010: Broker must rotate Gitea tokens via scoped API calls
The broker MUST call the Gitea API to create tokens with minimal scopes (`repository`, `issue`, `write:repository`) based on agent capabilities.

### FR-011: Broker must emit runtime events for credential lifecycle
The broker MUST emit `credential.issued`, `credential.rotated`, `credential.revoked`, and `credential.risk_flagged` events for observability.

### FR-012: Broker must validate tokens for proxy/auth paths
The broker MUST provide a `validate(token)` method that returns the credential record iff active, unexpired, and not revoked.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of agents receive brokered credentials at spawn; zero long-lived secrets in runtime configs
- **SC-002**: 100% of credential plaintext is env-only; zero plaintext written to worktree, config files, or logs
- **SC-003**: Credential rotation completes for ≥95% of rotatable credentials within 2h of expiry
- **SC-004**: Teardown revokes all credentials synchronously (≤1s from agent termination to DB update)
- **SC-005**: Gitea tokens include ≤2 scopes per agent (repo + optional issue/write)

## Assumptions

- Master secrets are stored encrypted in the ACP DB (using existing `SECRET_ENCRYPTION_KEY` pattern)
- Per-agent tokens are derived/scoped, not copies of master secrets where the upstream supports scoping
- Revocation is synchronous with agent teardown (no grace period for ephemerals)
- Gitea API is available when configured; broker falls back to random tokens if unavailable
- The control-plane proxy validates brokered proxy tokens before forwarding LLM requests

## Data Model

See `data-model.md` for full database schema. Key table:

| Table | Purpose |
|-------|---------|
| `brokered_credentials` | Stores credential records with SHA256-hashed secrets |

### Fields

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | UUID for credential record |
| `agent_id` | UUID NOT NULL | Agent that owns this credential |
| `kind` | TEXT NOT NULL | `provider_proxy_token`, `gitea_token`, `named_secret`, `launcher_token` |
| `scope` | JSONB NOT NULL | Scoped permissions (repos, capabilities, providers) |
| `secret_ref` | TEXT NOT NULL | SHA256 hash of issued token (plaintext never stored) |
| `status` | TEXT NOT NULL | `active`, `rotating`, `revoked`, `risky` |
| `auto_rotatable` | BOOLEAN NOT NULL | If TRUE, broker auto-rotates before expiry |
| `issued_at` | TIMESTAMPTZ DEFAULT NOW() | Credential issuance time |
| `expires_at` | TIMESTAMPTZ | Expiry timestamp (nullable for named secrets) |
| `rotated_at` | TIMESTAMPTZ | Last rotation timestamp |
| `revoked_at` | TIMESTAMPTZ | Revocation timestamp |

## API Contracts

See `contracts/credential-broker.md` for full contract definitions.

### Methods

| Method | Description |
|--------|-------------|
| `issueForAgent(agentId, scope)` | Issue all credentials for an agent at spawn |
| `rotate(credentialId)` | Rotate a single auto-rotatable credential |
| `revoke(credentialId)` | Revoke a single credential |
| `revokeAllForAgent(agentId)` | Revoke all credentials for an agent |
| `validate(token)` | Validate a token and return credential record if active/unexpired |
| `sweep()` | Periodic sweep: rotate expired rotatable, flag non-rotatable as risky |

## Observability

| Event Type | Description |
|------------|-------------|
| `credential.issued` | Emitted when a new credential is issued |
| `credential.rotated` | Emitted when a credential is auto-rotated |
| `credential.revoked` | Emitted when a credential is revoked |
| `credential.risk_flagged` | Emitted when a non-rotatable credential expires |

## Implementation Plan

See `plan.md` for detailed implementation phases and tasks.

### Phase A: Core Broker (Week 1)
- Implement `CredentialBroker` class with all methods
- Add `brokered_credentials` table migration
- Wire broker into agent spawn/teardown paths

### Phase B: Gitea Integration (Week 2)
- Implement scoped token issuance via Gitea API
- Add fallback to random tokens if Gitea unavailable
- Test with real Gitea instance

### Phase C: Proxy Token Validation (Week 3)
- Update control-plane proxy to validate brokered tokens
- Remove raw provider key handling from proxy
- Add token validation metrics

### Phase D: Sweep Job (Week 4)
- Implement scheduled rotation sweep (≤24h TTL)
- Add risky credential flagging for non-rotatable expired credentials
- Add observability hooks

### Phase E: Testing & Validation (Week 5)
- Integration tests for all user stories
- Security audit: verify no plaintext leakage
- Performance tests: broker latency under load

## Backward Compatibility

- Existing `agent_tokens` table remains; new brokered credentials are additive
- Legacy credential paths remain until all agents use broker
- Feature flag `CREDENTIAL_BROKER` gates broker usage
