# Prime Module Testing Framework

This document describes the testing framework for Prime modules, including how to write tests, run shadow mode comparisons, and promote modules from shadow to active.

---

## Overview

Prime modules can be tested in three ways:

1. **Unit Tests** - Test individual module logic in isolation
2. **Shadow Mode** - Run modules alongside active execution without side effects
3. **Integration Tests** - Test module behavior in the full Prime loop

---

## Unit Testing Modules

### Test Runner Utilities

The test runner provides utilities for creating mock state and dependencies:

```typescript
import { 
  createMockEvent,
  createMockContext,
  createMockDecision,
  createMockDeps,
  createMockState,
  runModuleTest,
  runModuleShadowTest,
  validateModuleContract,
} from '../src/tests/prime-agent/modules/module-runner.js';

// Create test fixtures
const event = createMockEvent({ type: 'cron.fast' });
const context = createMockContext({ 
  agents: [{ id: 'agent-1', enabled: true }],
  dispatchableAgents: [{ id: 'agent-1' }]
});
const deps = createMockDeps({ executionMode: 'active' });

// Run module test
const result = await runModuleTest(
  myModule,
  (state) => { state.context = context; },
  { expected: { success: true } }
);

expect(result.success).toBe(true);
expect(result.result?.detail).toContain('expected text');
```

### Module Contract Validation

All modules must pass contract validation before being loaded:

```typescript
const validation = validateModuleContract(myModule);

if (!validation.valid) {
  console.error('Module contract errors:', validation.errors);
  // Errors include:
  // - Missing required fields (id, stage, order, run)
  // - Invalid stage value
  // - Invalid order (must be non-negative number)
}
```

### Example Test Suite

```typescript
import { describeModule } from '../src/tests/prime-agent/modules/module-runner.js';

describeModule(myModule, () => {
  it('should execute successfully in active mode', async () => {
    const state = createMockState({ context: createMockContext() });
    const deps = createMockDeps({ executionMode: 'active' });
    
    const result = await myModule.run(state, deps);
    
    expect(result.detail).toBeDefined();
  });

  it('should execute successfully in shadow mode', async () => {
    const state = createMockState({ context: createMockContext() });
    const deps = createMockDeps({ executionMode: 'shadow' });
    
    const result = await myModule.run(state, deps);
    
    // Shadow mode should produce same results as active
    expect(result.detail).toBeDefined();
  });

  it('should not modify state in shadow mode', async () => {
    const state = createMockState({ context: createMockContext() });
    const actionsBefore = state.actions.length;
    
    const deps = createMockDeps({ executionMode: 'shadow' });
    await myModule.run(state, deps);
    
    expect(state.actions.length).toBe(actionsBefore);
  });
});
```

---

## Shadow Mode Comparison

Shadow mode comparison runs a module in both shadow and active modes simultaneously, then compares results to detect behavior differences.

### Running Shadow Comparisons

```typescript
import { runShadowComparison } from '../src/prime-agent/modules/shadow-comparison.js';

const comparison = await runShadowComparison(
  myModule,
  initialState, // PrimeLoopState
  deps          // PrimeModuleDeps
);

console.log('Risk level:', comparison.riskLevel);
console.log('Recommendation:', comparison.recommendation);
console.log('Differences:', comparison.differences);
```

### Comparison Results

| Field | Description |
|-------|-------------|
| `comparison` | `'identical'`, `'differing'`, or `'error'` |
| `riskLevel` | `'low'`, `'medium'`, or `'high'` |
| `recommendation` | `'promote'`, `'review'`, or `'rollback'` |
| `differences` | Array of specific differences found |

### Difference Severity

| Severity | Meaning | Impact |
|----------|---------|--------|
| `info` | Informational only (e.g., diagnostics) | No side effects |
| `warning` | Minor behavioral difference | May affect metrics/logging |
| `error` | Critical difference (e.g., action count) | Affects system behavior |

### Risk Level Determination

- **Low**: All differences are informational only
- **Medium**: Has warnings but no errors
- **High**: Has errors or critical differences

### Promotion Recommendation

- **promote**: Safe to move from shadow to active
- **review**: Requires human review before promotion
- **rollback**: Should be rolled back if currently active

### Storing Comparison Results

Results are automatically stored in the database:

```sql
SELECT * FROM prime_agent_module_shadow_comparisons
WHERE module_id = 'context.fleet-state'
ORDER BY created_at DESC
LIMIT 10;
```

### Checking Promotion Readiness

```typescript
import { canPromoteModule } from '../src/prime-agent/modules/shadow-comparison.js';

const { canPromote, reasons } = await canPromoteModule(
  pool,
  'context.fleet-state',
  5  // Require 5 successful comparisons
);

if (canPromote) {
  console.log('Safe to promote:', reasons);
} else {
  console.log('Cannot promote:', reasons);
}
```

---

## Integration Testing

### Full Prime Loop Tests

Test modules in the context of the full Prime loop:

