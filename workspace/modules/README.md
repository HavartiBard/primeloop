# Prime Module Workspace Overrides

This directory contains custom Prime module implementations that override or extend the built-in modules.

## Directory Structure

```
workspace/modules/
├── context/
│   └── fleet-state.ts      # Override built-in context.fleet-state
├── policy/
│   └── scope-custom.ts     # New custom policy module
└── observer/
    └── trace.ts            # New observer module for tracing
```

## Module Types

### 1. Overrides (Replace Built-ins)

To override a built-in module, create a file with the same `template_id`:

```typescript
// workspace/modules/context/fleet-state.ts
export default {
  id: 'context.fleet-state',  // Must match built-in ID
  stage: 'context',
  version: '1.0.0-workspace',
  order: 100,
  async run(state, deps) {
    // Custom implementation
  }
};
```

**Use cases**:
- Add custom context enrichment
- Modify policy validation rules
- Change action dispatch logic

### 2. New Modules (Extend System)

To add a new module, use a unique `template_id`:

```typescript
// workspace/modules/observer/trace.ts
export default {
  id: 'observer.trace',  // New ID (not a built-in)
  stage: 'observer',
  version: '1.0.0-workspace',
  order: 900,
  async run(state, deps) {
    // Add OpenTelemetry tracing
  }
};
```

**Use cases**:
- Add observability (tracing, metrics)
- Implement custom learning/feedback logic
- Add domain-specific policies

## Module Contract

Each module must export a default `PrimeModule` object:

```typescript
interface PrimeModule {
  id: string;              // Unique module ID (e.g., 'context.fleet-state')
  stage: string;           // One of: trigger, context, decision, policy, action, feedback, learning, observer
  version: string;         // Semver-like version
  order: number;           // Execution order within stage (lower = earlier)
  requires_active?: boolean; // If true, module must always be enabled
  run(state, deps): Promise<{ detail?: string }>;
}
```

### Inputs

- `state`: `PrimeLoopState` - Current loop state with event, context, decision, actions, etc.
- `deps`: `PrimeModuleDeps` - Database pool, LLM router, harness getter, module config

### Outputs

Return `{ detail?: string }` or void. The `detail` is logged for observability.

## Stages Overview

| Stage | Purpose | Example Modules |
|-------|---------|-----------------|
| `trigger` | Accept and normalize events | `trigger.event-ingress` |
| `debounce` | Apply debounce policies | `debounce.pass-through` |
| `context` | Assemble Prime context | `context.fleet-state` |
| `decision` | Call LLM for decisions | `decision.llm-router` |
| `policy` | Validate proposed actions | `policy.scope-required` |
| `action` | Execute approved actions | `action.dispatch` |
| `feedback` | Handle results/continuations | `feedback.approval-continuation` |
| `learning` | Extract lessons/patterns | *(none built-in)* |
| `observer` | Emit traces/metrics | `observer.trace` |

## Development Workflow

### 1. Create a Module

```bash
mkdir -p workspace/modules/context
cat > workspace/modules/context/fleet-state.ts << 'EOF'
import type { PrimeModule } from '../../../src/prime-agent/modules/types.js';

export default {
  id: 'context.fleet-state',
  stage: 'context',
  version: '1.0.0-workspace',
  order: 100,
  async run(state, deps) {
    // Your custom implementation
    return { detail: 'custom context assembly' };
  }
} as PrimeModule;
EOF
```

### 2. Test Locally

Restart the backend to load workspace modules:

```bash
cd backend
npm run build
npm start
```

Look for logs like:

```
[workspace] Loaded 1 workspace modules:
  - context.fleet-state@1.0.0-workspace (context, order=100) (OVERRIDE)
```

### 3. Add to Catalog (Optional)

To share the module with other deployments, add it to the catalog:

```bash
# Create template definition
cat > backend/catalog/modules/context.fleet-state.yaml << 'EOF'
template_id: context.fleet-state
version: "1.0.0"
manifest:
  stage: context
  order: 100
interface:
  inputs: [...]
configuration:
  schema: {}
provenance:
  author: yourname
  created_at: "2026-06-17"
EOF

# Commit to catalog repo
git add backend/catalog/modules/
git commit -m "feat: Add context.fleet-state module template"
git push origin main
```

### 4. Enable in Production

Update the Prime module config via API or directly in database:

```sql
-- Enable the workspace module (it's automatically loaded)
UPDATE prime_agent_modules
SET enabled = true, rollout_mode = 'active'
WHERE module_id = 'context.fleet-state';
```

## Hot Reload

Workspace modules are reloaded when:

1. Backend restarts
2. Workspace sync detects file changes (hourly by default)

To manually trigger reload:

```bash
# Send a POST request to invalidate cache
curl -X POST http://localhost:3100/api/workspace/sync
```

## Troubleshooting

### Module Not Loading

Check logs for errors:

```
[modules] Failed to load workspace modules: ...
[workspace] [context.fleet-state] Missing required field: order
```

Common issues:
- File path incorrect (must be `workspace/modules/<stage>/<name>.ts`)
- Missing `id`, `stage`, or `order` fields
- TypeScript compilation errors

### Override Not Taking Effect

Verify workspace module is being loaded:

```bash
grep -r "OVERRIDE" /var/log/primeloop/backend.log
```

If not showing, check:
- Workspace path is correct (`WORKSPACE_ROOT` env var)
- Module directory structure matches stage name
- File exports `default` or `{ module: ... }`

### Version Conflicts

Workspace modules use `-workspace` suffix to distinguish from catalog versions:

```
context.fleet-state@1.0.0-workspace  (workspace override)
context.fleet-state@1.0.0            (built-in/catalog)
```

## Examples

See existing modules in this directory:
- `context/fleet-state.ts` - Override example with custom enrichment
- `observer/trace.ts` - New module example with OpenTelemetry tracing
