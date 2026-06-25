# Spec 009: Capability Registry Data Model

**Feature Branch**: `009-mcp-registry`  
**Date**: 2026-06-24  
**Status**: Draft

---

## Overview

This document defines the database schema for the Capability Registry system. The registry stores four core entity types:

1. **Platform Primitives** - Stable ACP-native action contracts
2. **Capability Bundles** - Policy-level permission groupings
3. **Provider Adapters** - Concrete implementations (MCP, HTTP, CLI, etc.)
4. **Capability Profiles** - Role/template-level policy objects

---

## Tables

### `platform_primitives`

Stable ACP-native action contracts with canonical names and metadata.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Canonical primitive name (e.g., `delegate`, `request_approval`) |
| `display_name` | TEXT NOT NULL | Human-readable name for UI |
| `description` | TEXT NOT NULL | What this primitive does |
| `is_prime_only` | BOOLEAN DEFAULT FALSE | If TRUE, only Prime can use this primitive |
| `requires_approval` | BOOLEAN DEFAULT FALSE | If TRUE, requires explicit approval before use |
| `metadata` | JSONB | Additional configuration (e.g., allowed targets for `delegate`) |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() |

**Indexes**:
- `idx_platform_primitives_prime_only` on (`is_prime_only`)
- `idx_platform_primitives_approval` on (`requires_approval`)

---

### `capability_bundles`

Policy-level permission groupings (e.g., `repo.read`, `deploy.staging`).

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Bundle identifier (e.g., `repo.read`, `kb.write`) |
| `display_name` | TEXT NOT NULL | Human-readable name |
| `description` | TEXT NOT NULL | What this bundle permits |
| `risk_level` | TEXT NOT NULL CHECK (`risk_level` IN ('low', 'medium', 'high', 'critical')) | Risk assessment for approval gating |
| `metadata` | JSONB | Bundle-specific config (e.g., allowed scopes) |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() |

**Indexes**:
- `idx_capability_bundles_risk` on (`risk_level`)

---

### `provider_adapters`

Concrete implementations that fulfill capability bundles.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Adapter identifier (e.g., `github-mcp`, `gitlab-cli`) |
| `display_name` | TEXT NOT NULL | Human-readable name |
| `description` | TEXT NOT NULL | What this adapter does |
| `adapter_type` | TEXT NOT NULL CHECK (`adapter_type` IN ('mcp-stdio', 'mcp-http', 'http-api', 'cli', 'sdk')) | Transport mechanism |
| `requires_credentials` | BOOLEAN DEFAULT FALSE | If TRUE, requires credential leasing from broker |
| `credential_needs` | JSONB[] | Array of credential definitions (see spec 010) |
| `health_check_config` | JSONB | Configuration for adapter health monitoring |
| `metadata` | JSONB | Adapter-specific config (e.g., endpoints, command templates) |
| `is_active` | BOOLEAN DEFAULT TRUE | If FALSE, adapter is disabled but not deleted |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() |

**Indexes**:
- `idx_provider_adapters_type` on (`adapter_type`)
- `idx_provider_adapters_credentials` on (`requires_credentials`)

---

### `capability_to_adapter_mappings`

Maps capability bundles to one or more provider adapters.

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL PRIMARY KEY |
| `capability_bundle_id` | TEXT NOT NULL REFERENCES `capability_bundles`(id) ON DELETE CASCADE |
| `provider_adapter_id` | TEXT NOT NULL REFERENCES `provider_adapters`(id) ON DELETE CASCADE |
| `is_default` | BOOLEAN DEFAULT FALSE | If TRUE, this adapter is the default for the capability |
| `priority` | INTEGER DEFAULT 0 | Higher priority adapters are preferred (for failover) |
| `metadata` | JSONB | Mapping-specific config (e.g., scope restrictions) |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() |

**Indexes**:
- `idx_cap_to_adapter_bundle` on (`capability_bundle_id`)
- `idx_cap_to_adapter_adapter` on (`provider_adapter_id`)
- Unique index on (`capability_bundle_id`, `provider_adapter_id`)

---

### `capability_profiles`

