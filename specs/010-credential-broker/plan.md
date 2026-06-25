# Spec 010: Credential Broker Implementation Plan

**Feature Branch**: `010-credential-broker`  
**Date**: 2026-06-24  
**Status**: Draft

---

## Overview

This plan outlines the implementation phases for the Credential Broker system, which issues short-lived, per-agent, scoped credentials at spawn time and revokes them on teardown.

---

## Phases

### Phase A: Core Broker (Week 1)

**Goal**: Implement `CredentialBroker` class with all methods and wire into agent lifecycle.

#### Tasks

1. **Database Schema** (`backend/src/db.ts`)
   - [ ] Create `brokered_credentials` table per data-model.md
   - [ ] Add indexes on `(agent_id, status)` and `(expires_at)` for sweep

2. **Broker Implementation** (`backend/src/credentials/broker.ts`)
   - [ ] Implement `issueForAgent()` method
   - [ ] Implement `rotate()` method
   - [ ] Implement `revoke()` method
   - [ ] Implement `revokeAllForAgent()` method
   - [ ] Implement `validate()` method
   - [ ] Implement `sweep()` method

3. **Agent Lifecycle Integration**
   - [ ] Wire broker into harness spawn path (`issueForAgent()`)
   - [ ] Wire broker into harness teardown path (`revokeAllForAgent()`)
   - [ ] Inject brokered env vars at agent spawn
   - [ ] Remove all secret/key writes from config files

4. **Tests**
   - [ ] Unit tests for `issueForAgent()` (all credential kinds)
   - [ ] Unit tests for `rotate()` (success and error cases)
   - [ ] Unit tests for `revoke()` and `revokeAllForAgent()`
   - [ ] Unit tests for `validate()` (active, expired, revoked)
   - [ ] Integration tests for agent spawn/teardown

---

### Phase B: Gitea Integration (Week 2)

**Goal**: Implement scoped Gitea token issuance with fallback.

#### Tasks

1. **Gitea Token Issuance**
   - [ ] Implement `issueGiteaToken()` with API call to Gitea
   - [ ] Map capabilities to scopes (`read`→`repository`, `write`→`write:repository`, etc.)
   - [ ] Add fallback to random token if Gitea unavailable

2. **Scope Validation**
   - [ ] Validate repos and capabilities in `GiteaTokenSpec`
   - [ ] Reject invalid scope combinations

3. **Tests**
   - [ ] Unit tests for scope mapping
   - [ ] Integration tests with real Gitea instance
   - [ ] Fallback tests when Gitea unavailable

---

### Phase C: Proxy Token Validation (Week 3)

**Goal**: Update control-plane proxy to validate brokered tokens.

#### Tasks

1. **Proxy Token Validation**
   - [ ] Add `broker.validate()` call in proxy handler
   - [ ] Return 401 for invalid/revoked/expired tokens
   - [ ] Forward valid tokens to provider

2. **Remove Raw Keys**
   - [ ] Remove direct provider key handling from proxy
   - [ ] Verify all LLM traffic routes through brokered tokens

3. **Tests**
   - [ ] Integration tests for token validation
   - [ ] Security audit: verify no plaintext leakage

---

### Phase D: Sweep Job (Week 4)

**Goal**: Implement scheduled rotation sweep.

#### Tasks

1. **Sweep Implementation**
   - [ ] Add `node-cron` job to run sweep hourly
   - [ ] Query expired credentials and rotate/flag as appropriate
   - [ ] Emit `credential.risk_flagged` events

2. **Configuration**
   - [ ] Add `CREDENTIAL_BROKER_TTL_HOURS` env var (default: 24)
   - [ ] Add `SWEEP_INTERVAL_HOURS` env var (default: 1)

3. **Tests**
   - [ ] Unit tests for sweep logic
   - [ ] Integration tests with expired credentials

---

### Phase E: Testing & Validation (Week 5)

**Goal**: Complete all user story tests and security audit.

#### Tasks

1. **User Story Tests**
   - [ ] US1: Spawn with brokered credentials (no plaintext on disk)
   - [ ] US2: Durable agents rotate credentials without restart
   - [ ] US3: Teardown revokes all credentials synchronously
   - [ ] US4: Gitea tokens are scoped correctly
   - [ ] US5: Proxy validates brokered tokens

2. **Security Audit**
   - [ ] Verify no plaintext in worktree/config files
   - [ ] Verify no plaintext in logs
   - [ ] Verify revocation is synchronous

3. **Performance Tests**
   - [ ] Broker latency under load (p95 < 100ms)
   - [ ] Sweep job impact on DB (no blocking)

---

## Acceptance Criteria

- [ ] All database tables created with correct schema
- [ ] All broker methods implemented and tested
- [ ] Agent spawn/teardown integrated with broker
- [ ] Gitea token issuance with fallback works
- [ ] Proxy validates brokered tokens
- [ ] Sweep job rotates/expired credentials
- [ ] All user story tests pass
- [ ] Security audit complete

---

## Rollback Strategy

If issues are discovered during rollout:

1. **Immediate rollback**: Disable broker via `CREDENTIAL_BROKER=0` env var
2. **Data rollback**: Restore backup of existing tables
3. **Agent rollback**: Revert agents to legacy credential handling
4. **Monitoring**: Watch runtime events for issues

---

## Key Design Decisions

1. **Env-only injection**: Plaintext returned once via env vars; never written to disk
2. **Hashed storage**: Only SHA256 hash stored in DB; plaintext never persisted
3. **Short-lived by default**: 24h TTL for ephemerals; configurable for durables
4. **Auto-rotation**: Rotatable credentials automatically refreshed before expiry
5. **Scoped permissions**: Gitea tokens with minimal repo/capability scopes
6. **Fallback safety**: If upstream unavailable, broker issues random tokens
