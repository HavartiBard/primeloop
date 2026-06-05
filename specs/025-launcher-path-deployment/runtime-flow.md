# Runtime Flow: Agent Execution Lifecycle

This document describes the complete lifecycle of a managed local OpenCode agent, from provisioning to termination.

---

## Overview

When `EGRESS_SANDBOX=1` (or `LAUNCHER_ENABLED=1`), managed local OpenCode agents execute in isolated containers provisioned by the launcher service.

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Agent Lifecycle Flow                              │
├──────────────────────────────────────────────────────────────────────┤
│ 1. Agent Creation → Registry Entry                                  │
│ 2. Agent Start Request → Backend                                    │
│ 3. Process Manager → Launcher Provisioning                          │
│ 4. Container Start → OpenCode Serve                                 │
│ 5. AcpHarness Connect → Remote ACP Endpoint                         │
│ 6. Session Lifecycle → Task Execution                               │
│ 7. Agent Stop → Teardown Container                                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Flow

### Phase 1: Agent Creation

**API:** `POST /agents`

```json
{
  "name": "my-agent",
  "type": "opencode",
  "runtime_family": "opencode",
  "execution_mode": "local",
  "enabled": true,
  "system_prompt": "You are a helpful assistant.",
  "soul": "You love helping users."
}
```

**Registry Update:**
```sql
INSERT INTO agents (
  id, name, type, runtime_family, execution_mode, enabled
) VALUES (
  'agent-uuid-123', 'my-agent', 'opencode', 'opencode', 'local', true
);
```

---

### Phase 2: Agent Start Request

**API:** `POST /agents/:id/start`

```bash
curl -X POST http://localhost:3100/agents/agent-uuid-123/start
```

**Backend Route:**
```typescript
// backend/src/routes/agents.ts
router.post('/:id/start', async (req, res) => {
  const agent = await getAgent(pool, req.params.id);
  await processManager.ensureAgentStarted(agent.id);
  res.json({ status: 'started' });
});
```

---

### Phase 3: Process Manager Intervention

**Location:** `backend/src/opencode/process-manager.ts`

```typescript
async ensureAgentStarted(agentId: string): Promise<void> {
  const agent = await this.getAgent(agentId);
  
  if (agent.runtime_family === 'opencode') {
    await this.startAcpAgent(agent);
  }
}
```

**Launcher Detection:**
```typescript
if (this.launcherDefaultEnabled) {
  // EGRESS_SANDBOX=1 or LAUNCHER_ENABLED=1
  await this.provisionWithLauncher(agent);
} else {
  await this.provisionLocally(agent);
}
```

---

### Phase 4: Launcher Provisioning

**API Call to Launcher:**
```typescript
const launcherClient = createLauncherClient(this.launcherUrl);
const result = await launcherClient.provisionRuntime({
  agentId: agent.id,
  runtimeFamily: 'opencode',
  workdir: workspaceRoot,
  env: {
    AGENT_ID: agent.id,
    WORKDIR: workspaceRoot,
    RUNTIME_FAMILY: 'opencode',
  },
  expectedMounts: [
    { path: workspaceRoot, mode: 'rw', purpose: 'worktree' },
    { path: '/tmp/launcher-scratch', mode: 'rw', purpose: 'scratch' },
  ],
  networkPolicy: { mode: 'default-deny', allowlist: [] },
});
```

**Launcher Response:**
```json
{
  "agentId": "agent-uuid-123",
  "acpEndpoint": {
    "protocol": "http",
    "host": "172.18.0.5",
    "port": 8080,
    "path": "/acp"
  },
  "runtimeStatus": {
    "state": "ready",
    "healthStatus": "healthy",
    "containerIdentity": "launcher-agent-uuid-123"
  }
}
```

---

### Phase 5: Container Provisioning (Docker Adapter)

**Adapter Code:** `backend/src/launcher/adapters.ts`

```typescript
async provision(input: AdapterProvisionInput): Promise<AdapterRuntimeState> {
  const containerIdentity = `launcher-${input.agentId}`;
  const runtimeImage = input.runtimeImage ?? 'opencode/opencode:latest';
  
  // Build docker run command
  const mountFlags = input.mounts.map(m => `-v "${m.path}:${m.path}"`).join(' ');
  const envFlags = Object.entries(input.env)
    .map(([k, v]) => `-e ${k}="${v}"`)
    .join(' ');
  
  await execPromise(
    `docker run -d --name ${containerIdentity} ${mountFlags} ${envFlags} ${runtimeImage}`
  );
  
  return {
    containerIdentity,
    sessionEndpoint: `http://${containerIdentity}:8080`,
    healthStatus: 'healthy',
    mounts: input.mounts,
    networkPolicy: input.networkPolicy,
  };
}
```

**Container Start:**
```bash
docker run -d --name launcher-agent-uuid-123 \
  -v /workspace/repo:/workspace/repo \
  -v /tmp/launcher-scratch:/tmp/launcher-scratch \
  -e AGENT_ID=agent-uuid-123 \
  -e WORKDIR=/workspace/repo \
  -e RUNTIME_FAMILY=opencode \
  opencode/opencode:latest opencode serve --port 8080
```

**Container Health Check:**
```bash
# Wait for ACP endpoint to be ready
curl http://172.18.0.5:8080/health
```

---

### Phase 6: AcpHarness Creation

**Backend Code:**
```typescript
const harness = new AcpHarness(
  agent.id,
  this.pool,
  command,        // 'acp-agent'
  args,           // []
  workspaceRoot,
  permissionConfig,
  {
    protocol: 'http',
    host: '172.18.0.5',
    port: 8080,
    path: '/acp',
  }
);