```typescript
import { describe, it, expect } from 'vitest';
import { handlePrimeEvent } from '../src/prime-agent/event-loop.js';

describe('Prime loop with custom modules', () => {
  it('should execute workspace modules correctly', async () => {
    const event = createMockEvent({ type: 'cron.fast' });
    const pool = createTestPool();
    
    const result = await handlePrimeEvent(pool, event, deps);
    
    // Verify module was loaded and executed
    expect(result.session.moduleRuns).toBeDefined();
    const customModuleRun = result.session.moduleRuns.find(
      r => r.module_id === 'observer.trace'
    );
    expect(customModuleRun).toBeDefined();
    expect(customModuleRun?.status).toBe('completed');
  });
});
```

### Workspace Module Override Tests

Test that workspace modules correctly override built-ins:

```typescript
import { listPrimeModules } from '../src/prime-agent/modules/registry.js';

it('should load workspace overrides', async () => {
  const modules = await listPrimeModules();
  
  // Find context.fleet-state module
  const contextModule = modules.find(m => m.id === 'context.fleet-state');
  
  expect(contextModule).toBeDefined();
  expect(contextModule?.version).toContain('workspace'); // Override marker
});
```

---

## Running Tests

### Unit Tests Only

```bash
cd backend
npm run test:unit -- tests/prime-agent/modules/module-runner.test.ts
```

### Shadow Comparison Tests

```bash
cd backend
npm run test:unit -- tests/prime-agent/modules/shadow-comparison.test.ts
```

### All Module Tests

```bash
cd backend
npm run test:unit -- tests/prime-agent/modules/
```

### Full Integration Tests (with database)

```bash
cd backend
npm run test:db -- tests/prime-agent/
```

---

## Best Practices

### 1. Test Contract Compliance First

Always validate module contract before testing logic:

```typescript
it('should have valid contract', () => {
  const validation = validateModuleContract(myModule);
  expect(validation.valid).toBe(true);
});
```

### 2. Test Both Active and Shadow Modes

Ensure modules work correctly in both modes:

```typescript
it('should work in shadow mode', async () => {
  const result = await runModuleShadowTest(myModule, setupState);
  expect(result.success).toBe(true);
});
```

### 3. Verify No Side Effects in Shadow Mode

Shadow mode should not modify state:

```typescript
it('should not dispatch actions in shadow mode', async () => {
  const state = createMockState({ context: createMockContext() });
  const actionsBefore = state.actions.length;
  
  await runModuleShadowTest(myModule, setupState);
  
  expect(state.actions.length).toBe(actionsBefore);
});
```

### 4. Run Multiple Shadow Comparisons

Before promoting a module from shadow to active, run at least 5 comparisons:

```typescript
const { canPromote } = await canPromoteModule(pool, moduleId, 5);
```

### 5. Monitor Comparison Trends

Track comparison results over time:

```sql
SELECT 
  risk_level,
  COUNT(*) as count,
  AVG(EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (ORDER BY created_at)))) as avg_interval
FROM prime_agent_module_shadow_comparisons
WHERE module_id = 'my-module'
GROUP BY risk_level;
```

---

## Troubleshooting

### Module Fails Contract Validation

Check for missing required fields:

```typescript
const validation = validateModuleContract(myModule);
if (!validation.valid) {
  console.error('Errors:', validation.errors);
  // Common issues:
  // - Missing id, stage, order, or run() method
  // - Invalid stage name
  // - Order is not a non-negative number
}
```

### Shadow Comparison Shows High Risk

Review differences to understand the cause:

```typescript
const comparisons = await getModuleShadowComparisons(pool, moduleId, 10);
for (const comp of comparisons) {
  console.log('Differences:', JSON.stringify(comp.differences, null, 2));
}
```

Common causes:
- Module has bugs that only manifest in active mode
- External dependencies behave differently
- Race conditions or timing issues

### Workspace Module Not Loading

Check logs for errors:

```bash
grep "workspace.*module" /var/log/primeloop/backend.log
```

Verify:
- File path is correct (`workspace/modules/<stage>/<name>.ts`)
- Module exports `default` or `{ module: ... }`
- TypeScript compilation succeeds

---

## API Endpoints

### Get Shadow Comparisons for a Module

```bash
GET /api/prime-agent/modules/:id/shadow-comparisons?limit=10
```

Response:

```json
{
  "comparisons": [
    {
      "stage": "context",
      "version": "1.0.0-workspace",
      "comparison": "identical",
      "differences": [],
      "risk_level": "low",
      "recommendation": "promote",
      "created_at": "2026-06-17T19:00:00Z"
    }
  ]
}
```

### Check Module Promotion Readiness

```bash
GET /api/prime-agent/modules/:id/promotion-ready
```

Response:

```json
{
  "canPromote": true,
  "reasons": ["All shadow comparisons produced identical results"],
  "lastComparison": { ... }
}
```

---

## Related Documentation

- [Prime Module System](../specs/022-prime-modules-status.md)
- [Workspace Module Loading](../workspace/modules/README.md)
- [Catalog Module Templates](../backend/catalog/modules/)
- [Runtime Packaging](../docs/runtime-packaging.md)
