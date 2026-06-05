# Architecture: Launcher Path Deployment

## Overview

The launcher path deployment feature implements **runtime harness container isolation** for PrimeLoop agents. Instead of running agents as local processes, managed local OpenCode agents now run inside isolated containers provisioned by the launcher service.

This document describes the architecture, component interactions, and runtime flow.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PrimeLoop Backend                                  │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  OpenCodeProcessManager                                               │  │
│  │  - Agent lifecycle management                                         │  │
│  │  - Runtime provisioning via launcher (when enabled)                 │  │
│  │  - AcpHarness creation with remote endpoint support                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                              │                                               │
│                              │ HTTP/JSON-RPC                                 │
│                              │ POST /agents                                  │
│                              ▼                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  AcpHarness (with HTTP transport)                                     │  │
│  │  - Manages agent session lifecycle                                    │  │
│  │  - Sends/receives ACP messages over HTTP                              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ HTTP (JSON-RPC)
                                     │
┌────────────────────────────────────▼────────────────────────────────────────┐
│                        Launcher Service                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Runtime Manager                                                      │  │
│  │  - Tracks runtime slots per agent                                     │  │
│  │  - Provisions/restarts/teardown runtimes                              │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                              │                                               │
│                              │ Adapter Interface                             │
│                              ▼                                               │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  Docker/OpenSandbox Adapters                                          │  │
│  │  - Docker: docker run opencode/opencode:latest                        │  │
│  │  - OpenSandbox: API calls to opensandbox:8080                         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ Container Runtime
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    OpenCode Runtime Container                                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  opencode/opencode:latest                                             │  │
│  │  Command: opencode serve --port 8080                                  │  │
│  │  Exposes ACP endpoint at http://<ip>:8080/acp                         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. Backend (`OpenCodeProcessManager`)

**Location:** `backend/src/opencode/process-manager.ts`

**Responsibilities:**
- Agent lifecycle management
- Runtime provisioning via launcher (when enabled)
- AcpHarness creation with remote endpoint support

**Key Methods:**
- `ensureAgentStarted(agentId)` - Ensures agent has a running harness
- `startAcpAgent(agent)` - Starts ACP agent with launcher or local runtime
- `stopAgent(agentId)` - Stops agent and cleans up resources

**Configuration:**
- `LAUNCHER_ENABLED=1` - Enable launcher provisioning
- `EGRESS_SANDBOX=1` - Auto-enable launcher (new default)
- `LAUNCHER_URL=http://launcher:8787` - Launcher service URL

### 2. Launcher Service

**Location:** `backend/src/launcher/`

**Files:**
- `server.ts` - HTTP server with Express routes
- `runtime-manager.ts` - Runtime slot management
- `adapters.ts` - Docker/OpenSandbox adapter implementations
- `auth.ts` - Request authentication
- `health.ts` - Health check and monitoring

**Routes:**
- `POST /agents` - Provision new runtime
- `GET /agents/:agentId` - Inspect runtime status
- `POST /agents/:agentId/restart` - Restart runtime
- `DELETE /agents/:agentId` - Teardown runtime
- `GET /health` - Health check

### 3. Runtime Adapters

**Location:** `backend/src/launcher/adapters.ts`

**Docker Adapter (`kind: 'docker'`):**
- Provisions containers using `docker run`
- Uses `OPENSANDBOX_IMAGE_OPENCODE` env var for image
- Maps container IP to ACP endpoint

**OpenSandbox Adapter (`kind: 'opensandbox'`):**
- Provisions sandboxes via OpenSandbox API
- Supports gVisor/Kata/Firecracker isolation
- Uses `OPENSANDBOX_URL` and `OPENSANDBOX_API_KEY`

### 4. AcpClient with Remote Transport

**Location:** `backend/src/acp/client.ts`

**Transport Types:**
- `stdio` - Local process stdio (legacy)
- `http` - HTTP/JSON-RPC over network (new)

