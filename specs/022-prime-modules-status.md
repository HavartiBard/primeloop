# Issue #22: Prime Agent Module System - Status Analysis

**Date**: 2026-06-17  
**Status**: Partially Implemented (Phase 1 Complete, Phase 3 Pending)

---

## What's Already Implemented ✅

### Database Schema
- `prime_agent_modules` table with config, versioning, and rollout modes
- `prime_agent_module_audits` table for tracking changes
- `prime_agent_module_runs` table for session execution history

### Module Types & Registry (`backend/src/prime-agent/modules/`)

**Types** (`types.ts`):
- `PrimeModuleStage`: trigger, debounce, context, decision, policy, action, feedback, learning, observer
- `PrimeModuleRolloutMode`: active, shadow
- `PrimeModule`: id, stage, version, order, run() function
- `PrimeLoopState`: event, session, context, decision, actions, moduleRuns, budget
- `PrimeModuleConfig`: enabled, pinned_version, rollout_mode, config

**Registry** (`registry.ts`):
- 7 static modules implemented:
  1. `trigger.event-ingress` - accepts events
  2. `debounce.pass-through` - configurable debounce window
  3. `context.fleet-state` - assembles context from DB + harness
  4. `decision.llm-router` - calls LLM for decisions
  5. `policy.scope-required` - validates allowed_files for scoped actions
  6. `action.dispatch` - dispatches actions (active vs shadow mode)
  7. `feedback.approval-continuation` - saves approval continuations

### Event Loop Integration (`backend/src/prime-agent/event-loop.ts`)
- Modules run in stage order
- Active and shadow modules execute separately
- Module runs recorded with timing and status
- Events emitted for each module step

### API Routes (`backend/src/routes/prime-agent.ts`)
- `GET /api/prime-agent/modules` - list all modules with configs
- `PATCH /api/prime-agent/modules/:id` - update config, enabled, rollout_mode
- `GET /api/prime-agent/modules/:id/audit` - view configuration history

---

## What's Missing ❌

### 1. Catalog Integration (Phase 3 - Versioned Evolution)

**Current State**: Modules are hardcoded in `registry.ts` and managed via DB config

**Required**:
```typescript
// Module definitions should come from catalog templates
// Example catalog template: backend/catalog/modules/context-fleet-state.yaml

catalog_template_versions:
  template_id: context.fleet-state
  version: "1.2.0"
  manifest:
    stage: context
    order: 100
    required_capabilities: []
  implementation:
    type: typescript
    entry_point: modules/context/fleet-state.ts
  tests:
    - npm run test:module=context.fleet-state
```

**Benefits**:
- Modules versioned in Git catalog repo
- Operators can add/modify modules without code deploy
- Catalog approval workflow for module changes
- Version pinning and rollback via catalog

### 2. Module Templates in Catalog

**Missing Structure**:
```
catalog/
├── modules/                    # NEW: Module templates
│   ├── context.fleet-state.yaml
│   ├── decision.llm-router.yaml
│   └── policy.scope-required.yaml
└── workspace/
    └── modules/                # NEW: Local module implementations
        ├── context/
        │   └── fleet-state.ts
        └── policy/
            └── scope-required.ts
```

### 3. Module Discovery & Registration

**Current**: Static array in `registry.ts`

**Required**:
- Scan catalog templates on startup
- Load module implementations from `/workspace/modules/`
- Register dynamically discovered modules
- Fallback to built-in static modules if not found in catalog

### 4. Module Testing Infrastructure

**Missing**:
- Per-module test runner
- Integration test framework for modules
- Shadow mode comparison utilities
- Test result reporting to catalog

### 5. Observer/Learning Modules

**Missing Stages**:
- `observer.*` modules (tracing, metrics)
- `learning.*` modules (lesson extraction, pattern detection)

---

## Alignment with Catalog Concept

The module system is **perfectly suited** for catalog integration:

| Catalog Feature | Module System Match |
|-----------------|---------------------|
| Template versions | Module versions |
| Approval workflow | Module rollout modes (active/shadow) |
| Workspace edits | Local module implementations |
| Git-backed persistence | Module config + code in catalog |
| Version pinning | `pinned_version` field |
| Audit trail | `prime_agent_module_audits` table |

---

## Recommended Implementation Phases

### Phase A: Catalog Module Discovery (2-3 days)
1. Define catalog template schema for modules
2. Add module scanning to catalog startup sync
3. Register discovered modules dynamically
4. Fallback to built-in static modules

### Phase B: Workspace Module Implementations (3-4 days)
1. Create `/workspace/modules/` directory structure
2. Load TypeScript implementations from workspace
3. Support hot-reload on workspace changes
4. Add module validation (stage, order, required deps)

### Phase C: Module Testing Framework (2-3 days)
1. Per-module test runner
2. Shadow mode comparison utilities
3. Test result reporting
4. Integration with catalog approval workflow

### Phase D: Observer & Learning Modules (3-5 days)
1. Implement `observer.trace` module
2. Implement `learning.pattern-detect` module
3. Wire into Arize Phoenix or other OTel backend
4. Add lesson extraction from module failures

---

## Current Module Inventory

| Stage | Module ID | Version | Status |
|-------|-----------|---------|--------|
| trigger | trigger.event-ingress | 1.0.0 | Built-in |
| debounce | debounce.pass-through | 1.0.0 | Built-in |
| context | context.fleet-state | 1.0.0 | Built-in |
| decision | decision.llm-router | 1.0.0 | Built-in |
| policy | policy.scope-required | 1.0.0 | Built-in |
| action | action.dispatch | 1.0.0 | Built-in |
| feedback | feedback.approval-continuation | 1.0.0 | Built-in |
| learning | *(none)* | - | Missing |
| observer | *(none)* | - | Missing |

---

## Next Immediate Steps

1. **Define catalog template schema** for modules (YAML format)
2. **Create example module templates** in `backend/catalog/modules/`
3. **Implement catalog module scanner** in `catalog/startup.ts`
4. **Add workspace module loader** in `workspace/sync.ts`
5. **Update registry** to use dynamic discovery + static fallback

---

## Open Questions

1. Should module implementations be TypeScript (compiled) or JavaScript (runtime)?
2. How to handle module dependencies between modules?
3. Should catalog templates include test files, or tests live separately?
4. What's the upgrade path for breaking changes in module interfaces?
5. Should we support multiple implementations of the same stage (e.g., multiple policy modules)?
