# Agent Runtime & Intelligence Layer Design

**Date:** 2026-05-07
**Status:** Ready for implementation

---

## Overview

This spec covers the full agent runtime and intelligence layer for the control plane:

1. **Encryption at rest** — AES-256-GCM for all provider credentials
2. **OpenCode agent runtime** — per-agent `opencode serve` processes with git worktree isolation
3. **MCP registry & agent profiles** — built-in MCP server management, no external Director dependency
4. **SoulLayer-PG** — forked SoulLayer with Postgres+pgvector backend for agent soul, memory, and lessons
5. **Agent-to-agent communication** — all inter-agent work routed through the control plane for full auditability
6. **Prime agent** — fleet coordinator with cross-agent learning visibility

---

## Terminology

| Term | Meaning |
|------|---------|
| **Prime** | The fleet coordinator agent (formerly "chief of staff"). Routes work, approves escalations, synthesizes fleet learning. |
| **Agent** | A worker agent (OpenCode, Codex, or future Hermes) with its own worktree, soul, and memory |
| **Playbook** | An agent's assigned MCP servers + profile. Replaced by the built-in MCP registry. |
| **Pattern** | A Prime-published best practice or antipattern derived from fleet-wide lesson analysis |

---

## 1. Encryption at Rest

### Motivation

API keys in the `providers` table are currently plaintext. This change encrypts all credentials at rest while keeping UI entry convenient.

### Mechanism

AES-256-GCM symmetric encryption with a master key stored outside the database.

**New env var:**
```
SECRET_ENCRYPTION_KEY=<64-char hex, generated once: openssl rand -hex 32>
```

**Backend utility** `backend/src/crypto.ts`:
- `encrypt(plaintext: string): string` → `iv:authTag:ciphertext` (hex)
- `decrypt(ciphertext: string): string` → reverses above
- Both read `process.env.SECRET_ENCRYPTION_KEY` at call time

**API behaviour:**
- `GET /api/providers` returns `api_key: "••••••••"` — never plaintext
- `POST`/`PUT` providers accept plaintext, encrypt before write
- Decryption only at point of use (spawning processes, injecting env vars)

**Migration:** `backend/src/migrations/encrypt-existing-keys.ts` — one-time script to encrypt all existing plaintext keys. Run on first deploy.

---

## 2. Database Changes

### `providers` table

```sql
ALTER TABLE providers ADD COLUMN model TEXT;
```

Used by `llm` provider type to store model identifier (e.g. `anthropic/claude-sonnet-4-5`).

### `agents` table

```sql
ALTER TABLE agents ADD COLUMN local_port    INTEGER;
ALTER TABLE agents ADD COLUMN worktree_path TEXT;
ALTER TABLE agents ADD COLUMN system_prompt TEXT;
ALTER TABLE agents ADD COLUMN soul          TEXT;
```

- `local_port` — auto-assigned from pool starting at 4200
- `worktree_path` — e.g. `/workspace/agents/<name>`
- `system_prompt` — agent operating instructions, written to `AGENTS.md`
- `soul` — agent identity/values, written to `soul.md`

### `agent_tokens` table

```sql
CREATE TABLE agent_tokens (
  agent_id   UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  token      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Bearer tokens for control plane tool authentication.

### `mcp_servers` table

```sql
CREATE TABLE mcp_servers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  type        TEXT NOT NULL CHECK (type IN ('http', 'stdio')),
  url         TEXT,
  command     TEXT,
  args        TEXT[],
  env_vars    JSONB,          -- encrypted values
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### `agent_mcp_assignments` table

```sql
CREATE TABLE agent_mcp_assignments (
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  mcp_server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
  PRIMARY KEY (agent_id, mcp_server_id)
);
```

### `agent_patterns` table

Prime-published best practices and antipatterns shared across the fleet.

```sql
CREATE TABLE agent_patterns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         TEXT NOT NULL CHECK (type IN ('best_practice', 'antipattern')),
  content      TEXT NOT NULL,
  severity     TEXT DEFAULT 'info',
  source_agent_id UUID REFERENCES agents(id),
  published_by    UUID REFERENCES agents(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_pattern_assignments (
  pattern_id UUID NOT NULL REFERENCES agent_patterns(id) ON DELETE CASCADE,
  agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  PRIMARY KEY (pattern_id, agent_id)
);
```

