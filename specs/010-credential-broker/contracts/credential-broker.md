# Spec 010: Credential Broker API Contracts

**Feature Branch**: `010-credential-broker`  
**Date**: 2026-06-24  
**Status**: Draft

---

## Overview

The credential broker is a service that issues short-lived, per-agent, scoped credentials. It is invoked by the harness/runtime at agent spawn and teardown.

---

## Methods

### `issueForAgent(agentId: string, scope: AgentScope): Promise<IssuedCredential[]>`

Issue all credentials for an agent at spawn time.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `agentId` | string | UUID of the agent |
| `scope` | AgentScope | Credential requirements (provider IDs, capabilities, named secrets) |

**Returns**: Array of issued credentials with env var names and plaintext values

**AgentScope**:
```typescript
interface AgentScope {
  namedSecrets?: NamedSecretSpec[];        // Operator-defined secrets
  giteaTokens?: GiteaTokenSpec[];          // Gitea tokens with scopes
  controlPlaneTokenEnvName?: string;       // Env var name for launcher token
  providerIds?: string[];                  // Allowed provider IDs
  providerTypes?: string[];                // Allowed provider types
}
```

**NamedSecretSpec**:
```typescript
interface NamedSecretSpec {
  envName: string;   // Environment variable name
  value: string;     // Secret value (plaintext)
}
```

**GiteaTokenSpec**:
```typescript
interface GiteaTokenSpec {
  envName?: string;    // Environment variable name (optional, defaults to 'GITEA_TOKEN')
  repos?: string[];    // Allowed repository names
  capabilities?: string[]; // Required capabilities: 'read', 'write', 'issue', 'admin'
}
```

**IssuedCredential**:
```typescript
interface IssuedCredential {
  id: string;                        // Credential record ID
  kind: CredentialKind;              // 'provider_proxy_token' | 'gitea_token' | 'named_secret' | 'launcher_token'
  envVars: Record<string, string>;   // Env var name → plaintext value (injected at spawn)
  expiresAt: string;                 // ISO timestamp of expiry
  autoRotatable: boolean;            // If TRUE, broker auto-rotates before expiry
}
```

---

### `rotate(credentialId: string): Promise<IssuedCredential>`

Rotate a single auto-rotatable credential.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `credentialId` | string | ID of credential to rotate |

**Returns**: New issued credential with updated expiry

**Errors**:
- `credential {id} not found` - Credential doesn't exist
- `credential {id} is not auto-rotatable` - Credential has `auto_rotatable = false`

---

### `revoke(credentialId: string): Promise<void>`

Revoke a single credential.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `credentialId` | string | ID of credential to revoke |

**Errors**:
- No error if credential already revoked (idempotent)

---

### `revokeAllForAgent(agentId: string): Promise<void>`

Revoke all credentials for an agent.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `agentId` | string | UUID of agent |

**Behavior**:
- Sets `status = 'revoked'` for all active credentials
- Emits `credential.revoked` event for each credential

---

### `validate(token: string): Promise<CredentialRecord | null>`

Validate a token and return credential record if active/unexpired.

**Parameters**:
| Name | Type | Description |
|------|------|-------------|
| `token` | string | Plaintext token to validate |

**Returns**: Credential record if valid, `null` otherwise

**CredentialRecord**:
```typescript
interface CredentialRecord {
  id: string;
  agent_id: string;
  kind: CredentialKind;
  scope: Record<string, unknown>;
  secret_ref: string;
  status: 'active' | 'rotating' | 'revoked' | 'risky';
  auto_rotatable: boolean;
  issued_at: string;
  expires_at?: string;
  rotated_at?: string;
  revoked_at?: string;
}
```

**Validation Logic**:
1. Hash token with SHA256
2. Query `brokered_credentials` where `secret_ref = hash AND status = 'active' AND (expires_at IS NULL OR expires_at > now())`
3. Return record if found, `null` otherwise

---

### `sweep(): Promise<{ rotated: string[]; flagged: string[] }>`

Periodic sweep to rotate expired rotatable credentials and flag non-rotatable ones.

**Returns**:
| Field | Type | Description |
|-------|------|-------------|
| `rotated` | string[] | IDs of rotated credentials |
| `flagged` | string[] | IDs of flagged (non-rotatable expired) credentials |

**Behavior**:
1. Query all active credentials with `expires_at < now()`
2. For each:
   - If `auto_rotatable`: call `rotate()` and add to `rotated` list
   - If NOT `auto_rotatable`: call `flagRisky()` and add to `flagged` list

**flagRisky(credentialId)**:
- Sets `status = 'risky'`
- Emits `credential.risk_flagged` event with reason `'expired_and_not_auto_rotatable'`

---

## Runtime Events

| Event Type | Payload |
|------------|---------|
| `credential.issued` | `{ agent_id: string, credential_id: string, kind: CredentialKind }` |
| `credential.rotated` | `{ agent_id: string, credential_id: string, kind: CredentialKind }` |
| `credential.revoked` | `{ agent_id: string, credential_id: string, kind: CredentialKind }` |
| `credential.risk_flagged` | `{ agent_id: string, credential_id: string, kind: CredentialKind, reason: string }` |

---

## Gitea Token Scopes

| Capability | Gitea Scope(s) |
|------------|----------------|
| `read` | `repository` |
| `write` | `repository`, `write:repository` |
| `issue` | `issue` |
| `admin` | `repository`, `write:repository`, `admin:org` |

**Default**: If no capabilities specified, uses `['repository']`

---

## Integration Points

### At Agent Spawn (Harness)

```typescript
const broker = new CredentialBroker(pool);
const credentials = await broker.issueForAgent(agentId, {
  providerIds: ['openai', 'anthropic'],
  providerTypes: ['llm'],
  giteaTokens: [{
    repos: ['primeloop/agent-control-plane'],
    capabilities: ['read', 'issue']
  }],
  controlPlaneTokenEnvName: 'LAUNCHER_TOKEN',
});
```

### At Agent Teardown (Harness)

```typescript
await broker.revokeAllForAgent(agentId);
```

### Proxy Token Validation

```typescript
const credential = await broker.validate(proxyToken);
if (!credential) {
  return res.status(401).json({ error: 'invalid_token' });
}
// Forward request to provider
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `credential_not_found` | Credential ID doesn't exist |
| `not_auto_rotatable` | Credential has `auto_rotatable = false` |
| `expired_and_not_auto_rotatable` | Credential expired and cannot auto-rotate |
