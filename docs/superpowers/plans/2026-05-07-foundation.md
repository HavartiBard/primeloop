# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the data and security foundation that all subsequent plans depend on: AES-256-GCM encryption at rest for credentials, new DB schema columns and tables (agent profiles, MCP registry, pgvector memory), and updated provider/agent UI with LLM provider type and profile fields.

**Architecture:** A `crypto.ts` module encrypts/decrypts using a master key from env. All `api_key` fields pass through it on write; on read, the API returns `"••••••••"` and never exposes plaintext. New DB columns are added via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in the existing `runMigrations()`. New tables for MCP server registry and pgvector memory are also added here so all plans share a common schema baseline.

**Tech Stack:** Node.js `node:crypto` (AES-256-GCM), Postgres 16 + pgvector (`pgvector/pgvector:pg16` image), TypeScript, Vitest, React + Tailwind

---

## Five-Plan Overview

This is **Plan 1 of 5**. Plans are independent and build on this foundation:

| Plan | Scope |
|------|-------|
| **1 — Foundation** (this) | Crypto, DB schema, provider/agent API + UI |
| **2 — OpenCode Runtime** | Process manager, git worktrees, config files, delegation adapter |
| **3 — MCP Registry + CP MCP Server** | MCP server CRUD, control plane tools, agent-to-agent |
| **4 — Native Memory & Learning Layer** | SoulLayer/Octopoda-inspired memory tools, context assembly, loop detection, portal memory views |
| **5 — Prime & Fleet Intelligence** | Cross-agent learning, pattern library, Prime-only tools, Fleet UI |

### Plan 4 Breakdown

Plan 4 is no longer “fork SoulLayer.” It is a native control-plane implementation that borrows:
- **SoulLayer** concepts for soul files, memories, lessons, and context assembly
- **Octopoda** concepts for loop detection, snapshots, recovery, and observability

The system of record remains the existing Postgres schema in this repo.

---

## Plan 4: Native Memory & Learning Layer

**Goal:** Build the missing memory, lesson, context, and loop-detection capabilities directly into the control plane so agents can persist and retrieve durable working knowledge without introducing a second runtime or storage boundary.

**Architecture:** The control plane exposes memory-oriented MCP tools, stores all state in `agent_memories` / `agent_lessons` / `agent_patterns`, assembles context before delegations, and surfaces loop/stall signals in the backend and portal. Embedding generation and ranking can begin with deterministic fallbacks and lexical retrieval, then upgrade to semantic retrieval once the embedding path is in place.

**Tech Stack:** TypeScript, Postgres + pgvector, existing MCP server (`backend/src/mcp/server.ts`), existing OpenCode runtime manager, React portal views

### File Map

**Create:**
- `backend/src/memory-service.ts` — native memory/lesson CRUD, ranking, and context assembly
- `backend/src/loop-detector.ts` — repeated-failure / stall heuristics over runtime events + delegations
- `backend/tests/memory-service.test.ts`
- `backend/tests/loop-detector.test.ts`

**Modify:**
- `backend/src/mcp/service.ts` — implement memory-native tools (`soul_read`, `soul_update`, `memory_store`, `memory_search`, `memory_timeline`, `lessons_log`, `lessons_check`, `context_get`, `loop_check`, `snapshot_create`)
- `backend/src/delegation-runner.ts` — write richer memory/lesson events around runs
- `backend/src/opencode/process-manager.ts` — include memory-tool metadata in generated workspace artifacts
- `backend/src/routes/runtime.ts` — add API endpoints for per-agent learnings, snapshots, and loop warnings
- `backend/src/fleet-intelligence.ts` — expand ranking/query support for memory and lessons
- `web/src/api.ts` — fetch loop warnings, per-agent learnings, and snapshot data
- `web/src/types.ts` — add loop-warning / snapshot / agent-learning types
- `web/src/pages/Governance.tsx` — add loop monitor and memory explorer panels
- `web/src/pages/Agents.tsx` — optional per-agent memory/lesson summary

### Task 1: Native memory service

- [ ] Implement `backend/src/memory-service.ts`
- [ ] Add `storeMemory(agentId, input)`
- [ ] Add `storeLesson(agentId, input)`
- [ ] Add `searchMemories(agentId, query, options)`
- [ ] Add `listMemoryTimeline(agentId, options)`
- [ ] Add `checkLessons(agentId, query, options)`
- [ ] Add `assembleContext(agentId, options)` combining:
  - soul
  - assigned patterns
  - recent high-importance memories
  - recent high-severity lessons
- [ ] Start with lexical + recency ranking if embeddings are not available yet
- [ ] Add tests for store/search/timeline/context assembly

