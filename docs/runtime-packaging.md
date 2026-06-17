# Runtime Packaging and Growth Boundaries

This document describes PrimeLoop's container model, durable storage requirements, and growth boundaries for safe self-improvement.

## Core Model

### Disposable Container Payload

The PrimeLoop container image is **disposable** — it contains:
- Application code (`backend/src/`, `web/`)
- Static assets and templates
- Default catalog YAML drafts (`backend/catalog/`)

**The container filesystem is NOT durable storage.** Any writes to the container filesystem are lost on restart.

### Durable State Locations

All persistent state must live outside the container:

| Data Type | Storage Location | Managed By |
|-----------|------------------|------------|
| **Database** | PostgreSQL (volume-mounted) | Operator / Docker Compose |
| **Agent Workspace** | Host path (configured via `agent_workspace_config`) | Agent reads/writes, operator manages path |
| **Catalog YAML** | Host path (volume-mounted) or Git repo | Operator edits + catalog approval workflow |
| **Runtime State** | PostgreSQL (`agents`, `runtime_*` tables) | Application |
| **Work Items / Delegation State** | PostgreSQL (`work_items`, `delegations`) | Application |
| **Thread Messages / Memories** | PostgreSQL (`threads`, `memories`) | Application |

## Catalog Storage Requirements

The agent catalog (`backend/catalog/*.yaml`) is the **authoritative source for agent templates**. It must be durable storage.

### Supported Modes

#### Mode 1: Local Volume Mount (Recommended for Single-Host)

Mount a host directory to `/app/backend/catalog` in the container:

```yaml
# docker-compose.prod.yml
services:
  backend:
    volumes:
      - /mnt/user/appdata/primeloop/catalog:/app/backend/catalog:ro
```

**Important**: 
- The mount should be read-only (`:ro`) — catalog changes require approval workflow, not direct writes
- Create the host directory before starting the container
- Agent template changes follow this flow:
  1. Edit YAML files on the host (outside container)
  2. POST `/api/catalog/sync` to register new versions
  3. Approve versions via catalog state machine

#### Mode 2: Git Source (Recommended for Multi-Host/CI)

Configure Git as the catalog source:

```bash
CATALOG_SOURCE_TYPE=git
CATALOG_GIT_URL=https://github.com/org/primeloop-catalog.git
CATALOG_GIT_REF=main
```

**Important**:
- Container reads from Git working tree, no local writes
- Changes require Git push + catalog sync + approval

### Startup Validation

On startup, PrimeLoop validates catalog configuration:

- If `CATALOG_SOURCE_TYPE=local` and the path is inside the app root, a warning is logged
- If `CATALOG_SOURCE_TYPE=git`, the `CATALOG_GIT_URL` environment variable is required
- The service starts regardless but warns about ephemeral storage risks

## Self-Improvement Boundaries

### What PrimeLoop Can Modify

| Surface | How | Requires Approval |
|---------|-----|-------------------|
| **Agent Templates** | Catalog workflow (new version → approval) | Yes, for high-risk changes |
| **Workspace Files** | `writeWorkspaceFile()` API | No (operator-managed path) |
| **Prime Config** | Database updates via setup wizard | No |
| **Work Item State** | Queue / event loop | No |

### What PrimeLoop Cannot Modify

| Surface | Why |
|---------|-----|
| **Application Code (`backend/src/`)** | Container filesystem is ephemeral; changes lost on restart |
| **Catalog YAML (registered versions)** | Catalog state machine creates new versions, doesn't mutate |
| **Database Schema** | Migrations are code-deploy only |

### Safe Self-Improvement Patterns

1. **Agent Capability Evolution**:
   - Agent proposes catalog template change
   - New version created in catalog
   - Human approval required before activation
   - Running agents unaffected until new version approved + instantiated

2. **Workspace Customization**:
   - Agent writes skills, prompts, policies to workspace
   - Workspace path is durable (host-managed)
   - Changes persist across restarts
   - Operator can review/edit workspace files directly

3. **Configuration Updates**:
   - Prime config updates via setup wizard or API
   - Stored in database (durable)
   - Takes effect on next event loop run

## Verification Checklist

Before production deployment, verify:

- [ ] PostgreSQL data volume is mounted and persistent
- [ ] Catalog directory is volume-mounted (local mode) OR Git URL is configured
- [ ] Workspace path is writable and outside container
- [ ] No hardcoded paths in `docker-compose.prod.yml` that point to container-only locations
- [ ] Environment variables for catalog source are set correctly

## Troubleshooting

### "Catalog is using ephemeral storage" Warning

**Symptom**: Startup log shows warning about ephemeral catalog storage

**Cause**: Catalog path is inside app root without volume mount

**Fix**: 
1. Create host directory: `mkdir -p /mnt/user/appdata/primeloop/catalog`
2. Copy existing YAML files: `cp backend/catalog/*.yaml /mnt/user/appdata/primeloop/catalog/`
3. Update `docker-compose.prod.yml` to mount the volume
4. Restart container

### "no catalog source configured" Error

**Symptom**: POST `/api/catalog/sync` returns "no catalog source configured"

**Cause**: Database seed didn't create default source or source was deleted

**Fix**:
1. Check sources: `SELECT * FROM catalog_sources;`
2. Re-insert default: 
   ```sql
   INSERT INTO catalog_sources (kind, name, location, enabled)
   VALUES ('local', 'default-local', 'backend/catalog', true)
   ON CONFLICT (name) DO NOTHING;
   ```
