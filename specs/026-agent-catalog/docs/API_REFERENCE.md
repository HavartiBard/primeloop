# Agent Catalog API Reference

## Overview

The Catalog API provides REST endpoints for managing agent templates through their admission lifecycle:
- **discovered** → **validated** → **pending_approval** → **registered** → **active/deprecated**

## Base URL

```
/api/catalog
```

## Endpoints

### List Templates

```http
GET /templates
```

**Response:**
```json
{
  "templates": [
    {
      "id": "uuid",
      "template_id": "template-1",
      "name": "My Template",
      "current_version_id": "version-uuid",
      "lifecycle_state": "available",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Get Template Details

```http
GET /templates/:id
```

**Response:**
```json
{
  "template": { /* template record */ },
  "versions": [
    {
      "id": "version-uuid",
      "version": "1.0.0",
      "admission_state": "registered",
      "content_hash": "sha256...",
      "source_id": "source-uuid",
      "commit_sha": "abc123",
      "failure_reasons": [],
      "auto_approved": true,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Sync Templates from Source

```http
POST /sync
Content-Type: application/json

{
  "sourceId": "source-uuid"
}
```

**Response:**
```json
{
  "results": [
    {
      "templateId": "template-1",
      "version": "1.0.0",
      "outcome": "admitted" | "rejected" | "duplicate",
      "admissionState": "validated",
      "failureReasons": []
    }
  ]
}
```

### Validate Version

```http
POST /templates/:id/versions/:version/validate
```

**Response:**
```json
{
  "success": true,
  "failureReasons": []
}
```

### Request Approval

```http
POST /templates/:id/versions/:version/approve
Content-Type: application/json

{
  "note": "Approved by operator"
}
```

**Response:**
```json
{
  "success": true,
  "capabilityProfileId": "profile-uuid"
}
```

### Rollback to Previous Version

```http
POST /templates/:id/rollback
Content-Type: application/json

{
  "version": "1.0.0"
}
```

**Response:**
```json
{
  "success": true,
  "versionId": "version-uuid"
}
```

### Deprecate Template

```http
POST /templates/:id/deprecate
```

**Response:**
```json
{
  "success": true
}
```

### Instantiate Version

```http
POST /templates/:id/versions/:version/instantiate
Content-Type: application/json

{
  "agentId": "agent-uuid",
  "params": {}
}
```

**Response:**
```json
{
  "success": true,
  "agentId": "agent-uuid"
}
```

## Failure Codes

| Code | Description |
|------|-------------|
| `UNKNOWN_CAPABILITY_BUNDLE` | Template references unknown capability bundle |
| `INVALID_FIELD_TYPE` | YAML field has invalid type |
| `UNKNOWN_PLATFORM_PRIMITIVE` | Platform primitive not recognized |
| `LEAST_PRIVILEGE_VIOLATION` | Template exceeds declared capability profile |
| `SECRET_VALUE_PRESENT` | Potential secret detected in sensitive field |
| `DUPLICATE_TEMPLATE_ID` | Same template ID appears multiple times in batch |
| `VERSION_CONFLICT` | Version already exists for this template |
| `UNKNOWN_MCP_SERVER` | MCP server reference not found |
| `UNKNOWN_CREDENTIAL` | Credential reference not found |

## Admission State Machine

```
discovered → validated → pending_approval → registered → active
                                              ↘ deprecated
```

### Valid Transitions

- `discovered` → `validated`
- `validated` → `pending_approval`
- `pending_approval` → `registered`
- `registered` → `active` (via registrar)
- `registered` → `deprecated` (via deprecate endpoint)

## Error Responses

```json
{
  "error": "error message"
}
```

| Status | Description |
|--------|-------------|
| 400 | Bad request (missing required field, invalid state transition) |
| 404 | Resource not found |
| 500 | Internal server error |