**Key Methods:**
- `start()` - Start local stdio transport
- `startRemote(endpoint)` - Start remote HTTP transport
- `sendRequest(method, params)` - Send JSON-RPC request
- `sendNotification(method, params)` - Send notification

### 5. AcpHarness

**Location:** `backend/src/fleet-executor/acp-harness.ts`

**Responsibilities:**
- Manages agent session lifecycle
- Handles ACP messages and permissions
- Bridges events to backend event system

**Configuration:**
- Accepts optional `remoteEndpoint` parameter
- Uses HTTP transport when endpoint provided

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LAUNCHER_ENABLED` | `0` | Enable launcher provisioning (legacy) |
| `EGRESS_SANDBOX` | `0` | Enable launcher (new default, sets `LAUNCHER_ENABLED`) |
| `LAUNCHER_URL` | `http://launcher:8787` | Launcher service URL |
| `LAUNCHER_AUTH_SECRET` | *required* | Auth token for launcher API |
| `OPENSANDBOX_IMAGE_OPENCODE` | `opencode/opencode:latest` | OpenCode runtime container image |
| `OPENSANDBOX_URL` | `http://opensandbox:8080` | OpenSandbox API URL (for OpenSandbox adapter) |
| `OPENSANDBOX_API_KEY` | *empty* | OpenSandbox API key |

### Docker Compose

**Backend Service:**
```yaml
backend:
  environment:
    LAUNCHER_ENABLED: ${LAUNCHER_ENABLED:-0}
    EGRESS_SANDBOX: ${EGRESS_SANDBOX:-1}  # New default
    LAUNCHER_URL: http://launcher:8787
  depends_on:
    launcher:
      condition: service_started
```

**Launcher Service:**
```yaml
launcher:
  build:
    context: .
    dockerfile: Dockerfile.launcher
  environment:
    LAUNCHER_AUTH_SECRET: ${LAUNCHER_AUTH_SECRET:-change-me-in-production}
    LAUNCHER_PORT: 8787
    LAUNCHER_ADAPTER: docker  # or opensandbox
    OPENSANDBOX_IMAGE_OPENCODE: opencode/opencode:latest
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
```

---

## Runtime Flow

### 1. Agent Startup Request

```
Client → POST /agents/:id/start
         ↓
Backend routes to process-manager
         ↓
ensureAgentStarted(agentId)
```

### 2. Launcher Provisioning Path

```
process-manager.ts checks launcherDefaultEnabled:
  - EGRESS_SANDBOX=1 OR LAUNCHER_ENABLED=1

If enabled:
  1. POST http://launcher:8787/agents
     {
       "agentId": "agent-123",
       "runtimeFamily": "opencode",
       "workdir": "/workspace/repo",
       "env": {...},
       "expectedMounts": [...],
       "networkPolicy": {...}
     }
         ↓
  2. Launcher Docker adapter runs:
     docker run -d --name launcher-agent-123 \
       -v /workspace/repo:/workspace/repo \
       -e AGENT_ID=agent-123 \
       opencode/opencode:latest opencode serve --port 8080
         ↓
  3. Container starts, exposes ACP at http://<ip>:8080/acp
         ↓
  4. Response returned:
     {
       "agentId": "agent-123",
       "acpEndpoint": {
         "protocol": "http",
         "host": "172.18.0.5",
         "port": 8080,
         "path": "/acp"
       },
       "runtimeStatus": {...}
     }
```

### 3. AcpHarness Creation

```
AcpHarness created with remote endpoint:
  new AcpHarness(
    agentId, pool, command, args, workspaceRoot, permissionConfig,
    {
      protocol: 'http',
      host: '172.18.0.5',
      port: 8080,
      path: '/acp'
    }
  )
         ↓
harness.start()
  → client.startRemote(endpoint)
  → HTTP transport initialized
```

### 4. ACP Session Lifecycle