### Task 2: MCP memory tools

- [ ] Extend `backend/src/mcp/service.ts` with:
  - `soul_read`
  - `soul_update`
  - `memory_store`
  - `memory_search`
  - `memory_timeline`
  - `lessons_log`
  - `lessons_check`
  - `context_get`
  - `loop_check`
  - `snapshot_create`
- [ ] Add input/output schemas for all new tools
- [ ] Reuse the native memory service instead of direct SQL inside the tool handlers
- [ ] Add focused MCP tests for the new tools

### Task 3: Loop detection

- [ ] Implement `backend/src/loop-detector.ts`
- [ ] Detect:
  - repeated failed delegations for the same capability/agent pair
  - repeated nearly-identical prompts over a short time window
  - rapid retries with no meaningful new output
  - approval churn for the same action/work item
- [ ] Emit normalized loop warning objects with:
  - `agent_id`
  - `kind`
  - `severity`
  - `summary`
  - `evidence`
  - `created_at`
- [ ] Add `loop_check` MCP tool backed by this module
- [ ] Add tests for repeated-failure and retry/stall cases

### Task 4: Snapshots and recovery scaffolding

- [ ] Decide whether snapshots live in a new `agent_snapshots` table or in `artifacts`
- [ ] Implement `snapshot_create` as a compact persisted checkpoint of:
  - current soul hash/version
  - selected context payload
  - current work item / delegation linkage
  - recent warnings
- [ ] Expose snapshot listing via runtime API
- [ ] Keep restore/resume out of scope for this iteration unless trivial

### Task 5: Runtime and portal integration

- [ ] Update runtime routes to expose:
  - per-agent memories
  - per-agent lessons
  - loop warnings
  - snapshots
- [ ] Add Governance panels for:
  - loop monitor
  - memory explorer
  - recent snapshots
- [ ] Reuse existing Fleet Intelligence views where possible instead of inventing parallel screens

### Task 6: Retrieval quality upgrade path

- [ ] Keep the first implementation operational without requiring embeddings
- [ ] Define the embedding hook behind a narrow interface so it can be added later
- [ ] When embeddings are added:
  - populate `agent_memories.embedding`
  - populate `agent_lessons.embedding`
  - use pgvector similarity in `memory_search`, `lessons_check`, and `query_fleet_learnings`

### Task 7: Verification

- [ ] `cd backend && npm test -- tests/memory-service.test.ts tests/loop-detector.test.ts tests/mcp/service.test.ts`
- [ ] `cd backend && npm run build`
- [ ] `cd web && npm run build`
- [ ] If DB-backed tests are stable, add coverage for new runtime routes and per-agent memory APIs

---

## File Map

**Create:**
- `backend/src/crypto.ts` — encrypt/decrypt/isEncrypted
- `backend/src/migrations/encrypt-existing-keys.ts` — one-time migration script
- `backend/tests/crypto.test.ts` — crypto unit tests

**Modify:**
- `backend/src/db.ts` — add new columns and tables to `runMigrations()`
- `backend/src/registry.ts` — Provider/RegistryAgent types + encrypt/decrypt in CRUD
- `backend/tests/providers.route.test.ts` — assert key masking behaviour
- `web/src/types.ts` — add `model` to Provider, new fields to RegistryAgent
- `web/src/api.ts` — add `replaceProviderKey`
- `web/src/pages/Providers.tsx` — `llm` type, model field, masked key + Replace button
- `web/src/pages/Agents.tsx` — Profile section (system_prompt, soul)

**Infrastructure:**
- `docker-compose.prod.yml` — swap Postgres image + add `SECRET_ENCRYPTION_KEY`
- `docker-compose.test.yml` — swap Postgres image

---

## Task 1: Swap Postgres image to pgvector

The `vector` extension is not in `postgres:16-alpine`. Switch both compose files to `pgvector/pgvector:pg16`.

**Files:**
- Modify: `docker-compose.prod.yml`
- Modify: `docker-compose.test.yml`

- [ ] **Step 1: Update prod compose**

