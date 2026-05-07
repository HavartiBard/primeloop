# OpenCode Agent Runtime Integration

**Date:** 2026-05-07
**Status:** Draft — awaiting user approval

---

## Overview

This document covers three tightly coupled additions to the agent control plane:

1. **Encryption at rest** for all provider credentials (applies to existing codex keys too)
2. **OpenCode agent runtime** — per-agent `opencode serve` processes with git worktree isolation
3. **Agent-to-agent communication** — all inter-agent work routed through the control plane for full auditability

---

## 1. Encryption Layer

### Motivation

API keys currently stored in the `providers` table are plaintext. Any database dump or direct Postgres access exposes all credentials. This change encrypts all keys at rest, allowing safe UI entry without sacrificing security.

### Mechanism

AES-256-GCM symmetric encryption with a master key stored outside the database.

**New env var (added to `docker-compose.prod.yml`):**
```
SECRET_ENCRYPTION_KEY=<64-char hex string, generated once with openssl rand -hex 32>
```

**Backend utility** (`backend/src/crypto.ts`):
- `encrypt(plaintext: string): string` — returns `iv:authTag:ciphertext` (all hex)
- `decrypt(ciphertext: string): string` — reverses the above
- Both functions read `process.env.SECRET_ENCRYPTION_KEY` at call time

**Storage:** The encrypted string is stored in the existing `api_key` column. The format `iv:authTag:ciphertext` is self-describing, so encrypted and unencrypted values can be distinguished during the migration.

**API behaviour:**
- `GET /api/providers` — returns `api_key: "••••••••"` (masked), never plaintext
- `POST /api/providers` / `PUT /api/providers/:id` — accepts plaintext, encrypts before write
- Backend decrypts only at the point of use (spawning a process, injecting env var)

**Migration:** A one-time migration script (`backend/src/migrations/encrypt-existing-keys.ts`) reads all providers with non-null `api_key`, encrypts each, and writes back. Run once on deploy.

---

## 2. Database Changes

### `providers` table

Add one column:

```sql
ALTER TABLE providers ADD COLUMN model TEXT;
```

Used by `llm` provider type to store the model identifier (e.g. `anthropic/claude-sonnet-4-5`).

### `agents` table (registry)

Add two columns:

```sql
ALTER TABLE agents ADD COLUMN local_port INTEGER;
ALTER TABLE agents ADD COLUMN worktree_path TEXT;
```

- `local_port`: auto-assigned from pool starting at 4200, stored at registration time
- `worktree_path`: absolute path inside the container (e.g. `/workspace/agents/<name>`)

### New `agent_tokens` table

