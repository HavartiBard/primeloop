# Agent Catalog Documentation

## Overview

The Agent Catalog manages agent templates through their admission lifecycle:
- **discovered** → **validated** → **pending_approval** → **registered** → **active/deprecated**

## Quick Start

1. Add YAML template to `backend/catalog/`
2. Sync from local source: `POST /api/catalog/sync`
3. Validate: `POST /api/catalog/templates/:id/versions/:v/validate`
4. Approve: `POST /api/catalog/templates/:id/versions/:v/approve`
5. Instantiate: `POST /api/catalog/templates/:id/versions/:v/instantiate`

## Documentation

- [API Reference](./API_REFERENCE.md) - All REST endpoints and failure codes
- [Operational Guide](./OPERATIONAL_GUIDE.md) - Common tasks and troubleshooting
- [Testing Guide](./TESTING.md) - Test structure and running tests

## Architecture

See `specs/026-agent-catalog/architecture.md` for detailed architecture.

## Related Specs

- `specs/025-launcher-path-deployment/` - Runtime launcher deployment
- `specs/026-agent-catalog/` - Agent catalog feature spec