await harness.start({
  cwd: workspaceRoot,
  model: { providerID: 'openai', id: 'gpt-4' },
});
```

**AcpHarness Start:**
```typescript
async start(opts: { cwd: string; model: ModelRef }): Promise<void> {
  if (this.isRemote()) {
    await this.client.startRemote(this.remoteEndpoint);
  } else {
    await this.client.start();
  }
  
  await this.client.initialize({
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    clientInfo: { name: 'primeloop', version: '0.1.0' },
  });
}
```

---

### Phase 7: ACP Session Lifecycle

**Initialize:**
```typescript
await client.initialize({
  protocolVersion: 1,
  clientCapabilities: {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: false,
  },
  clientInfo: { name: 'primeloop', version: '0.1.0' },
});
```

**Create Session:**
```typescript
await client.sessionNew({
  cwd: '/workspace/repo',
  mcpServers: [],
});
// Returns: { sessionId: 'session-xyz-789' }
```

**Prompt (Task Execution):**
```typescript
await client.sessionPrompt({
  sessionId: 'session-xyz-789',
  prompt: [{ type: 'text', text: 'What is the weather in London?' }],
});
// Returns: { stopReason: 'stop' }
```

**Session Updates:**
```json
// Agent sends notifications to backend
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "session-xyz-789",
    "update": {
      "type": "message_create",
      "message": { "role": "assistant", "content": "The weather in London is..." }
    }
  }
}
```

---

### Phase 8: Agent Termination

**API:** `POST /agents/:id/stop`

```bash
curl -X POST http://localhost:3100/agents/agent-uuid-123/stop
```

**Backend Handler:**
```typescript
async stopAgent(agentId: string): Promise<void> {
  const harness = this.harnesses.get(agentId);
  if (harness) {
    await harness.close();
    this.harnesses.delete(agentId);
  }
  
  // Teardown runtime via launcher
  const launcherClient = createLauncherClient(this.launcherUrl);
  await launcherClient.teardownRuntime(agentId);
}
```

**AcpHarness Close:**
```typescript
async close(): Promise<void> {
  if (this.client) {
    await this.client.terminate();
  }
  this.sessionId = null;
}
```

**Launcher Teardown:**
```typescript
await client.delete(`/agents/${agentId}`);
```

**Docker Adapter Teardown:**
```typescript
async teardown(containerIdentity: string): Promise<void> {
  await execPromise(`docker stop ${containerIdentity} > /dev/null 2>&1 || true`);
  await execPromise(`docker rm ${containerIdentity} > /dev/null 2>&1 || true`);
}
```

---

## Recovery Flow

### Backend Restart

**Location:** `backend/src/recovery/restart.ts`

```typescript
async function reconcileLauncherRuntime(
  pool: pg.Pool,
  agentId: string,
  launcherStatus: any | null
): Promise<void> {
  if (!launcherStatus) {
    // Runtime not found in launcher
    await recordLauncherRecoveryOutcome(pool, agentId, 'backend_restart', 'unavailable', 'Runtime not found');
    return;
  }
  
  if (launcherStatus.state === 'ready') {
    // Reattach to existing session
    const harness = processManager.getRunningHarness(agentId);
    await harness.wake(launcherStatus.sessionId);
    await recordLauncherRecoveryOutcome(pool, agentId, 'backend_restart', 'reattached');
  }
}
```

### Container Restart

**API:** `POST /agents/:id/restart`

```bash
curl -X POST http://localhost:3100/agents/agent-uuid-123/restart
```

**Process Manager:**
```typescript
await launcherClient.restartRuntime(agentId);
// Container recreated, new ACP endpoint returned
```

---

## Performance Metrics

### Timing (typical values)

| Phase | Duration |
|-------|----------|
| Agent creation | ~50ms |
| Launcher provisioning | ~200ms |
| Container start (cached) | ~1-2s |
| Container start (pull) | ~10-15s |
| ACP initialize | ~100ms |
| Session new | ~50ms |
| Task execution | Variable |

### Resource Usage

| Component | Memory | CPU |
|-----------|--------|-----|
| OpenCode serve | ~100-200MB | ~5-10% |
| Container overhead | ~50MB | ~1-2% |
| Total per agent | ~150-250MB | ~6-12% |

---

## Monitoring

### Health Check Endpoints

```bash
# Backend health
curl http://localhost:3100/health

# Launcher health
curl http://localhost:8787/health

# Runtime status
curl http://localhost:8787/agents/agent-uuid-123

# Container status
docker inspect launcher-agent-uuid-123
```

### Logs

```bash
# Backend logs
docker-compose logs -f backend | grep process-manager

# Launcher logs
docker-compose logs -f launcher | grep runtime-manager

# Container logs
docker logs launcher-agent-uuid-123
```

---

## Error Handling

### Provisioning Failure

```json
// Response on failure
{
  "error": "Failed to provision runtime",
  "details": "Container failed to start: image not found"
}
```

**Recovery:**
- Check `OPENSANDBOX_IMAGE_OPENCODE` is valid
- Verify Docker daemon is accessible
- Inspect container logs for errors

### ACP Connection Failure

```json
// Response on failure
{
  "error": "Failed to connect to ACP endpoint",
  "details": "ECONNREFUSED 172.18.0.5:8080"
}
```

**Recovery:**
- Verify container is running: `docker ps | grep launcher-`
- Check container health: `curl http://<ip>:8080/health`
- Inspect container logs for startup errors

---

## Summary

The runtime flow ensures:

1. **Isolation** - Each agent runs in its own container
2. **Lifecycle Management** - Automatic provisioning and teardown
3. **Remote ACP** - Communication over HTTP/JSON-RPC
4. **Recovery** - Backend restart reconciliation
5. **Monitoring** - Health checks and status reporting
