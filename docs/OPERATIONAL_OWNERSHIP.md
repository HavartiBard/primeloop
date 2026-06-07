# Agent Catalog - Operational Ownership

## Overview

The Agent Catalog feature is a shared responsibility between the **Backend Team** and the **Platform Team**.

## Responsibilities

### Backend Team (Catalog Core)

Owns:
- Database schema (`catalog_sources`, `catalog_templates`, `catalog_template_versions`, `catalog_admission_events`)
- CRUD store implementation (`catalog/store.ts`)
- API routes (`routes/catalog.ts`)
- Runtime integration (`app.ts` router mounting)
- Migration scripts and versioning
- Error handling and logging

Deliverables:
- Schema migrations (idempotent, backward-compatible)
- API contract compliance
- Observability hooks (metrics, logs, alerts)
- Performance optimization (indexing, query tuning)

### Platform Team (Validation & Policy)

Owns:
- Safe baseline definition (`catalog/baseline.ts`)
- Structural validation (`catalog/schema.ts`)
- Reference resolution (`catalog/validator.ts`)
- Admission state machine (`catalog/admission-state.ts`)
- Approval policy enforcement
- Capability bundle definitions
- Security rules and constraints

Deliverables:
- Validation rules that align with security policies
- Auto-approval thresholds and criteria
- Documentation of baseline requirements
- Review process for non-baseline templates

## Operational Procedures

### Deploying Schema Changes

1. Backend team creates migration in `db.ts`
2. Migration must be idempotent (`CREATE TABLE IF NOT EXISTS`)
3. Test in staging environment first
4. Monitor for errors during migration
5. Rollback plan: revert to previous schema version

### Handling Sync Failures

1. Check logs for `sync_failed` events
2. Verify catalog source connectivity (local files or git repo)
3. Check database connection and locks
4. Review admission event history for stuck transitions
5. Manual intervention may be required to re-sync

### Approval Workflow

1. Operator or Prime submits template for approval
2. System checks if within safe baseline (`baseline.ts`)
3. If auto-eligible: automatically registers template
4. If not auto-eligible: creates approval task in approvals table
5. Operator reviews and approves/rejects
6. System transitions to `registered` state

### Monitoring

**Key Metrics:**
- `catalog_sync_total` - Total sync operations
- `catalog_validate_total` - Total validation attempts
- `catalog_approve_total` - Total approval actions
- `catalog_admission_transitions_total` - State transition counts

**Alerts:**
- High rejection rate (>50% in 1 hour)
- Slow sync (>30 seconds)
- Stale admission events (no events in 24 hours)

## Troubleshooting

### Common Issues

**Issue:** Templates stuck in `discovered` state
- **Cause:** Validation failed or approval not submitted
- **Fix:** Check validation errors, submit approval task

**Issue:** Sync fails with connection error
- **Cause:** Catalog source unreachable (local path missing or git repo inaccessible)
- **Fix:** Verify source configuration, check network connectivity

**Issue:** High rejection rate
- **Cause:** Template definitions violate baseline rules
- **Fix:** Review baseline requirements, update templates to comply

## Contact

- Backend Team: `#backend-platform`
- Platform Team: `#platform-infrastructure`
