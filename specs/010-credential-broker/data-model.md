# Spec 010: Credential Broker Data Model

**Feature Branch**: `010-credential-broker`  
**Date**: 2026-06-24  
**Status**: Draft

---

## Overview

The `brokered_credentials` table stores short-lived, per-agent credentials with SHA256-hashed plaintext. The broker issues credentials at agent spawn, rotates them for durable agents, and revokes them on teardown.

---

## Table: `brokered_credentials`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID for credential record |
| `agent_id` | UUID | NOT NULL REFERENCES `agents`(id) ON DELETE CASCADE | Agent that owns this credential |
| `kind` | TEXT | NOT NULL CHECK (`kind` IN ('provider_proxy_token', 'gitea_token', 'named_secret', 'launcher_token')) | Credential type |
| `scope` | JSONB | NOT NULL | Scoped permissions (repos, capabilities, providers) |
| `secret_ref` | TEXT | NOT NULL | SHA256 hash of issued token (plaintext never stored) |
| `status` | TEXT | NOT NULL CHECK (`status` IN ('active', 'rotating', 'revoked', 'risky')) | Current status |
| `auto_rotatable` | BOOLEAN | NOT NULL | If TRUE, broker auto-rotates before expiry |
| `issued_at` | TIMESTAMPTZ | DEFAULT NOW() | Credential issuance time |
| `expires_at` | TIMESTAMPTZ | | Expiry timestamp (nullable for named secrets) |
| `rotated_at` | TIMESTAMPTZ | | Last rotation timestamp |
| `revoked_at` | TIMESTAMPTZ | | Revocation timestamp |

**Indexes**:
- `idx_brokered_credentials_agent_status` on (`agent_id`, `status`)
- `idx_brokered_credentials_expires` on (`expires_at`) WHERE `expires_at` IS NOT NULL AND `status` = 'active'

---

## Migration

```sql
CREATE TABLE brokered_credentials (
  id TEXT PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('provider_proxy_token', 'gitea_token', 'named_secret', 'launcher_token')),
  scope JSONB NOT NULL,
  secret_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'rotating', 'revoked', 'risky')),
  auto_rotatable BOOLEAN NOT NULL,
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_brokered_credentials_agent_status ON brokered_credentials (agent_id, status);
CREATE INDEX idx_brokered_credentials_expires ON brokered_credentials (expires_at)
  WHERE expires_at IS NOT NULL AND status = 'active';
```

---

## Backward Compatibility

- Existing `agent_tokens` table remains unchanged
- Brokered credentials are additive; legacy paths continue to work
- Feature flag `CREDENTIAL_BROKER` gates broker usage