```
initialize()
  → POST http://172.18.0.5:8080/acp
     { jsonrpc: '2.0', id: 1, method: 'initialize', params: {...} }
         ↓
sessionNew()
  → POST http://172.18.0.5:8080/acp
     { jsonrpc: '2.0', id: 2, method: 'session/new', params: {...} }
         ↓
sessionPrompt()
  → POST http://172.18.0.5:8080/acp
     { jsonrpc: '2.0', id: 3, method: 'session/prompt', params: {...} }
         ↓
Agent executes task, sends session updates
  → POST http://172.18.0.5:8080/acp (notifications)
```

### 5. Agent Termination

```
Client → POST /agents/:id/stop
         ↓
process-manager.stopAgent(agentId)
         ↓
harness.close()
  → client.terminate()
         ↓
POST http://launcher:8787/agents/:agentId
  (DELETE to teardown runtime)
         ↓
Docker adapter runs:
  docker stop launcher-agent-123 && docker rm launcher-agent-123
```

---

## Isolation Model

### Container-Level Isolation

Each managed local OpenCode agent runs in its own container with:

1. **Filesystem isolation** - Separate overlay filesystem
2. **Network isolation** - Docker bridge network
3. **Process isolation** - Separate PID namespace
4. **Resource limits** - Can be configured per-container

### Egress Control

When `EGRESS_SANDBOX=1` is enabled:
- Containers have default-deny egress policy
- Only allowed hosts can be accessed
- Configured via `networkPolicy.allowlist`

---

## Troubleshooting

### Common Issues

**1. Launcher unreachable**
```
[process-manager] Failed to provision launcher runtime: ECONNREFUSED
```
- Verify launcher service is running: `docker ps | grep launcher`
- Check `LAUNCHER_URL` matches actual URL
- Ensure backend can reach launcher network

**2. Runtime provisioning fails**
```
[launcher] Docker adapter failed: container not found
```
- Verify Docker daemon is accessible
- Check `OPENSANDBOX_IMAGE_OPENCODE` is valid
- Inspect container logs: `docker logs launcher-agent-<id>`

**3. ACP connection fails**
```
[acp-client] Failed to send request: ECONNREFUSED
```
- Verify container is healthy: `docker inspect launcher-agent-<id>`
- Check container exposes port 8080
- Test endpoint manually: `curl http://<ip>:8080/acp`

**4. Agent stuck in provisioning**
```
Agent status shows "provisioning" indefinitely
```
- Check launcher logs: `docker logs <launcher-container>`
- Verify Docker adapter health: `curl http://localhost:8787/health`
- Inspect runtime: `curl http://localhost:8787/agents/<agentId>`

### Debug Commands

```bash
# Check launcher health
curl http://localhost:8787/health

# List all provisioned runtimes
curl http://localhost:8787/agents

# Inspect specific runtime
curl http://localhost:8787/agents/<agentId>

# Restart failed runtime
curl -X POST http://localhost:8787/agents/<agentId>/restart

# Teardown runtime
curl -X DELETE http://localhost:8787/agents/<agentId>

# Check container status
docker ps | grep launcher-
docker logs launcher-<agentId>
```

---

## Performance Considerations

### Container Startup Time

- First container start: ~5-10s (image pull)
- Subsequent starts: ~1-2s (cached image)

### Network Overhead

- HTTP/JSON-RPC over localhost: negligible
- HTTP/JSON-RPC over network: +1-5ms latency

### Resource Usage

- Each container: ~100-300MB memory
- OpenCode serve process: ~50-100MB CPU

---

## Security Considerations

1. **Authentication** - Launcher requires `LAUNCHER_AUTH_SECRET`
2. **Network isolation** - Default-deny egress policy when enabled
3. **Secret handling** - Credentials injected via environment variables
4. **Container escape** - Docker socket access only in launcher container

---

## Future Enhancements

- [ ] WebSocket transport for ACP (lower latency than HTTP)
- [ ] Kubernetes adapter for cluster deployment
- [ ] GPU passthrough for ML workloads
- [ ] Persistent storage volumes for agent state
- [ ] Network policies per agent (fine-grained egress control)