Role- or template-level policy objects that define which primitives and bundles may be granted.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | Profile identifier (e.g., `prime.default`, `architect`, `qa-ephemeral`) |
| `display_name` | TEXT NOT NULL | Human-readable name |
| `description` | TEXT NOT NULL | What this profile permits |
| `is_default_for_durable` | BOOLEAN DEFAULT FALSE | If TRUE, applied to new durable agents |
| `is_default_for_ephemeral` | BOOLEAN DEFAULT FALSE | If TRUE, applied to new ephemeral templates |
| `metadata` | JSONB | Profile-specific config (e.g., max concurrent tasks) |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() |

**Indexes**:
- `idx_capability_profiles_durable` on (`is_default_for_durable`)
- `idx_capability_profiles_ephemeral` on (`is_default_for_ephemeral`)

---

### `profile_primitives`

Links capability profiles to platform primitives they may grant.

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL PRIMARY KEY |
| `capability_profile_id` | TEXT NOT NULL REFERENCES `capability_profiles`(id) ON DELETE CASCADE |
| `platform_primitive_id` | TEXT NOT NULL REFERENCES `platform_primitives`(id) ON DELETE CASCADE |
| `is_granted` | BOOLEAN DEFAULT TRUE | If FALSE, explicitly denies this primitive (deny-by-default override) |
| `metadata` | JSONB | Grant-specific config (e.g., allowed targets) |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() |

**Indexes**:
- Unique index on (`capability_profile_id`, `platform_primitive_id`)

---

### `profile_bundles`

Links capability profiles to capability bundles they may grant.

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL PRIMARY KEY |
| `capability_profile_id` | TEXT NOT NULL REFERENCES `capability_profiles`(id) ON DELETE CASCADE |
| `capability_bundle_id` | TEXT NOT NULL REFERENCES `capability_bundles`(id) ON DELETE CASCADE |
| `is_granted` | BOOLEAN DEFAULT TRUE | If FALSE, explicitly denies this bundle |
| `metadata` | JSONB | Grant-specific config (e.g., scope restrictions) |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() |

**Indexes**:
- Unique index on (`capability_profile_id`, `capability_bundle_id`)

---

### `resolved_tool_grants`

Records of per-run resolved tool access (audit trail).

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | UUID for the resolved grant |
| `agent_id` | TEXT NOT NULL | Agent that received this grant |
| `delegation_id` | TEXT NOT NULL | Delegation this grant applies to |
| `work_item_id` | TEXT | Optional work item context |
| `profile_id` | TEXT REFERENCES `capability_profiles`(id) | Source profile for resolution |
| `task_scope` | JSONB | Task-specific narrowing constraints |
| `approval_state` | TEXT NOT NULL CHECK (`approval_state` IN ('unapproved', 'pending', 'approved', 'revoked')) | Approval state at grant time |
| `granted_primitives` | JSONB[] | Array of granted primitive IDs |
| `granted_bundles` | JSONB[] | Array of granted bundle IDs with metadata |
| `selected_adapters` | JSONB[] | Array of selected adapter IDs with metadata |
| `excluded_primitives` | JSONB[] | Array of excluded primitives with reasons |
| `excluded_bundles` | JSONB[] | Array of excluded bundles with reasons |
| `excluded_adapters` | JSONB[] | Array of excluded adapters with reasons |
| `grant_metadata` | JSONB | Additional resolution metadata (timestamp, resolver, etc.) |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() |

**Indexes**:
- `idx_resolved_grants_agent` on (`agent_id`)
- `idx_resolved_grants_delegation` on (`delegation_id`)
- `idx_resolved_grants_work_item` on (`work_item_id`)
- `idx_resolved_grants_approval` on (`approval_state`)

---

### `adapter_health_records`

Health status for each provider adapter (for health-aware selection).

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL PRIMARY KEY |
| `provider_adapter_id` | TEXT NOT NULL REFERENCES `provider_adapters`(id) ON DELETE CASCADE |
| `last_check` | TIMESTAMPTZ NOT NULL | Last health check timestamp |
| `is_healthy` | BOOLEAN NOT NULL | Current health status |
| `health_error` | TEXT | Error message if unhealthy |
| `latency_ms` | INTEGER | Last measured latency |
| `metadata` | JSONB | Health check results and metadata |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ DEFAULT NOW() |

**Indexes**:
- Unique index on (`provider_adapter_id`)
- `idx_adapter_health_healthy` on (`is_healthy`)

