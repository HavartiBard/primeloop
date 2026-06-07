// Catalog module - Agent configuration management
//
// This module implements a reviewed, versioned Agent Catalog:
// declarative YAML templates that carry the complete, modular agent definition.
//
// Architecture:
//   source.ts  → read templates from local dir or git (ref→SHA resolve)
//   schema.ts  → structural validation (required/optional fields)
//   validator.ts → structural + semantic validation → named failure codes
//   store.ts   → DB access for catalog_* tables (CRUD + snapshots)
//   admission.ts → state machine + batch sync orchestration + events
//   registrar.ts → map registered version → capability_profile + blueprint
//   instantiate.ts → registered version → managed agent (no eager boot)
//   baseline.ts  → safe-baseline definition for auto-approval
//
// Observability:
//   - Structured logs on sync/validate/approve/instantiate
//   - Admission events appended to catalog_admission_events (actor + reason)
//   - Rollback path: set current_version_id to prior registered version
//   - Audit trail: all transitions logged with actor and reason

export * from './types.js';
