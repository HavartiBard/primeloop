# Agent Catalog Testing Guide

## Overview

The catalog module includes unit tests, integration tests, and test utilities.

## Test Structure

```
backend/tests/catalog/
├── validator.test.ts    # Validator logic tests
├── store.test.ts        # Database store tests
└── integration.test.ts  # Full workflow tests
```

## Running Tests

```bash
# Run all catalog tests
npm test -- backend/tests/catalog/

# Run specific test file
npm test -- backend/tests/catalog/validator.test.ts

# Run with coverage
npm run test:coverage -- backend/tests/catalog/
```

## Test Coverage

### Validator Tests (`validator.test.ts`)

- Duplicate template ID detection
- Duplicate version detection
- Version conflict detection
- Rejection handling
- Failure categorization
- Rejection message formatting

### Store Tests (`store.test.ts`)

- Source CRUD operations
- Template CRUD operations
- Version CRUD operations
- Admission event recording
- Version listing by template

### Integration Tests (`integration.test.ts`)

- Full admission lifecycle (sync → validate → approve → register)
- Version conflict handling
- Admission event ordering

## Writing New Tests

1. **Unit Tests**: Test individual functions in isolation
2. **Integration Tests**: Test multi-step workflows with database
3. **Mock Database**: Use test database or in-memory SQLite for fast tests

## CI/CD Integration

Tests run automatically on:
- PR submissions
- Main branch merges
- Scheduled daily runs

## Test Data

Test templates are located in `backend/catalog/`:

```yaml
templateId: example-template
name: Example Template
version: 1.0.0
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: durable
capabilityProfile:
  platformPrimitives:
    - read-only
    - file-read
  capabilityBundles:
    - basic
toolAccess:
  - read-only
mcpAccess:
  - basic
```
