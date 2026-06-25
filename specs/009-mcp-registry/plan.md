# Spec 009: Capability Registry Implementation Plan

**Feature Branch**: `009-mcp-registry`  
**Date**: 2026-06-24  
**Status**: Draft

---

## Overview

This plan outlines the implementation phases for the Capability Registry system, which introduces a layered tooling model where agents receive only the minimum platform primitives, capability bundles, provider adapters, and per-run tool grants needed for their role and task.

---

## Phases

### Phase A: Foundation (Week 1-2)

**Goal**: Establish core database schema and basic CRUD operations.

#### Tasks

1. **Database Schema** (`backend/src/db.ts`)
   - [ ] Create `platform_primitives` table
   - [ ] Create `capability_bundles` table
   - [ ] Create `provider_adapters` table
   - [ ] Create `capability_to_adapter_mappings` table
   - [ ] Create `capability_profiles` table
   - [ ] Create `profile_primitives` table
   - [ ] Create `profile_bundles` table
   - [ ] Create `resolved_tool_grants` table
   - [ ] Create `adapter_health_records` table
   - [ ] Add indexes for performance-critical queries

2. **Backend Store** (`backend/src/capability-registry/store.ts`)
   - [ ] Implement `CapabilityRegistryStore` interface
   - [ ] CRUD operations for primitives
   - [ ] CRUD operations for bundles
   - [ ] CRUD operations for adapters
   - [ ] CRUD operations for mappings
   - [ ] CRUD operations for profiles
   - [ ] CRUD operations for grants

3. **REST API** (`backend/src/routes/capability-registry.ts`)
   - [ ] List primitives endpoint
   - [ ] Get primitive by ID endpoint
   - [ ] List bundles endpoint
   - [ ] Get bundle by ID endpoint
   - [ ] List adapters endpoint
   - [ ] Get adapter by ID endpoint
   - [ ] List mappings endpoint
   - [ ] Create mapping endpoint
   - [ ] List profiles endpoint
   - [ ] Get profile by ID endpoint

4. **Tests**
   - [ ] Unit tests for store operations
   - [ ] Integration tests for REST API endpoints
   - [ ] Migration tests for backward compatibility

---

### Phase B: Capability Resolution (Week 3-4)

**Goal**: Implement grant resolution logic and approval-aware scoping.

#### Tasks

1. **Grant Resolver** (`backend/src/capability-registry/resolver.ts`)
   - [ ] Implement `resolveToolGrant()` function
   - [ ] Factor in agent identity
   - [ ] Factor in capability profile
   - [ ] Factor in task scope
   - [ ] Factor in approval state
   - [ ] Factor in provider adapter health
   - [ ] Filter primitives based on agent capabilities
   - [ ] Select adapters based on health and priority

2. **Approval Integration**
   - [ ] Check approval state before granting sensitive capabilities
   - [ ] Record exclusion reasons for denied capabilities
   - [ ] Support hot-reload of approval state

3. **Health-Aware Selection**
   - [ ] Query adapter health records
   - [ ] Exclude unhealthy adapters from grants
   - [ ] Select highest-priority healthy adapter by default
   - [ ] Support failover to alternate adapters

4. **Credential Broker Integration** (Spec 010)
   - [ ] Request credentials for selected adapters
   - [ ] Validate credential availability before grant
   - [ ] Record excluded adapters due to missing credentials

5. **Tests**
   - [ ] Unit tests for grant resolver
   - [ ] Integration tests for approval-aware grants
   - [ ] Tests for health-aware adapter selection
   - [ ] Tests for credential validation

---

### Phase C: Control Plane Integration (Week 5)

**Goal**: Integrate capability registry with ACP control plane.

#### Tasks

1. **Control Plane Tools** (`backend/src/capability-registry/orchestrator-tools.ts`)
   - [ ] `capability_list_primitives()` - List all primitives
   - [ ] `capability_list_bundles()` - List all bundles
   - [ ] `capability_list_adapters()` - List all adapters
   - [ ] `capability_list_profiles()` - List all profiles
   - [ ] `capability_get_profile()` - Get profile by ID
   - [ ] `capability_resolve_grant()` - Resolve tool grant for agent

