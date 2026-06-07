# Agent Catalog Operational Guide

## Overview

This guide covers common operational tasks for managing the Agent Catalog.

## Prerequisites

- PostgreSQL database running
- Backend service connected to catalog tables
- Git CLI available for Git source sync

## Common Tasks

### 1. Sync Templates from Local Source

Templates are synced from local directories (e.g., `backend/catalog/`).

**Via API:**
```bash
curl -X POST http://localhost:3000/api/catalog/sync \
  -H "Content-Type: application/json" \
  -d '{"sourceId": "local-source-id"}'
```

**Expected Result:**
```json
{
  "results": [
    {
      "templateId": "template-1",
      "version": "1.0.0",
      "outcome": "admitted",
      "admissionState": "validated"
    }
  ]
}
```

### 2. Approve a Template Version

After sync, templates are in `validated` state and need approval.

**Via API:**
```bash
curl -X POST http://localhost:3000/api/catalog/templates/:id/versions/:version/approve \
  -H "Content-Type: application/json" \
  -d '{"note": "Approved by security team"}'
```

### 3. Rollback to Previous Version

If a registered version has issues, rollback to a previous stable version.

**Via API:**
```bash
curl -X POST http://localhost:3000/api/catalog/templates/:id/rollback \
  -H "Content-Type: application/json" \
  -d '{"version": "1.0.0"}'
```

### 4. Deprecate a Template

Mark a template as deprecated when it's no longer needed.

**Via API:**
```bash
curl -X POST http://localhost:3000/api/catalog/templates/:id/deprecate
```

## Troubleshooting

### Sync Fails with "Failed to read source directory"

**Check:**
1. Directory exists and is readable
2. YAML files have valid syntax
3. Subpath is correct if specified

### Approval Fails with "Invalid admission transition"

**Check:**
1. Template version is in `validated` state (not `discovered` or `rejected`)
2. No concurrent state changes are happening

### Rollback Fails

**Check:**
1. Target version exists and is `registered`
2. Template has at least one registered version

## Monitoring

### Check Admission Events

```sql
SELECT * FROM catalog_admission_events 
WHERE version_id = 'version-uuid' 
ORDER BY created_at ASC;
```

### List All Templates in Rejected State

```sql
SELECT t.template_id, v.version, v.failure_reasons
FROM catalog_templates t
JOIN catalog_template_versions v ON t.id = v.template_pk
WHERE v.admission_state = 'rejected';
```

### Count Templates by State

```sql
SELECT admission_state, COUNT(*) as count
FROM catalog_template_versions
GROUP BY admission_state;
```

## Best Practices

1. **Version Naming**: Use semantic versioning (e.g., `1.0.0`, `1.1.0`)
2. **Approval Workflow**: Always review templates before approval
3. **Rollback Planning**: Keep at least 2-3 previous registered versions
4. **Audit Trail**: All state transitions are recorded in `catalog_admission_events`
5. **Git Sources**: Pin to specific commit SHAs for reproducibility

## Security Considerations

1. **Secret Detection**: Templates with potential secrets are flagged during validation
2. **Least Privilege**: Tool/MCP access must be declared in capability profile
3. **Egress Rules**: Network access should be restricted to allowlist only
4. **Credential Broker**: Use `credentialNeeds` with proper denyRules