---

## Migration Strategy

### Phase A (Initial)

1. Create all tables above
2. Migrate existing data:
   - `capabilities` → `platform_primitives`
   - `mcp_servers` → `provider_adapters`
   - `agent_mcp_assignments` → `capability_to_adapter_mappings`
3. Create default capability profiles for Prime and durable staff

### Phase B (Refinement)

1. Add capability bundles as intermediate layer
2. Update capability profiles to reference bundles instead of raw adapters
3. Implement grant resolution logic

---

## Authentication Model

### Agent Identity Layer (Existing)

Agents authenticate via JWT tokens stored in `agent_tokens` table:

```sql
CREATE TABLE agent_tokens (
  id BIGSERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Authentication flow:**
1. Agent presents token in `Authorization: Bearer <token>` header
2. Server validates token via `authenticateAgentToken(pool, token)`
3. Returns `AgentAuthContext` with agent record and token
4. Agent capabilities determine what primitives/bundles they can request

**Token format:**
- HMAC-SHA256 signed JWT with agent_id claim
- Stored as plaintext in database for validation
- Rotated on agent restart or explicit rotation request

### Credential Broker Layer (Spec 010)

Provider adapters requiring credentials use the credential broker:

**Brokered credentials table:**

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PRIMARY KEY | UUID for credential record |
| `agent_id` | TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE |
| `kind` | TEXT NOT NULL CHECK (`kind` IN ('provider_proxy_token', 'gitea_token', 'named_secret', 'launcher_token')) |
| `scope` | JSONB NOT NULL | Scoped permissions (repos, capabilities, providers) |
| `secret_ref` | TEXT NOT NULL | SHA256 hash of issued token (plaintext never stored) |
| `status` | TEXT NOT NULL CHECK (`status` IN ('active', 'rotating', 'revoked', 'risky')) |
| `auto_rotatable` | BOOLEAN NOT NULL |
| `issued_at` | TIMESTAMPTZ DEFAULT NOW() |
| `expires_at` | TIMESTAMPTZ |
| `rotated_at` | TIMESTAMPTZ |
| `revoked_at` | TIMESTAMPTZ |

**Credential kinds:**
- `provider_proxy_token` - Authorizes calling LLM proxy (FR-008)
- `gitea_token` - Derived/scoped Gitea token (FR-011)
- `named_secret` - Operator-defined secret (FR-011)
- `launcher_token` - Authenticates backend→launcher socket

**Broker guarantees:**
- Short-lived tokens (default 24h TTL for ephemerals, configurable for durables)
- Per-agent scoped credentials (no credential sharing)
- Plaintext returned once via env vars only (never written to disk)
- Auto-rotation for eligible credentials without agent restart
- Synchronous revocation on agent teardown

### Tool Grant Resolution (Spec 009)

**Grant resolution factors:**
1. Agent identity (from `agent_tokens` table)
2. Capability profile (role/template policy)
3. Task scope (explicit constraints)
4. Approval state (pending/approved/revoked)
5. Provider adapter health and availability

**Grant audit trail:**

The `resolved_tool_grants` table records every resolved access:
- Agent ID and delegation/work item context
- Source capability profile
- Task scope constraints
- Approval state at grant time
- Granted primitives, bundles, and adapters
- Excluded items with reasons (approval, deny rules, health, credentials)
- Resolution metadata (timestamp, resolver, etc.)

### Migration Strategy

### Phase A (Initial)

1. Create all tables above
2. Migrate existing data:
   - `capabilities` → `platform_primitives`
   - `mcp_servers` → `provider_adapters`
   - `agent_mcp_assignments` → `capability_to_adapter_mappings`
3. Create default capability profiles for Prime and durable staff
4. Populate `agent_tokens` from existing agent configurations
5. Initialize credential broker with provider proxy tokens

### Phase B (Refinement)

1. Add capability bundles as intermediate layer
2. Update capability profiles to reference bundles instead of raw adapters
3. Implement grant resolution logic
4. Enable credential broker for all provider adapters
5. Audit existing grants against new model

---

## Backward Compatibility

- Existing `capabilities`, `mcp_servers`, and `agent_mcp_assignments` tables remain
- New tables are additive; existing code continues to work
- Migration path: new code reads from new tables, old code continues using legacy tables