In `docker-compose.prod.yml`, change the postgres service image and add the encryption key env var:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16      # was postgres:16-alpine
    environment:
      POSTGRES_DB: agent_cp
      POSTGRES_USER: agent_cp
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}
    volumes:
      - /mnt/user/appdata/agent-cp/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "agent_cp"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    image: code.klsll.com/havartibard/agent-control-plane:latest
    volumes:
      - /mnt/user/appdata/agent-cp/codex:/root/.codex
    environment:
      DATABASE_URL: postgresql://agent_cp:${POSTGRES_PASSWORD}@postgres:5432/agent_cp
      SECRET_ENCRYPTION_KEY: ${SECRET_ENCRYPTION_KEY:?required}
      LANGGRAPH_API_URL: ${LANGGRAPH_API_URL:?required}
      RACLETTE_API_URL: ${RACLETTE_API_URL:-http://192.168.20.169:9119}
      RACLETTE_SESSION_TOKEN: ${RACLETTE_SESSION_TOKEN:-}
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN:-}
      SLACK_APP_TOKEN: ${SLACK_APP_TOKEN:-}
      SLACK_CHANNEL_ID: ${SLACK_CHANNEL_ID:-C0AU0620ATX}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
    ports:
      - "3100:3100"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
```

- [ ] **Step 2: Update test compose**

In `docker-compose.test.yml`, change image only:

```yaml
services:
  postgres-test:
    image: pgvector/pgvector:pg16      # was postgres:16-alpine
    environment:
      POSTGRES_DB: agent_cp_test
      POSTGRES_USER: agent_cp
      POSTGRES_PASSWORD: agent_cp_test
    ports:
      - "55432:5432"
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "agent_cp", "-d", "agent_cp_test"]
      interval: 2s
      timeout: 2s
      retries: 15
```

- [ ] **Step 3: Generate the master encryption key**

Run once locally, save the output to your `.env` file as `SECRET_ENCRYPTION_KEY`:

```bash
openssl rand -hex 32
```

Expected: a 64-character hex string like `3f8a2b...`

Add it to your `.env`:
```
SECRET_ENCRYPTION_KEY=<output from above>
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.prod.yml docker-compose.test.yml
git commit -m "infra: switch postgres to pgvector image, add SECRET_ENCRYPTION_KEY env"
```

---

## Task 2: Crypto utility

**Files:**
- Create: `backend/src/crypto.ts`
- Create: `backend/tests/crypto.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/crypto.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { encrypt, decrypt, isEncrypted } from '../src/crypto.js'

const TEST_KEY = 'a'.repeat(64)