```sql
CREATE TABLE agent_tokens (
  agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  token     TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Each agent gets a unique bearer token used to authenticate control plane tool calls. Generated at registration, rotated on request.

---

## 3. Provider Types

The `type` column on `providers` now supports three values:

| Type | Purpose | Key fields |
|------|---------|------------|
| `codex` | Codex app-server (existing) | `base_url`, `api_key` (optional) |
| `llm` | LLM provider for OpenCode agents | `model`, `api_key` |
| `hermes` | External remote agent node (future) | `base_url`, `api_key` |

`llm` providers represent a single model at a single provider (Anthropic, OpenAI, a custom proxy). `base_url` is optional — if set, it overrides the default API endpoint (useful for LiteLLM or other OpenAI-compatible proxies).

---

## 4. OpenCode Process Manager

### Responsibilities

`backend/src/opencode/ProcessManager.ts` — singleton, owns all per-agent `opencode serve` processes.

**Lifecycle:**
- **App start**: query all enabled opencode agents, start a process for each
- **Agent enabled**: start process, create worktree if missing
- **Agent disabled / deleted**: kill process, optionally remove worktree
- **Process crash**: log, mark agent unhealthy in `agent_heartbeat`, attempt restart with exponential backoff (3 attempts, then give up)

### Port Allocation

- Pool starts at 4200
- On agent registration, the backend queries `SELECT MAX(local_port) FROM agents WHERE local_port IS NOT NULL` and assigns `max + 1` (or 4200 if none)
- Port stored in `agents.local_port`, never changes after assignment
- Ports are not reclaimed on delete (prevents reuse confusion)

### Process Spawn

```typescript
spawn('opencode', ['serve', '--port', String(agent.local_port)], {
  cwd: agent.worktree_path,
  env: {
    ...process.env,
    [providerEnvVar]: decrypt(provider.api_key), // e.g. ANTHROPIC_API_KEY
    CONTROL_PLANE_URL: 'http://localhost:3000',
    CONTROL_PLANE_AGENT_TOKEN: agentToken,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

### opencode.json

Written to the worktree root at agent creation/update:

```json
{
  "model": "anthropic/claude-sonnet-4-5"
}
```

If `provider.base_url` is set (custom proxy), an additional provider override is written per OpenCode's config schema.

### Readiness Check

After spawn, the manager polls `GET http://localhost:<port>/health` (or equivalent) at 500ms intervals, up to 10s, before marking the agent ready. Delegations are queued until ready.

---

## 5. Git Worktree Management

### Base Repository

The host mounts a git repository into the container at `/workspace/repo`. This is the shared codebase all agents collaborate on.

**Compose addition:**
```yaml
volumes:
  - /mnt/user/appdata/agent-cp/workspace:/workspace/repo
```

### Per-Agent Worktrees

On agent creation, the process manager runs:
```bash
git -C /workspace/repo worktree add /workspace/agents/<agent-name> -b agent/<agent-name>
```

On agent deletion:
```bash
git -C /workspace/repo worktree remove /workspace/agents/<agent-name> --force
```

Worktree path stored in `agents.worktree_path`. If the worktree already exists at startup (e.g. after container restart), the manager skips creation.

---

## 6. Delegation Adapter

`backend/src/opencode/Adapter.ts` — handles routing a single delegation to an OpenCode agent.

### Flow

```
Control plane assigns delegation
  → Adapter.execute(delegation, agent)
    → POST /session          (create session — CWD already set at spawn)
    → POST /session/{id}/message  (send prompt built from work item)
    → GET /event (SSE stream)
        message.part.delta   → append to delegation.trace[]
        permission.asked     → route to approval system (see §7)
        session.status=complete → resolve, write result to delegation
        session.status=error    → reject, mark delegation failed
```

### Prompt Construction

The prompt sent to OpenCode includes:
- Work item title and description
- Relevant context (thread history if available)
- Explicit instruction to use control plane tools for any sub-delegation or approval needs

### Trace Storage

Each `message.part.delta` chunk is appended to `delegations.trace` (JSONB array) via an `UPDATE ... || jsonb_build_array(...)` to avoid full rewrites.

---

## 7. Agent-to-Agent Communication

All inter-agent communication is brokered by the control plane. Agents never call each other directly.

### Control Plane Tools

Each OpenCode session receives a set of tools implemented as HTTP calls to the control plane, authenticated with the agent's bearer token.

**Tool definitions injected into OpenCode config:**

| Tool | Purpose |
|------|---------|
| `delegate_to_agent` | Route a sub-task to another agent by capability |
| `request_peer_review` | Ask another agent to review output |
| `request_approval` | Escalate a decision to chief or human |
| `resolve_approval` | (Chief agent only) approve or deny a pending approval |
| `update_work_item` | Update status/notes on the current work item |

### `delegate_to_agent`

```
POST /api/agent-tools/delegate
Authorization: Bearer <agent_token>
{
  "capability": "code-review",
  "prompt": "Review this diff: ...",
  "context": { ... }
}
```

The control plane:
1. Finds the best available agent with the requested capability
2. Creates a child delegation record linked to the parent
3. Dispatches to that agent's adapter
4. Waits (long-poll, up to 5 min) for completion
5. Returns the result to the calling agent

The full chain (parent delegation → child delegation → grandchild) is visible in the portal with all trace entries linked.

### `request_peer_review`

Shorthand for `delegate_to_agent` with capability `peer-review`. The reviewing agent receives the content and returns structured feedback (approve / request-changes + comments).

### `request_approval`

```
POST /api/agent-tools/approval
Authorization: Bearer <agent_token>
{
  "action": "deploy to production",
  "context": { ... },
  "approver": "chief" | "human" | <agent_id>
}
```

Creates a record in the `approvals` table. If approver is `human`, it surfaces in the portal approvals UI. If approver is `chief`, it routes to the chief agent's delegation queue. The calling agent blocks until resolved.

### Chief of Staff

The chief can be configured as either:
- A **human** — approvals require manual portal action
- An **OpenCode agent** with `capabilities: ["chief", "approval"]` — approval requests are routed as delegations to the chief agent, who reasons over them and calls `resolve_approval` tool

Both use the same `approvals` table. The portal shows who resolved each approval (human user or agent ID).

---

## 8. UI Changes

### Providers Page

- New `llm` provider type option in the create form
- `model` field appears when type = `llm` (text input, e.g. `anthropic/claude-sonnet-4-5`)
- `api_key` field: on create shows plaintext input; after save shows `••••••••` + "Replace" button
- "Replace" opens a small inline form to enter a new key — submits to `PUT /api/providers/:id`
- Same masking applied to existing codex providers
- `base_url` label changes to "API Proxy URL (optional)" for `llm` type

### Agents Page

- `runtime_family` dropdown adds `opencode` option
- Selecting an `llm` provider auto-populates:
  - `runtime_family: 'opencode'`
  - `execution_mode: 'local'`
  - `local_port: <next available>` (fetched from backend)
  - `worktree_path: /workspace/agents/<name>` (derived from agent name)
- Auto-filled fields shown with green "auto" badge (same pattern as codex)
- Agent table gains a **Status** badge: `running` (green) / `stopped` (gray) / `error` (red), polled from process manager health endpoint
- Endpoint column shows `localhost:<port>` for opencode agents

### Compose

```yaml
# docker-compose.prod.yml additions
environment:
  - SECRET_ENCRYPTION_KEY=${SECRET_ENCRYPTION_KEY}
volumes:
  - /mnt/user/appdata/agent-cp/workspace:/workspace/repo
  - /mnt/user/appdata/agent-cp/worktrees:/workspace/agents
```

---

## 9. Installation

`opencode` CLI must be present in the container image.

**Dockerfile addition:**
```dockerfile
RUN npm install -g opencode@latest
```

---

## 10. Non-Goals (This Iteration)

- Hermes (external node) integration — architecture is defined, implementation is a separate spec
- Worktree branch reconciliation / PR creation — agents create branches; merging is manual for now
- Multi-turn session resume after backend restart — sessions restart fresh; history is in the trace log
- Rate limiting / quota enforcement on control plane tools

---

## Open Questions

None — all design decisions resolved.
