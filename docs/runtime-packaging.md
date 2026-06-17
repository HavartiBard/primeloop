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

Configure Git as the catalog source with workspace backup:

```bash
CATALOG_SOURCE_TYPE=git
CATALOG_GIT_URL=https://github.com/org/primeloop-catalog.git
CATALOG_GIT_REF=main
CATALOG_GIT_TOKEN=<pat-with-repo-scope>
WORKSPACE_SYNC_INTERVAL=3600  # Auto-backup workspace every hour (0 to disable)
```

**Important**:
- Container clones catalog repo on startup (includes `workspace/` subdirectory)
- Workspace content syncs from catalog → /workspace on boot
- Operator-authored skills/prompts/policies auto-commit + push to Git hourly
- Agent-created runtime files excluded via .gitignore patterns
- Recovery: single `git clone` restores both catalog AND workspace

##### Required Git Permissions (PAT)

For the installer and runtime to work with the catalog repo:

| Operation | Permission | Scope |
|-----------|------------|-------|
| Clone / Pull catalog on startup | `repo` (full) or `contents:read` | Repository |
| Sync catalog changes (POST `/api/catalog/sync`) | `contents:read` | Repository |
| Auto-backup workspace changes | `contents:write` | Repository |
| Tag versions for rollback | `contents:write` | Repository |

**Minimal PAT scope**:
- Private repos: `repo` (full control) — simplest single-scope option
- Public repos: `public_repo` + `contents:write`

**CATALOG_GIT_TOKEN**: Required for Git mode. Container injects token into HTTPS URL
for authentication. Do NOT use SSH URLs — only HTTPS with PAT is supported.

**Installer flow**:
1. User provides catalog repo URL and PAT
2. Installer validates access by attempting clone
3. Container starts with PAT mounted as env var
4. On startup, container clones catalog repo to `/app/backend/catalog`
5. Operator edits YAML in cloned repo → commits → pushes → sync via API

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

## Installation Flows

### Flow A: Git Catalog Repo (Recommended)

**Prerequisites**:
- Empty Git repo for your catalog (e.g., `yourorg/primeloop-catalog`)
- PAT with `repo` scope (private) or `public_repo` + `contents:write` (public)
- Docker and Docker Compose

**Steps**:

1. **Create catalog repo**
   ```bash
   # Clone PrimeLoop repo for setup files
   git clone <primeloop-repo-url> primeloop
   cd primeloop
   
   # Create empty catalog repo (or fork existing template)
   # Copy starter catalog files (includes workspace/ template)
   cp -r backend/catalog /path/to/your/catalog-repo/
   
   # Optional: Pre-populate workspace content
   mkdir -p /path/to/your/catalog-repo/workspace/skills
   mkdir -p /path/to/your/catalog-repo/workspace/prompts/agents
   mkdir -p /path/to/your/catalog-repo/workspace/policies
   cp backend/prompts/agents/*.md /path/to/your/catalog-repo/workspace/prompts/agents/
   
   git -C /path/to/your/catalog-repo add .
   git -C /path/to/your/catalog-repo commit -m "Initial catalog + workspace template"
   git -C /path/to/your/catalog-repo push origin main
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   
   # Edit .env:
   POSTGRES_PASSWORD=<strong-password>
   SECRET_ENCRYPTION_KEY=$(openssl rand -hex 32)
   CATALOG_SOURCE_TYPE=git
   CATALOG_GIT_URL=https://github.com/yourorg/primeloop-catalog.git
   CATALOG_GIT_REF=main
   CATALOG_GIT_TOKEN=<your-pat-with-repo-scope>  # for Git clone/pull
   GITEA_TOKEN=<your-gitea-token>  # if using Gitea integration
   ```

3. **Mount catalog repo in docker-compose.prod.yml**
   ```yaml
   services:
     backend:
       volumes:
         - /mnt/user/appdata/primeloop/catalog:/app/backend/catalog:rw
       environment:
         CATALOG_GIT_TOKEN: ${CATALOG_GIT_TOKEN}
   ```

4. **Start container**
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

5. **Verify catalog sync**
   ```bash
   # Check startup logs for catalog clone success
   docker compose logs backend | grep catalog
   
   # POST /api/catalog/sync to register templates
   curl -X POST http://localhost:3100/api/catalog/sync \
     -H "Content-Type: application/json" \
     -d '{"sourceId": "default-local"}'
   ```

### Flow B: Local Volume Mount (Single-Host)

**Prerequisites**:
- Host directory for catalog storage
- Manual catalog file management

**Steps**:

1. **Create catalog directory**
   ```bash
   mkdir -p /mnt/user/appdata/primeloop/catalog
   cp backend/catalog/*.yaml /mnt/user/appdata/primeloop/catalog/
   ```

2. **Mount in docker-compose.prod.yml** (already configured)
   ```yaml
   volumes:
     - /mnt/user/appdata/primeloop/catalog:/app/backend/catalog:ro
   ```

3. **Edit catalog files on host**
   ```bash
   vi /mnt/user/appdata/primeloop/catalog/architect.yaml
   ```

4. **Sync changes**
   ```bash
   # Restart container to re-read files
   docker compose -f docker-compose.prod.yml restart backend
   
   # OR POST /api/catalog/sync if local source is configured
   curl -X POST http://localhost:3100/api/catalog/sync -d '{"sourceId": "default-local"}'
   ```

## Verification Checklist

Before production deployment, verify:

- [ ] PostgreSQL data volume is mounted and persistent
- [ ] CATALOG_GIT_TOKEN set (Git mode) or catalog dir exists (local mode)
- [ ] Git PAT has `repo` scope + `contents:write` for workspace auto-backup
- [ ] WORKSPACE_SYNC_INTERVAL configured (0 to disable auto-sync)
- [ ] Workspace path is writable and outside container
- [ ] No hardcoded paths in `docker-compose.prod.yml` that point to container-only locations
- [ ] Environment variables for catalog source are set correctly
- [ ] Startup logs show "catalog startup validation: status: OK" (no ephemeral warnings)

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
