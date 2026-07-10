# Setup Guide: Launcher Path Deployment

> **⚠️ Internal / stale.** This is a spec-time design document for the
> opt-in launcher path (off by default), not install instructions. Parts are
> outdated — `LANGGRAPH_API_URL` is *not* required, and paths reference the
> author's machine. For installing PrimeLoop, see the top-level
> [README](../../README.md).

This guide walks through setting up the launcher path deployment for PrimeLoop agents.

## Prerequisites

- Docker Engine 24.0+
- Docker Compose v2.20+
- Node.js 20.x or later
- PostgreSQL 16+

---

## Quick Start

### 1. Clone and Prepare

```bash
cd /home/james/projects/primeloop

# Create environment file
cp .env.example .env
```

### 2. Configure Environment

Edit `.env` with the following required settings:

```bash
# Database (required)
DATABASE_URL=postgresql://primeloop:your_password@postgres:5432/primeloop

# Launcher configuration
LAUNCHER_AUTH_SECRET=change-me-in-production-use-a-random-secure-string

# Runtime isolation (new default)
EGRESS_SANDBOX=1
LAUNCHER_ENABLED=1

# OpenCode runtime image
OPENSANDBOX_IMAGE_OPENCODE=opencode/opencode:latest

# LangGraph API (required)
LANGGRAPH_API_URL=http://langgraph-agent:8000
```

### 3. Start Services

```bash
# Build and start all services
docker-compose up -d --build

# Verify services are healthy
docker-compose ps
docker-compose logs -f backend
```

### 4. Create a Managed Local OpenCode Agent

```bash
# Using the API
curl -X POST http://localhost:3100/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-agent",
    "type": "opencode",
    "runtime_family": "opencode",
    "execution_mode": "local",
    "enabled": true,
    "system_prompt": "You are a helpful assistant.",
    "soul": "You love helping users."
  }'
```

### 5. Verify Agent Runs in Isolated Container

```bash
# List provisioned runtimes
curl http://localhost:8787/agents

# Should show your agent with acpEndpoint
# {
#   "agent-123": {
#     "acpEndpoint": {
#       "protocol": "http",
#       "host": "172.18.0.5",
#       "port": 8080,
#       "path": "/acp"
#     },
#     "state": "ready"
#   }
# }

# Check container is running
docker ps | grep launcher-
```

---

## Detailed Setup

### Option A: Docker Adapter (Default)

Uses Docker directly to provision containers.

**Configuration:**
```bash
LAUNCHER_ADAPTER=docker
OPENSANDBOX_IMAGE_OPENCODE=opencode/opencode:latest
```

**Requirements:**
- Docker socket accessible to launcher container
- Network access between backend and launcher

### Option B: OpenSandbox Adapter (Production)

Uses OpenSandbox for stronger isolation.

**Configuration:**
```bash
LAUNCHER_ADAPTER=opensandbox
OPENSANDBOX_URL=http://opensandbox:8080
OPENSANDBOX_API_KEY=your-api-key
OPENSANDBOX_IMAGE_OPENCODE=opencode/opencode:latest
```

**Requirements:**
- OpenSandbox service running
- API key configured in OpenSandbox

---

## Development Setup

### Using docker-compose.dev.yml

```bash
# Start development environment
docker-compose -f docker-compose.dev.yml up -d

# Verify services
docker-compose -f docker-compose.dev.yml ps
```

**Development-specific settings:**
- `LAUNCHER_AUTH_SECRET=change-me-in-development`
- `EGRESS_SANDBOX=1` (enabled by default)
- Volume mounts for persistent workspace

---

## Verification Checklist

After setup, verify:

- [ ] Launcher service running: `docker ps | grep launcher`
- [ ] Backend can reach launcher: `curl http://localhost:8787/health`
- [ ] Launcher returns healthy status
- [ ] Create test agent → container provisioned
- [ ] Agent runs in isolated container (not local process)
- [ ] ACP endpoint accessible from backend

---

## Troubleshooting Setup Issues

### Launcher won't start

```bash
# Check logs
docker-compose logs launcher

# Verify Docker socket mount
docker-compose config | grep docker.sock
```

### Backend can't reach launcher

```bash
# Check network connectivity
docker exec primeloop-backend_1 curl http://launcher:8787/health

# Verify both containers on same network
docker network inspect primeloop_default
```

### Agent provisioning fails

```bash
# Check launcher logs for adapter errors
docker-compose logs launcher | grep -i error

# Test Docker adapter directly
docker run --rm opencode/opencode:latest opencode version
```

### ACP connection fails

```bash
# Get container IP
docker inspect launcher-agent-<id> | grep IPAddress

# Test ACP endpoint manually
curl http://<ip>:8080/acp -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

---

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `LAUNCHER_AUTH_SECRET` | Yes | - | Auth token for launcher API |
| `LANGGRAPH_API_URL` | Yes | - | LangGraph API endpoint |
| `EGRESS_SANDBOX` | No | `0` | Enable launcher (new default) |
| `LAUNCHER_ENABLED` | No | `0` | Enable launcher (legacy) |
| `LAUNCHER_URL` | No | `http://launcher:8787` | Launcher service URL |
| `LAUNCHER_PORT` | No | `8787` | Launcher service port |
| `LAUNCHER_ADAPTER` | No | `docker` | Adapter type (docker/opensandbox) |
| `OPENSANDBOX_IMAGE_OPENCODE` | No | `opencode/opencode:latest` | OpenCode runtime image |
| `OPENSANDBOX_URL` | No | `http://opensandbox:8080` | OpenSandbox API URL |
| `OPENSANDBOX_API_KEY` | No | - | OpenSandbox API key |

### Docker Compose Override

Create `docker-compose.override.yml` for custom settings:

```yaml
services:
  launcher:
    environment:
      LAUNCHER_AUTH_SECRET: ${LAUNCHER_AUTH_SECRET}
      LAUNCHER_PORT: "8787"
      LAUNCHER_ADAPTER: docker
      OPENSANDBOX_IMAGE_OPENCODE: opencode/opencode:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./workspace:/workspace

  backend:
    environment:
      LAUNCHER_ENABLED: "1"
      EGRESS_SANDBOX: "1"
      LAUNCHER_URL: http://launcher:8787
```

---

## Next Steps

After setup:

1. **Create agents** - Use API or UI to create managed local OpenCode agents
2. **Monitor runtimes** - Check `/agents` endpoint for provisioned runtimes
3. **View logs** - Agent logs in container stdout: `docker logs launcher-<id>`
4. **Configure permissions** - Set up permission policies for agent tools

---

## Updating Configuration

To change settings:

```bash
# Update environment file
nano .env

# Restart services
docker-compose down
docker-compose up -d --build
```

**Note:** Changing `LAUNCHER_ADAPTER` requires backend restart.