describe('crypto', () => {
  beforeEach(() => { vi.stubEnv('SECRET_ENCRYPTION_KEY', TEST_KEY) })
  afterEach(() => { vi.unstubAllEnvs() })

  it('encrypt/decrypt roundtrip preserves plaintext', () => {
    const plain = 'sk-ant-api03-super-secret'
    expect(decrypt(encrypt(plain))).toBe(plain)
  })

  it('produces different ciphertext each call due to random IV', () => {
    const a = encrypt('same')
    const b = encrypt('same')
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe('same')
    expect(decrypt(b)).toBe('same')
  })

  it('ciphertext has three colon-separated hex segments', () => {
    const parts = encrypt('test').split(':')
    expect(parts).toHaveLength(3)
    expect(parts.every(p => /^[0-9a-f]+$/.test(p))).toBe(true)
  })

  it('isEncrypted returns true for encrypted values', () => {
    expect(isEncrypted(encrypt('hello'))).toBe(true)
  })

  it('isEncrypted returns false for plaintext API keys', () => {
    expect(isEncrypted('sk-ant-api03-plaintext')).toBe(false)
    expect(isEncrypted('')).toBe(false)
  })

  it('throws when SECRET_ENCRYPTION_KEY is missing', () => {
    vi.stubEnv('SECRET_ENCRYPTION_KEY', '')
    expect(() => encrypt('test')).toThrow('SECRET_ENCRYPTION_KEY')
  })

  it('throws when SECRET_ENCRYPTION_KEY is wrong length', () => {
    vi.stubEnv('SECRET_ENCRYPTION_KEY', 'tooshort')
    expect(() => encrypt('test')).toThrow('SECRET_ENCRYPTION_KEY')
  })

  it('throws on tampered ciphertext', () => {
    const parts = encrypt('test').split(':')
    parts[2] = 'deadbeef'
    expect(() => decrypt(parts.join(':'))).toThrow()
  })

  it('throws on malformed ciphertext', () => {
    expect(() => decrypt('notvalid')).toThrow('invalid ciphertext format')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd backend && npm test -- tests/crypto.test.ts
```

Expected: `Cannot find module '../src/crypto.js'`

- [ ] **Step 3: Implement `backend/src/crypto.ts`**

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function getKey(): Buffer {
  const hex = process.env.SECRET_ENCRYPTION_KEY
  if (!hex || hex.length !== 64) {
    throw new Error('SECRET_ENCRYPTION_KEY must be a 64-char hex string (run: openssl rand -hex 32)')
  }
  return Buffer.from(hex, 'hex')
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), ct.toString('hex')].join(':')
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('invalid ciphertext format')
  const [ivHex, tagHex, ctHex] = parts
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const pt = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()])
  return pt.toString('utf8')
}

export function isEncrypted(value: string): boolean {
  if (!value) return false
  const parts = value.split(':')
  return parts.length === 3 && parts.every(p => /^[0-9a-f]+$/.test(p))
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd backend && npm test -- tests/crypto.test.ts
```

Expected: `8 tests passed`

- [ ] **Step 5: Commit**

```bash
git add backend/src/crypto.ts backend/tests/crypto.test.ts
git commit -m "feat: add AES-256-GCM crypto utility for credential encryption"
```

---

## Task 3: DB schema additions

All new columns and tables are added to the existing `runMigrations()` in `backend/src/db.ts`. Using `IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` makes every run idempotent.

**Files:**
- Modify: `backend/src/db.ts`

- [ ] **Step 1: Add new migrations to `runMigrations()`**

In `backend/src/db.ts`, append to the end of the SQL string inside `runMigrations()`, just before the closing backtick:

```sql
    -- Provider: LLM model field
    ALTER TABLE providers ADD COLUMN IF NOT EXISTS model TEXT;

    -- Agent: OpenCode runtime fields
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS local_port    INTEGER;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS worktree_path TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS system_prompt TEXT;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS soul          TEXT;

    -- Agent bearer tokens for control plane tool auth
    CREATE TABLE IF NOT EXISTS agent_tokens (
      agent_id   UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      token      TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    -- MCP server registry
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL UNIQUE,
      description TEXT,
      type        TEXT NOT NULL CHECK (type IN ('http', 'stdio')),
      url         TEXT,
      command     TEXT,
      args        TEXT[],
      env_vars    JSONB,
      created_at  TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_mcp_assignments (
      agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      mcp_server_id UUID NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
      PRIMARY KEY (agent_id, mcp_server_id)
    );

    -- Prime-published patterns (best practices / antipatterns)
    CREATE TABLE IF NOT EXISTS agent_patterns (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type            TEXT NOT NULL CHECK (type IN ('best_practice', 'antipattern')),
      content         TEXT NOT NULL,
      severity        TEXT DEFAULT 'info',
      source_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
      published_by    UUID REFERENCES agents(id) ON DELETE SET NULL,
      created_at      TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_pattern_assignments (
      pattern_id UUID NOT NULL REFERENCES agent_patterns(id) ON DELETE CASCADE,
      agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      PRIMARY KEY (pattern_id, agent_id)
    );

    -- pgvector: native agent memory and lessons
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS agent_memories (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      content    TEXT NOT NULL,
      category   TEXT,
      tags       TEXT[],
      importance INT DEFAULT 3,
      embedding  vector(384),
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS agent_lessons (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      content    TEXT NOT NULL,
      context    TEXT,
      category   TEXT,
      severity   TEXT DEFAULT 'info',
      embedding  vector(384),
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_agent_memories_embedding
      ON agent_memories USING hnsw (embedding vector_cosine_ops);

    CREATE INDEX IF NOT EXISTS idx_agent_lessons_embedding
      ON agent_lessons USING hnsw (embedding vector_cosine_ops);
```

- [ ] **Step 2: Restart the test DB with the new pgvector image**

```bash
cd /path/to/project
npm run test:db:down
# edit docker-compose.test.yml if not done in Task 1
npm run test:db:up
```

Wait for health check: `docker compose -f docker-compose.test.yml ps` should show `healthy`.

- [ ] **Step 3: Run the DB migration test**

```bash
cd backend && npm run test:db -- tests/db.test.ts
```

Expected: all existing DB tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db.ts
git commit -m "feat: add pgvector memory tables, MCP registry, and agent profile columns"
```

---

## Task 4: Provider registry — encryption + `llm` type

**Files:**
- Modify: `backend/src/registry.ts`

- [ ] **Step 1: Update the `Provider` interface in `registry.ts`**

Replace the existing `Provider` interface:

```typescript
export interface Provider {
  id: string
  name: string
  type: string
  base_url: string
  api_key?: string   // always "••••••••" in API responses; undefined if never set
  model?: string     // for llm type
  created_at: string
}
```

- [ ] **Step 2: Add crypto import at the top of `registry.ts`**

```typescript
import { encrypt, decrypt, isEncrypted } from './crypto.js'
```

- [ ] **Step 3: Update `listProviders` to mask keys**

```typescript
export async function listProviders(pool: pg.Pool): Promise<Provider[]> {
  const { rows } = await pool.query('SELECT * FROM providers ORDER BY created_at')
  return rows.map(r => ({
    ...r,
    api_key: r.api_key ? '••••••••' : undefined,
  }))
}
```

- [ ] **Step 4: Update `insertProvider` to encrypt key and accept `model`**

```typescript
export async function insertProvider(
  pool: pg.Pool,
  data: Omit<Provider, 'id' | 'created_at'>
): Promise<Provider> {
  const encryptedKey = data.api_key ? encrypt(data.api_key) : null
  const { rows } = await pool.query(
    'INSERT INTO providers (name, type, base_url, api_key, model) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [data.name, data.type, data.base_url, encryptedKey, data.model ?? null]
  )
  return { ...rows[0], api_key: rows[0].api_key ? '••••••••' : undefined }
}
```

- [ ] **Step 5: Update `updateProvider` to encrypt key and accept `model`**

```typescript
export async function updateProvider(
  pool: pg.Pool,
  id: string,
  data: Partial<Omit<Provider, 'id' | 'created_at'>>
): Promise<Provider> {
  const encryptedKey = data.api_key ? encrypt(data.api_key) : undefined
  const { rows } = await pool.query(
    `UPDATE providers SET
      name     = COALESCE($2, name),
      type     = COALESCE($3, type),
      base_url = COALESCE($4, base_url),
      model    = COALESCE($5, model),
      api_key  = CASE WHEN $6::boolean THEN $7 ELSE api_key END
    WHERE id = $1 RETURNING *`,
    [
      id,
      data.name ?? null,
      data.type ?? null,
      data.base_url ?? null,
      data.model ?? null,
      'api_key' in data,
      encryptedKey ?? null,
    ]
  )
  return { ...rows[0], api_key: rows[0].api_key ? '••••••••' : undefined }
}
```

- [ ] **Step 6: Add `getProviderApiKey` for internal use (decrypts for process spawning)**

Append to `registry.ts`:

```typescript
export async function getProviderApiKey(pool: pg.Pool, id: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT api_key FROM providers WHERE id = $1', [id])
  if (!rows[0] || !rows[0].api_key) return null
  return isEncrypted(rows[0].api_key) ? decrypt(rows[0].api_key) : rows[0].api_key
}
```

- [ ] **Step 7: Update the providers route test**

In `backend/tests/providers.route.test.ts`, add `SECRET_ENCRYPTION_KEY` to env before tests and assert masking:

Add at the top of the file (after imports):
```typescript
import { vi } from 'vitest'

// Required for crypto module
process.env.SECRET_ENCRYPTION_KEY = 'a'.repeat(64)
```

Add a new test after the existing `POST /` creates a provider test:

```typescript
  it('POST / masks api_key in response', async () => {
    const res = await request(app).post('/api/providers').send({
      name: 'masked-provider',
      type: 'llm',
      base_url: 'https://api.anthropic.com',
      api_key: 'sk-ant-real-secret',
      model: 'anthropic/claude-sonnet-4-5',
    })
    expect(res.status).toBe(201)
    expect(res.body.api_key).toBe('••••••••')
    expect(res.body.model).toBe('anthropic/claude-sonnet-4-5')
  })

  it('GET / never exposes plaintext api_key', async () => {
    const res = await request(app).get('/api/providers')
    for (const p of res.body) {
      if (p.api_key !== undefined) {
        expect(p.api_key).toBe('••••••••')
      }
    }
  })
```

- [ ] **Step 8: Run tests**

```bash
cd backend && npm run test:db -- tests/providers.route.test.ts
```

Expected: all tests pass including the two new ones.

- [ ] **Step 9: Commit**

```bash
git add backend/src/registry.ts backend/tests/providers.route.test.ts
git commit -m "feat: encrypt provider api_key at rest, add llm provider type with model field"
```

---

## Task 5: One-time encryption migration script

Encrypts any existing plaintext keys in the `providers` table. Safe to run multiple times — skips already-encrypted values.

**Files:**
- Create: `backend/src/migrations/encrypt-existing-keys.ts`

- [ ] **Step 1: Create the migration script**

```typescript
// backend/src/migrations/encrypt-existing-keys.ts
import { createPool, runMigrations } from '../db.js'
import { encrypt, isEncrypted } from '../crypto.js'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL required')

const pool = createPool(url)
await runMigrations(pool)

const { rows } = await pool.query(
  "SELECT id, name, api_key FROM providers WHERE api_key IS NOT NULL"
)

let count = 0
for (const row of rows) {
  if (!isEncrypted(row.api_key)) {
    await pool.query('UPDATE providers SET api_key = $1 WHERE id = $2', [
      encrypt(row.api_key),
      row.id,
    ])
    console.log(`  Encrypted key for provider: ${row.name}`)
    count++
  } else {
    console.log(`  Already encrypted: ${row.name}`)
  }
}

await pool.end()
console.log(`Done. ${count} key(s) encrypted.`)
```

- [ ] **Step 2: Document how to run it**

Run after deploying this plan, before starting the backend:

```bash
DATABASE_URL=postgresql://agent_cp:<password>@localhost:5432/agent_cp \
SECRET_ENCRYPTION_KEY=<your key> \
npx tsx backend/src/migrations/encrypt-existing-keys.ts
```

Expected output:
```
  Encrypted key for provider: Codex (local)
Done. 1 key(s) encrypted.
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/migrations/encrypt-existing-keys.ts
git commit -m "feat: one-time migration script to encrypt existing plaintext provider keys"
```

---

## Task 6: Agent registry — new profile fields

**Files:**
- Modify: `backend/src/registry.ts`

- [ ] **Step 1: Update the `RegistryAgent` interface**

Replace the existing `RegistryAgent` interface in `registry.ts`:

```typescript
export interface RegistryAgent {
  id: string
  name: string
  type: string
  provider_id?: string
  runtime_family: string
  execution_mode: string
  endpoint?: string
  capabilities: string[]
  host?: string
  container_name?: string
  ssh_user?: string
  config: Record<string, unknown>
  enabled: boolean
  created_at: string
  local_port?: number
  worktree_path?: string
  system_prompt?: string
  soul?: string
}
```

- [ ] **Step 2: Update `insertAgent` to include new fields**

Find `insertAgent` in `registry.ts`. Replace the query to include the four new columns:

```typescript
export async function insertAgent(
  pool: pg.Pool,
  data: Omit<RegistryAgent, 'id' | 'created_at'>
): Promise<RegistryAgent> {
  const { rows } = await pool.query(
    `INSERT INTO agents
      (name, type, provider_id, runtime_family, execution_mode, endpoint,
       capabilities, host, container_name, ssh_user, config, enabled,
       local_port, worktree_path, system_prompt, soul)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      data.name, data.type, data.provider_id ?? null,
      data.runtime_family, data.execution_mode, data.endpoint ?? null,
      JSON.stringify(data.capabilities), data.host ?? null,
      data.container_name ?? null, data.ssh_user ?? null,
      JSON.stringify(data.config), data.enabled,
      data.local_port ?? null, data.worktree_path ?? null,
      data.system_prompt ?? null, data.soul ?? null,
    ]
  )
  return rows[0]
}
```

- [ ] **Step 3: Update `updateAgent` to include new fields**

Find `updateAgent` in `registry.ts`. Add the four new columns to the SET clause:

```typescript
export async function updateAgent(
  pool: pg.Pool,
  id: string,
  data: Partial<Omit<RegistryAgent, 'id' | 'created_at'>>
): Promise<RegistryAgent> {
  const { rows } = await pool.query(
    `UPDATE agents SET
      name           = COALESCE($2,  name),
      type           = COALESCE($3,  type),
      provider_id    = COALESCE($4,  provider_id),
      runtime_family = COALESCE($5,  runtime_family),
      execution_mode = COALESCE($6,  execution_mode),
      endpoint       = COALESCE($7,  endpoint),
      capabilities   = COALESCE($8,  capabilities),
      host           = COALESCE($9,  host),
      container_name = COALESCE($10, container_name),
      ssh_user       = COALESCE($11, ssh_user),
      config         = COALESCE($12, config),
      enabled        = COALESCE($13, enabled),
      local_port     = COALESCE($14, local_port),
      worktree_path  = COALESCE($15, worktree_path),
      system_prompt  = COALESCE($16, system_prompt),
      soul           = COALESCE($17, soul)
    WHERE id = $1 RETURNING *`,
    [
      id,
      data.name ?? null, data.type ?? null, data.provider_id ?? null,
      data.runtime_family ?? null, data.execution_mode ?? null,
      data.endpoint ?? null,
      data.capabilities ? JSON.stringify(data.capabilities) : null,
      data.host ?? null, data.container_name ?? null,
      data.ssh_user ?? null,
      data.config ? JSON.stringify(data.config) : null,
      data.enabled ?? null,
      data.local_port ?? null, data.worktree_path ?? null,
      data.system_prompt ?? null, data.soul ?? null,
    ]
  )
  return rows[0]
}
```

- [ ] **Step 4: Run agent registry tests**

```bash
cd backend && npm run test:db -- tests/registry.test.ts tests/agents.route.test.ts
```

Expected: all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/registry.ts
git commit -m "feat: add local_port, worktree_path, system_prompt, soul to agent registry"
```

---

## Task 7: Web types and API client

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`

- [ ] **Step 1: Update `Provider` type in `web/src/types.ts`**

Find the `Provider` interface and add `model`:

```typescript
export interface Provider {
  id: string
  name: string
  type: string
  base_url: string
  api_key?: string   // always "••••••••" when set; undefined if not set
  model?: string
  created_at: string
}
```

- [ ] **Step 2: Update `RegistryAgent` type in `web/src/types.ts`**

Add the four new fields to `RegistryAgent`:

```typescript
export interface RegistryAgent {
  id: string
  name: string
  type: string
  provider_id?: string
  runtime_family: string
  execution_mode: string
  endpoint?: string
  capabilities: string[]
  host?: string
  container_name?: string
  ssh_user?: string
  config: Record<string, unknown>
  enabled: boolean
  created_at: string
  local_port?: number
  worktree_path?: string
  system_prompt?: string
  soul?: string
}
```

- [ ] **Step 3: Add `replaceProviderKey` to `web/src/api.ts`**

Append to `api.ts`:

```typescript
export async function replaceProviderKey(id: string, api_key: string): Promise<Provider> {
  const res = await fetch(`/api/providers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key }),
  })
  if (!res.ok) throw new Error('Failed to replace API key')
  return res.json()
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/types.ts web/src/api.ts
git commit -m "feat: update web types for model field, agent profile fields, replaceProviderKey"
```

---

## Task 8: Providers UI — `llm` type, model field, key masking

**Files:**
- Modify: `web/src/pages/Providers.tsx`

- [ ] **Step 1: Add `model` field to the create/edit form**

In `Providers.tsx`, find the `type` field in the form and add `llm` as an option. After the `type` select, add a conditional `model` input:

```tsx
{/* Type selector — add 'llm' option */}
<select
  value={form.type}
  onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
  className="..."
>
  <option value="codex">Codex</option>
  <option value="llm">LLM</option>
  <option value="hermes">Hermes</option>
</select>

{/* Model field — only for llm type */}
{form.type === 'llm' && (
  <div>
    <label className="block text-xs text-[var(--text-muted)] mb-1">
      Model
    </label>
    <input
      type="text"
      placeholder="anthropic/claude-sonnet-4-5"
      value={form.model ?? ''}
      onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
      className="..."
    />
  </div>
)}

{/* base_url label changes for llm type */}
<label className="block text-xs text-[var(--text-muted)] mb-1">
  {form.type === 'llm' ? 'API Proxy URL (optional)' : 'Base URL'}
</label>
```

- [ ] **Step 2: Replace the `api_key` input with masked display + Replace button**

Find the `api_key` input in the form. Replace it with this pattern that shows `••••••••` for existing providers and a new input when replacing:

```tsx
{/* API Key field with masking */}
{(() => {
  const hasKey = editingProvider?.api_key === '••••••••'
  const [replacing, setReplacing] = React.useState(false)

  if (editingProvider && hasKey && !replacing) {
    return (
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1">API Key</label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-[var(--text-muted)]">••••••••</span>
          <button
            type="button"
            onClick={() => setReplacing(true)}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Replace
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <label className="block text-xs text-[var(--text-muted)] mb-1">
        API Key {editingProvider && '(enter new key)'}
      </label>
      <input
        type="password"
        placeholder="sk-..."
        value={form.api_key ?? ''}
        onChange={e => setForm(f => ({ ...f, api_key: e.target.value }))}
        className="..."
      />
      {replacing && (
        <button
          type="button"
          onClick={() => setReplacing(false)}
          className="text-xs text-[var(--text-muted)] mt-1 hover:underline"
        >
          Cancel
        </button>
      )}
    </div>
  )
})()}
```

- [ ] **Step 3: Add `model` column to the providers table display**

In the table `<thead>`, add a `Model` column header after `Type`. In the table body `<td>` row, add:

```tsx
<td className="px-3 py-2 text-[var(--text-muted)] text-xs">
  {provider.model ?? '—'}
</td>
```

- [ ] **Step 4: Include `model` in the form submit payload**

In the form submit handler, include `model` in the body:

```typescript
body: JSON.stringify({
  name: form.name,
  type: form.type,
  base_url: form.base_url,
  model: form.model || undefined,
  api_key: form.api_key || undefined,
})
```

- [ ] **Step 5: Start dev server and verify**

```bash
cd web && npm run dev
```

Open `http://localhost:5173`. Navigate to Providers. Verify:
- Creating an `llm` provider shows the `model` field and optional proxy URL label
- After saving with an API key, the list shows `••••••••`
- The Replace button appears on edit

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/Providers.tsx
git commit -m "feat: Providers UI — llm type, model field, encrypted key masking with Replace"
```

---

## Task 9: Agents UI — Profile section

**Files:**
- Modify: `web/src/pages/Agents.tsx`

- [ ] **Step 1: Add Profile section to the agent create/edit form**

In `Agents.tsx`, find the agent form (the modal or panel with fields like name, type, provider, etc.). Add a new "Profile" section below the existing fields:

```tsx
{/* Profile Section */}
<div className="border-t border-[var(--border)] pt-4 mt-4">
  <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
    Agent Profile
  </h3>

  <div className="mb-3">
    <label className="block text-xs text-[var(--text-muted)] mb-1">
      Operating Instructions
      <span className="ml-1 text-[var(--text-dim)]">→ AGENTS.md</span>
    </label>
    <textarea
      rows={6}
      placeholder="How this agent should approach work, decision-making style, constraints..."
      value={form.system_prompt ?? ''}
      onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))}
      className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] resize-y"
    />
  </div>

  <div>
    <label className="block text-xs text-[var(--text-muted)] mb-1">
      Soul
      <span className="ml-1 text-[var(--text-dim)]">→ soul.md</span>
    </label>
    <textarea
      rows={4}
      placeholder="Who this agent is — identity, values, persona, tone..."
      value={form.soul ?? ''}
      onChange={e => setForm(f => ({ ...f, soul: e.target.value }))}
      className="w-full bg-[var(--surface)] border border-[var(--border)] rounded px-3 py-2 text-sm font-mono text-[var(--text)] resize-y"
    />
  </div>