### pgvector tables (agent memory)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE agent_memories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  category   TEXT,
  tags       TEXT[],
  importance INT DEFAULT 3,
  embedding  vector(384),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_lessons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  context    TEXT,
  category   TEXT,
  severity   TEXT DEFAULT 'info',
  embedding  vector(384),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX ON agent_memories USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON agent_lessons  USING ivfflat (embedding vector_cosine_ops);
```

---

## 3. Provider Types

| Type | Purpose | Key fields |
|------|---------|------------|
| `codex` | Codex app-server | `base_url`, `api_key` (encrypted) |
| `llm` | LLM provider for OpenCode agents | `model`, `api_key` (encrypted), `base_url` (optional proxy) |
| `hermes` | External remote agent node (future) | `base_url`, `api_key` (encrypted) |

---

## 4. OpenCode Process Manager

`backend/src/opencode/ProcessManager.ts` — singleton owning all per-agent `opencode serve` processes.

### Lifecycle

- **App start** — query all enabled opencode agents, start each
- **Agent enabled** — create worktree if missing, write config files, start process
- **Agent disabled/deleted** — kill process, optionally remove worktree
- **Process crash** — mark unhealthy, retry with exponential backoff (3 attempts)

### Port Allocation

Pool starts at 4200. On registration: `SELECT MAX(local_port) FROM agents WHERE local_port IS NOT NULL` → assign `max + 1`. Ports are never reclaimed.

### Process Spawn

```typescript
spawn('opencode', ['serve', '--port', String(agent.local_port)], {
  cwd: agent.worktree_path,
  env: {
    ...process.env,
    [providerEnvVar]: decrypt(provider.api_key),
    POSTGRES_URL: process.env.POSTGRES_URL,
    CONTROL_PLANE_URL: 'http://localhost:3000',
    CONTROL_PLANE_AGENT_TOKEN: agentToken,
    SOULLAYER_AGENT_ID: agent.id,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

### Readiness Check

Poll `GET http://localhost:<port>/health` at 500ms intervals, up to 10s before marking ready.

---

## 5. Git Worktree Management

### Base Repository

Host mounts the shared codebase into the container:

```yaml
# docker-compose.prod.yml
volumes:
  - /mnt/user/appdata/agent-cp/workspace:/workspace/repo
  - /mnt/user/appdata/agent-cp/agents:/workspace/agents
```

### Per-Agent Worktrees

**On agent creation:**
```bash
git -C /workspace/repo worktree add /workspace/agents/<name> -b agent/<name>
```

**On agent deletion:**
```bash
git -C /workspace/repo worktree remove /workspace/agents/<name> --force
```

If the worktree already exists at startup (container restart), creation is skipped.

---

## 6. Agent Config Files

The process manager writes these files to each agent's worktree at creation and on profile update:

| File | Source | Notes |
|------|--------|-------|
| `AGENTS.md` | `agents.system_prompt` | Operating instructions |
| `soul.md` | `agents.soul` | Identity and values (read by SoulLayer) |
| `TOOLS.md` | Auto-generated | Lists all assigned MCP servers and their tools |
| `opencode.json` | Generated | Model config + MCP server list |
| `soullayer.json` | Generated | Points SoulLayer at Postgres |

**`TOOLS.md` example (auto-generated):**
```markdown
# Tools Available

## Control Plane (built-in)
- delegate_to_agent — route a sub-task to another agent
- request_approval — escalate a decision to Prime or human
- request_peer_review — ask another agent to review output
- update_work_item — update status/notes on current work item
- save_memory — store a memory or lesson to the fleet DB

## Gitea
- create_pull_request, create_issue, get_pull_request, ...

## Slack
- post_message, list_channels, ...
```

**`opencode.json` example:**
```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "mcpServers": {
    "control-plane": {
      "type": "stdio",
      "command": "node",
      "args": ["/app/backend/dist/mcp/server.js"],
      "env": {
        "CONTROL_PLANE_AGENT_TOKEN": "<token>"
      }
    },
    "soullayer": {
      "type": "stdio",
      "command": "soullayer-pg",
      "env": {
        "POSTGRES_URL": "<url>",
        "SOULLAYER_AGENT_ID": "<agent-id>"
      }
    },
    "gitea": {
      "type": "http",
      "url": "http://gitea:3000/mcp"
    }
  }
}
```

---

## 7. MCP Registry

The portal manages available MCP servers in the `mcp_servers` table. No external Director dependency.

### Built-in MCP Servers (auto-assigned to all agents)

Two MCP servers are always included — no manual assignment needed:

1. **Control Plane MCP** (`backend/src/mcp/server.ts`) — exposes control plane tools
2. **SoulLayer-PG** (`packages/soullayer-pg`) — soul, memory, and lessons

### External MCP Servers (user-configured)

Registered in the portal's **MCP Servers** page. Examples:
- Gitea MCP (HTTP, `http://gitea:3000/mcp`)
- GitHub MCP (HTTP)
- Slack MCP (HTTP or stdio)
- Custom internal tools (stdio)

`env_vars` on MCP server records stores auth tokens (encrypted at rest, same mechanism as provider keys).

### Agent Profile

The agent form gains an **MCP Servers** section — checkboxes from the registry. Selected servers are stored in `agent_mcp_assignments` and included in the generated `opencode.json`.

---

## 8. SoulLayer-PG

A fork of [SoulLayer](https://github.com/phoenix0700/soullayer) maintained at `packages/soullayer-pg`. The only change: swap the SQLite storage adapter for Postgres + pgvector.

### Why fork rather than use upstream

SoulLayer's semantic search (cosine similarity via Xenova embeddings) is retained — the embedding model runs locally in the SoulLayer process. Only storage is redirected to Postgres so all agent data lives in one place.

### Configuration

`soullayer.json` written to each agent's worktree:
```json
{
  "soulFile": "soul.md",
  "transport": "stdio",
  "postgres": {
    "agentId": "<uuid>"
  }
}
```

`POSTGRES_URL` is passed as an env var at spawn.

### Tools provided to agents

| Tool | Purpose |
|------|---------|
| `soul_read` | Read own soul.md |
| `soul_update` | Update soul.md (append/merge/replace) |
| `memory_store` | Persist a memory with tags, importance, category |
| `memory_search` | Semantic search own memories |
| `memory_timeline` | Chronological memory retrieval |
| `lessons_log` | Record a lesson with context and severity |
| `lessons_check` | Query past lessons relevant to current situation |
| `context_get` | Assemble soul + memories + lessons into token-budgeted context |

---

## 9. Control Plane MCP Server

`backend/src/mcp/server.ts` — stdio MCP server exposing control plane tools to agents.

### Standard tools (all agents)

| Tool | Purpose |
|------|---------|
| `delegate_to_agent` | Route a sub-task to another agent by capability |
| `request_peer_review` | Ask another agent to review output |
| `request_approval` | Escalate a decision to Prime or human |
| `update_work_item` | Update status/notes on current work item |

### Prime-only tools

| Tool | Purpose |
|------|---------|
| `query_fleet_learnings` | Semantic search across ALL agents' memories and lessons |
| `publish_pattern` | Broadcast a best practice or antipattern to agents |
| `update_agent_soul` | Modify another agent's soul.md |
| `resolve_approval` | Approve or deny a pending approval |

Prime-only tools reject requests from non-Prime agent tokens with a 403.

### `query_fleet_learnings`

Runs pgvector cosine similarity across the entire fleet:
```sql
SELECT m.content, m.category, a.name AS agent_name, m.importance
FROM agent_memories m JOIN agents a ON m.agent_id = a.id
ORDER BY m.embedding <=> $1
LIMIT 20;
```

### `publish_pattern`

Creates an `agent_patterns` record and optionally assigns it to specific agents (or all agents if `target_agents` is omitted). Assigned patterns are injected into each agent's `MEMORY.md` at next delegation start.

---

## 10. Agent-to-Agent Communication

All inter-agent communication routes through the control plane. Agents never call each other directly. Every hop creates a delegation record — the full chain is visible in the portal.

### `delegate_to_agent` flow

```
Agent A calls delegate_to_agent(capability, prompt)
  → Control plane finds best agent with that capability
  → Creates child delegation record linked to parent
  → Dispatches to target agent's OpenCode adapter
  → Long-polls (up to 5 min) for completion
  → Returns result to Agent A
```

### PR-based approvals

When an agent creates a PR via the Gitea MCP (`create_pull_request`), it returns the PR URL to the control plane via `request_approval` with the PR URL in context. The approval record in Postgres links to the PR. Resolution can happen via:
- Human merging/approving the PR on Gitea
- Prime reviewing via `resolve_approval`

The control plane polls the Gitea API for PR status and auto-resolves the approval on merge.

### `request_approval` flow

```
POST /api/agent-tools/approval
{ "action": "...", "context": { "pr_url": "..." }, "approver": "prime" | "human" | <agent_id> }
```

- `human` → surfaces in portal Approvals UI
- `prime` → routes as a delegation to the Prime agent
- `<agent_id>` → routes as a peer review delegation

---

## 11. Prime Agent

The Prime is an OpenCode agent configured with elevated capabilities: `capabilities: ["prime", "approval", "peer-review"]`.

### Prime's additional visibility

- **Fleet Intelligence** tab in portal — aggregated lessons and memories across all agents
- **Pattern Library** — best practices and antipatterns published to the fleet, with source agent lineage
- **Memory Explorer** — drill into any individual agent's memories and lessons

### Cross-agent learning loop

```
Agent encounters a situation → logs lesson via lessons_log
  → Stored in agent_lessons table (Postgres)
Prime runs periodic audit → calls query_fleet_learnings
  → Identifies common patterns, repeated mistakes
  → Calls publish_pattern → creates agent_patterns record
At next delegation start for each agent:
  → MEMORY.md regenerated including assigned patterns
  → Agent benefits from fleet-wide experience
```

---

## 12. Delegation Adapter

`backend/src/opencode/Adapter.ts` — handles routing a delegation to an OpenCode agent.

### Flow

```
Control plane assigns delegation → Adapter.execute(delegation, agent)
  → POST http://localhost:<port>/session
  → POST /session/{id}/message  (prompt from work item)
  → GET /event (SSE stream)
      message.part.delta   → append to delegation.trace[]
      permission.asked     → route to approvals system
      session.status=complete → mark delegation done
      session.status=error    → mark delegation failed
```

### Session start context injection

Before posting the prompt, the adapter calls SoulLayer's `context_get` equivalent by querying Postgres directly and prepending:
- Agent's assigned Prime-published patterns
- Recent high-importance memories
- Recent high-severity lessons

This ensures agents start each delegation with relevant fleet knowledge.

---

## 13. UI Changes

### Navigation additions

- **MCP Servers** page — register and configure external MCP servers
- **Playbooks** renamed to **Agent Profiles** — now part of the Agents form

### Providers page

- `llm` type with `model` field and optional `base_url` (proxy)
- All `api_key` fields masked after save, "Replace" button to update
- Encryption applied to existing codex keys via migration

### Agents page

- `opencode` runtime family option
- Selecting an `llm` provider auto-populates runtime_family, execution_mode, local_port, worktree_path
- **Profile** section: `system_prompt` (textarea → `AGENTS.md`), `soul` (textarea → `soul.md`)
- **MCP Servers** section: checkbox list from registry
- Process status badge: `running` / `stopped` / `error`

### MCP Servers page

- List all registered MCP servers
- Create: name, type (http/stdio), url/command, env vars (encrypted)
- Shows which agents are assigned each server

### Prime dashboard (new)

- **Fleet Intelligence** tab: query fleet memories/lessons, pattern library
- Per-pattern: which agents it's been published to, source lineage
- **Memory Explorer**: per-agent memory and lesson browser with semantic search

---

## 14. Dockerfile additions

```dockerfile
RUN npm install -g opencode@latest
RUN npm install -g soullayer-pg   # our fork, published to local registry or installed from path
```

---

## 15. docker-compose.prod.yml additions

```yaml
environment:
  - SECRET_ENCRYPTION_KEY=${SECRET_ENCRYPTION_KEY}
volumes:
  - /mnt/user/appdata/agent-cp/workspace:/workspace/repo
  - /mnt/user/appdata/agent-cp/agents:/workspace/agents
```

---

## 16. Non-Goals (This Iteration)

- **Hermes** (external node) — architecture defined, implementation is a separate spec
- **Worktree branch reconciliation / PR merging** — agents create branches; merging is manual
- **Multi-turn session resume after backend restart** — sessions restart fresh; history in trace log
- **Rate limiting on control plane tools**
- **Vector search tuning** — ivfflat index with defaults; tune `lists` parameter after data accumulates