2. **ACP Message Handlers** (`backend/src/mcp/capability-registry.ts`)
   - [ ] Handle `capability_registry.list_primitives`
   - [ ] Handle `capability_registry.list_bundles`
   - [ ] Handle `capability_registry.list_adapters`
   - [ ] Handle `capability_registry.list_profiles`
   - [ ] Handle `capability_registry.get_profile`
   - [ ] Handle `capability_registry.resolve_grant`
   - [ ] Handle `capability_registry.get_grant`
   - [ ] Handle `capability_registry.list_agent_grants`
   - [ ] Handle `capability_registry.list_adapter_health`

3. **Agent Runtime Integration**
   - [ ] Send `agent.tool_grant` message on spawn
   - [ ] Send `agent.tool_grant_update` on approval
   - [ ] Send `agent.tool_grant_revoke` on adapter health issues

4. **Tests**
   - [ ] Unit tests for control plane tools
   - [ ] Integration tests for ACP message handlers
   - [ ] End-to-end tests for agent grant lifecycle

---

### Phase D: Migration (Week 6)

**Goal**: Migrate existing data and ensure backward compatibility.

#### Tasks

1. **Data Migration** (`backend/src/capability-registry/migrate.ts`)
   - [ ] Migrate `capabilities` → `platform_primitives`
   - [ ] Migrate `mcp_servers` → `provider_adapters`
   - [ ] Migrate `agent_mcp_assignments` → `capability_to_adapter_mappings`
   - [ ] Create default capability profiles for Prime and durable staff
   - [ ] Populate `agent_tokens` from existing agent configurations

2. **Backward Compatibility**
   - [ ] Keep existing `capabilities`, `mcp_servers`, `agent_mcp_assignments` tables
   - [ ] New code reads from new tables, old code continues using legacy tables
   - [ ] Graceful degradation if registry unavailable

3. **Rollout Strategy**
   - [ ] Enable capability registry in staging
   - [ ] Monitor for issues
   - [ ] Enable in production with feature flag
   - [ ] Gradually migrate agents to new model

4. **Tests**
   - [ ] Migration tests
   - [ ] Backward compatibility tests
   - [ ] Rollout validation tests

---

### Phase E: Polish & Documentation (Week 7)

**Goal**: Finalize implementation and documentation.

#### Tasks

1. **Documentation**
   - [ ] Update `specs/009-mcp-registry/spec.md` with data model
   - [ ] Update `specs/009-mcp-registry/spec.md` with API contracts
   - [ ] Add migration guide
   - [ ] Add troubleshooting section

2. **Monitoring & Observability**
   - [ ] Add metrics for grant resolution time
   - [ ] Add alerts for adapter health issues
   - [ ] Add logs for grant resolution decisions

3. **Testing**
   - [ ] Performance tests for grant resolution
   - [ ] Load tests for concurrent grants
   - [ ] Security audit of credential handling

---

## Acceptance Criteria

- [ ] All database tables created with correct schema
- [ ] All REST API endpoints implemented and tested
- [ ] Grant resolution logic handles all factors (profile, task, approval, health)
- [ ] ACP control plane tools integrated
- [ ] Agent runtime messages sent on grant changes
- [ ] Migration completed successfully
- [ ] Backward compatibility maintained
- [ ] Documentation complete

---

## Rollback Strategy

If issues are discovered during rollout:

1. **Immediate rollback**: Disable capability registry via feature flag
2. **Data rollback**: Restore backup of existing tables
3. **Agent rollback**: Revert agents to legacy tooling model
4. **Monitoring**: Watch runtime events for issues

---

## Key Design Decisions

1. **Layered model**: Agents bind first to platform primitives and capability bundles, not directly to infrastructure adapters
2. **Deny-by-default**: No agent receives capabilities or adapters unless explicitly granted
3. **Per-run resolution**: Final access decided at execution time, not as static assignment
4. **Health-aware selection**: Adapters are excluded from grants if unhealthy
5. **Credential isolation**: Each agent gets unique, scoped credentials (no sharing)