</div>
```

- [ ] **Step 2: Include `system_prompt` and `soul` in the form submit payload**

In the agent form submit handler, add the two new fields to the body:

```typescript
body: JSON.stringify({
  // ...existing fields...
  system_prompt: form.system_prompt || undefined,
  soul: form.soul || undefined,
})
```

- [ ] **Step 3: Initialize form state with new fields**

Wherever the form state is reset (e.g. when opening the create modal or populating edit), include the new fields:

```typescript
// When opening edit:
setForm({
  // ...existing fields...
  system_prompt: agent.system_prompt ?? '',
  soul: agent.soul ?? '',
})

// When opening create (reset):
setForm({
  // ...existing fields...
  system_prompt: '',
  soul: '',
})
```

- [ ] **Step 4: Start dev server and verify**

```bash
cd web && npm run dev
```

Navigate to Agents. Open the create/edit panel. Verify the Profile section appears with both textareas. Create or edit an agent with system_prompt and soul filled in — confirm the values save and reload correctly.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Agents.tsx
git commit -m "feat: Agents UI — profile section with system_prompt and soul textareas"
```

---

## Task 10: Build and deploy

- [ ] **Step 1: Full test run**

```bash
cd backend && npm run test:db
```

Expected: all tests pass.

- [ ] **Step 2: TypeScript build check**

```bash
cd backend && npm run build && cd ../web && npm run build
```

Expected: no type errors.

- [ ] **Step 3: Run the encryption migration on the live database**

```bash
DATABASE_URL=postgresql://agent_cp:<password>@<host>:5432/agent_cp \
SECRET_ENCRYPTION_KEY=<your key> \
npx tsx backend/src/migrations/encrypt-existing-keys.ts
```

- [ ] **Step 4: Deploy**

```bash
# Build and push image (your existing deploy flow)
docker build -t code.klsll.com/havartibard/agent-control-plane:latest .
docker push code.klsll.com/havartibard/agent-control-plane:latest

# Restart on Unraid (postgres picks up new image, backend gets new schema)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

- [ ] **Step 5: Smoke test**

- Open the portal. Navigate to Providers.
- Verify existing Codex provider shows `••••••••` for API key.
- Create a new `llm` provider with a model and key — confirm masking.
- Navigate to Agents. Open any agent — verify Profile section is visible.

---

## Self-Review Checklist

- **Spec §1 (Encryption):** Covered by Tasks 2–5 ✓
- **Spec §2 (DB schema):** All tables and columns added in Task 3 ✓
- **Spec §3 (Provider types):** `llm` type + `model` field in Tasks 4 + 8 ✓
- **Spec §13 (UI Changes):** Provider masking + Replace in Task 8; Agent profile in Task 9 ✓
- **Spec §15 (Compose):** Image + env var in Task 1 ✓
- **`getProviderApiKey`** referenced by future plans — defined in Task 4 Step 6 ✓
- **Agent fields** (`local_port`, `worktree_path`, `system_prompt`, `soul`) — in DB (Task 3), registry (Task 6), types (Task 7) ✓
- **No TBDs or placeholders found**
- **Type consistency:** `RegistryAgent` interface is consistent across `registry.ts` and `web/src/types.ts` ✓
