# Setup Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a first-run setup wizard at `/setup` that guides users through LLM provider configuration, model routing, prime agent personality, and standing rules — ending with a one-click Launch that enables the prime agent.

**Architecture:** DB-tracked `setup_complete` flag on `prime_agent_config`; wizard writes to `providers`, `chief_profiles`, and `prime_agent_config` in a single `POST /api/setup/complete` call; `App.tsx` checks `GET /api/setup/status` on mount and shows `<Setup />` fullscreen if incomplete and not skipped.

**Tech Stack:** TypeScript ESM (`.js` extensions on all imports), Express + PostgreSQL backend (`backend/src/`), React + TanStack Query + Tailwind CSS variables frontend (`web/src/`), vitest + supertest for backend tests.

**Dev runtime note:** the setup flow depends on backend `/api/setup/*` routes, so frontend-only Vite startup is not sufficient. Start local development with `./scripts/dev-up.sh`, which clears stale listeners, binds Vite on `0.0.0.0:5173`, and boots the backend against the expected dev database.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `backend/src/db.ts` | Modify | Add `setup_complete` column migration |
| `backend/src/routes/setup.ts` | Create | All three `/api/setup/*` endpoints |
| `backend/tests/setup.route.test.ts` | Create | Route tests for setup endpoints |
| `backend/src/app.ts` | Modify | Mount setup router |
| `backend/src/prime-agent/llm-router.ts` | Modify | `buildPrimeSystemPrompt` → async + reads chief_profiles |
| `backend/tests/prime-agent/llm-router.test.ts` | Modify | Update tests for new async signature |
| `backend/tests/prime-agent/llm-router-configured.test.ts` | Modify | Fix mock sequence for new pool.query call |
| `web/src/hooks/useSetupStatus.ts` | Create | Query hook for setup status |
| `web/src/App.tsx` | Modify | Add setup gate before rendering Layout |
| `web/src/pages/Setup.tsx` | Create | 5-step wizard, all state local |

---

### Task 1: DB Migration — add setup_complete column

**Files:**
- Modify: `backend/src/db.ts`

- [ ] **Step 1: Create the feature branch**

```bash
cd /home/james/projects/agent-control-plane
git checkout -b feature/setup-wizard
```

- [ ] **Step 2: Add migration line to db.ts**

In `backend/src/db.ts`, locate the line `ALTER TABLE prime_agent_sessions ADD COLUMN IF NOT EXISTS last_step TEXT;` (around line 417). Add the new ALTER TABLE immediately after it, before the `INSERT INTO prime_agent_config` line:

```sql
    ALTER TABLE prime_agent_config
      ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN NOT NULL DEFAULT false;
```

The block should look like:

```sql
    ALTER TABLE prime_agent_sessions
      ADD COLUMN IF NOT EXISTS last_step TEXT;

    ALTER TABLE prime_agent_config
      ADD COLUMN IF NOT EXISTS setup_complete BOOLEAN NOT NULL DEFAULT false;

    INSERT INTO prime_agent_config (id, enabled) VALUES ('default', false) ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 3: Run backend tests to verify the migration is safe**

```bash
cd /home/james/projects/agent-control-plane/backend
npm run test:db 2>&1 | tail -20
```

Expected: All existing tests pass (the `ADD COLUMN IF NOT EXISTS` is idempotent).

- [ ] **Step 4: Commit**

```bash
git add backend/src/db.ts
git commit -m "feat(db): add setup_complete column to prime_agent_config"
```

---

### Task 2: Setup router — GET /api/setup/status + GET /api/setup/ollama-models

**Files:**
- Create: `backend/tests/setup.route.test.ts`
- Create: `backend/src/routes/setup.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/setup.route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import express from 'express'
import pg from 'pg'
import { createPool, runMigrations } from '../src/db.js'
import { createSetupRouter } from '../src/routes/setup.js'

const TEST_DB = process.env.TEST_DATABASE_URL!
process.env.SECRET_ENCRYPTION_KEY = 'a'.repeat(64)

describe('GET /api/setup/status', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await pool.query('DELETE FROM providers')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false WHERE id='default'")
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query('DELETE FROM providers')
    await pool.end()
  })

  it('returns complete: false when no providers and setup_complete=false', async () => {
    const res = await request(app).get('/api/setup/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ complete: false })
  })

  it('returns complete: true when providers table is non-empty', async () => {
    await pool.query(
      "INSERT INTO providers (name, type, base_url) VALUES ('test', 'anthropic', 'https://api.anthropic.com')"
    )
    const res = await request(app).get('/api/setup/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ complete: true })
    await pool.query("DELETE FROM providers WHERE name='test'")
  })

  it('returns complete: true when setup_complete=true even with no providers', async () => {
    await pool.query("UPDATE prime_agent_config SET setup_complete=true WHERE id='default'")
    const res = await request(app).get('/api/setup/status')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ complete: true })
    await pool.query("UPDATE prime_agent_config SET setup_complete=false WHERE id='default'")
  })
})

describe('GET /api/setup/ollama-models', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.end()
  })

  it('returns 400 when base_url is missing', async () => {
    const res = await request(app).get('/api/setup/ollama-models')
    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })

  it('returns { error: "unreachable" } when host is unreachable', async () => {
    const res = await request(app).get('/api/setup/ollama-models?base_url=http://127.0.0.1:19999')
    expect(res.status).toBe(200)
    expect(res.body.error).toBe('unreachable')
  }, 5_000)
})
```

- [ ] **Step 2: Run to verify the tests fail**

```bash
cd /home/james/projects/agent-control-plane/backend
npm run test:db -- tests/setup.route.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: FAIL — "Cannot find module '../src/routes/setup.js'"

- [ ] **Step 3: Implement the setup router**

Create `backend/src/routes/setup.ts`:

```ts
import { Router } from 'express'
import type pg from 'pg'
import { encrypt } from '../crypto.js'

export function createSetupRouter({ pool }: { pool: pg.Pool }) {
  const router = Router()

  router.get('/status', async (_req, res) => {
    try {
      const { rows: providerRows } = await pool.query(
        'SELECT COUNT(*)::int AS count FROM providers'
      )
      if (providerRows[0].count > 0) {
        return res.json({ complete: true })
      }
      const { rows } = await pool.query(
        "SELECT setup_complete FROM prime_agent_config WHERE id = 'default'"
      )
      res.json({ complete: rows[0]?.setup_complete ?? false })
    } catch {
      res.status(500).json({ error: 'internal error' })
    }
  })

  router.get('/ollama-models', async (req, res) => {
    const base_url = req.query.base_url as string | undefined
    if (!base_url) {
      return res.status(400).json({ error: 'base_url query param required' })
    }
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3_000)
      const upstream = await fetch(`${base_url}/api/tags`, { signal: controller.signal })
      clearTimeout(timeout)
      const data = await upstream.json()
      res.json(data)
    } catch {
      res.json({ error: 'unreachable' })
    }
  })

  return router
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/james/projects/agent-control-plane/backend
npm run test:db -- tests/setup.route.test.ts --reporter=verbose 2>&1 | tail -15
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/setup.ts backend/tests/setup.route.test.ts
git commit -m "feat(setup): add GET /api/setup/status and GET /api/setup/ollama-models"
```

---

### Task 3: Setup router — POST /api/setup/complete

**Files:**
- Modify: `backend/tests/setup.route.test.ts`
- Modify: `backend/src/routes/setup.ts`

- [ ] **Step 1: Append the failing tests**

Add this describe block to the end of `backend/tests/setup.route.test.ts`:

```ts
describe('POST /api/setup/complete', () => {
  let pool: pg.Pool
  let app: express.Application

  beforeAll(async () => {
    pool = createPool(TEST_DB)
    await runMigrations(pool)
    await pool.query('DELETE FROM providers')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false, enabled=false WHERE id='default'")
    await pool.query("DELETE FROM chief_profiles")
    app = express()
    app.use(express.json())
    app.use('/api/setup', createSetupRouter({ pool }))
  })

  afterAll(async () => {
    await pool.query('DELETE FROM providers')
    await pool.query("UPDATE prime_agent_config SET setup_complete=false, enabled=false WHERE id='default'")
    await pool.query("DELETE FROM chief_profiles")
    await pool.end()
  })

  const validPayload = {
    providers: [
      {
        name: 'anthropic-main',
        type: 'anthropic',
        base_url: 'https://api.anthropic.com',
        api_key: 'sk-ant-test',
        model: 'claude-sonnet-4-6',
      },
    ],
    routing: {
      planning: [{ provider_name: 'anthropic-main', model: 'claude-sonnet-4-6' }],
      dispatching: [],
      discussion: [],
    },
    persona: {
      name: 'Prime',
      focus: 'Senior backend engineer',
      tone: 'direct',
      instructions: '',
    },
    rules: { presets: ['no_force_push'], custom: '' },
    cost_controls: { monthly_token_budget: 0 },
    launch: true,
  }

  it('returns ok: true and sets setup_complete=true', async () => {
    const res = await request(app).post('/api/setup/complete').send(validPayload)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })

    const { rows } = await pool.query(
      "SELECT setup_complete, enabled FROM prime_agent_config WHERE id='default'"
    )
    expect(rows[0].setup_complete).toBe(true)
    expect(rows[0].enabled).toBe(true)
  })

  it('inserts provider with encrypted api_key', async () => {
    const { rows } = await pool.query("SELECT * FROM providers WHERE name='anthropic-main'")
    expect(rows).toHaveLength(1)
    expect(rows[0].api_key).not.toBe('sk-ant-test')
    expect(rows[0].type).toBe('anthropic')
    expect(rows[0].model).toBe('claude-sonnet-4-6')
  })

  it('writes provider_routing with resolved provider_id', async () => {
    const { rows: prov } = await pool.query("SELECT id FROM providers WHERE name='anthropic-main'")
    const providerId = prov[0].id
    const { rows } = await pool.query(
      "SELECT provider_routing FROM prime_agent_config WHERE id='default'"
    )
    expect(rows[0].provider_routing.planning[0].provider_id).toBe(providerId)
    expect(rows[0].provider_routing.planning[0].model).toBe('claude-sonnet-4-6')
  })

  it('omits empty route arrays from provider_routing', async () => {
    const { rows } = await pool.query(
      "SELECT provider_routing FROM prime_agent_config WHERE id='default'"
    )
    expect(rows[0].provider_routing.dispatching).toBeUndefined()
    expect(rows[0].provider_routing.discussion).toBeUndefined()
  })

  it('upserts chief_profiles with persona and operating_policy', async () => {
    const { rows } = await pool.query(
      "SELECT persona, operating_policy, name FROM chief_profiles WHERE id='default'"
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Prime')
    expect(rows[0].persona).toContain('You are Prime, Senior backend engineer.')
    expect(rows[0].persona).toContain('Direct & concise')
    expect(rows[0].operating_policy).toContain('Never force-push to main or protected branches')
  })

  it('skips re-inserting a pre-created provider when id is in payload', async () => {
    const { rows: existing } = await pool.query("SELECT id FROM providers WHERE name='anthropic-main'")
    const preCreatedId = existing[0].id

    const res = await request(app).post('/api/setup/complete').send({
      ...validPayload,
      providers: [{ ...validPayload.providers[0], id: preCreatedId }],
    })
    expect(res.status).toBe(200)

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int as count FROM providers WHERE name='anthropic-main'"
    )
    expect(rows[0].count).toBe(1)
  })

  it('updates existing provider by name on retry (idempotent)', async () => {
    const res = await request(app).post('/api/setup/complete').send({
      ...validPayload,
      providers: [{ ...validPayload.providers[0], model: 'claude-opus-4-7' }],
    })
    expect(res.status).toBe(200)
    const { rows } = await pool.query("SELECT model FROM providers WHERE name='anthropic-main'")
    expect(rows[0].model).toBe('claude-opus-4-7')
  })

  it('sets enabled=false when launch: false', async () => {
    await pool.query("UPDATE prime_agent_config SET enabled=false WHERE id='default'")
    await request(app).post('/api/setup/complete').send({ ...validPayload, launch: false })
    const { rows } = await pool.query(
      "SELECT enabled FROM prime_agent_config WHERE id='default'"
    )
    expect(rows[0].enabled).toBe(false)
  })

  it('returns 400 when providers array is missing', async () => {
    const { providers: _p, ...rest } = validPayload
    const res = await request(app).post('/api/setup/complete').send(rest)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify the tests fail**

```bash
cd /home/james/projects/agent-control-plane/backend
npm run test:db -- tests/setup.route.test.ts --reporter=verbose 2>&1 | grep -E "✓|×|FAIL|Error" | head -20
```

Expected: The new `POST /api/setup/complete` tests fail (404).

- [ ] **Step 3: Implement POST /api/setup/complete**

In `backend/src/routes/setup.ts`, add the following inside `createSetupRouter` before `return router`:

```ts
  const PRESET_LABELS: Record<string, string> = {
    test_before_delegate: 'Always run tests before delegating work to agents',
    no_force_push: 'Never force-push to main or protected branches',
    small_prs: 'Prefer small, reviewable pull requests over large ones',
    confirm_destructive: 'Ask before taking destructive or irreversible actions',
    humans_in_loop: 'Keep humans in the loop on external communications',
  }

  router.post('/complete', async (req, res) => {
    const body = req.body as {
      providers?: Array<{ id?: string; name: string; type: string; base_url: string; api_key?: string; model?: string }>
      routing?: Record<string, Array<{ provider_name: string; model: string }>>
      persona?: { name: string; focus: string; tone: string; instructions?: string }
      rules?: { presets: string[]; custom: string }
      cost_controls?: { monthly_token_budget: number }
      launch?: boolean
    }

    if (!Array.isArray(body?.providers) || !body?.routing || !body?.persona || !body?.rules) {
      return res.status(400).json({ error: 'providers, routing, persona, and rules are required' })
    }

    try {
      const providerNameToId = new Map<string, string>()

      for (const p of body.providers) {
        if (p.id) {
          providerNameToId.set(p.name, p.id)
          continue
        }

        const { rows: existing } = await pool.query(
          'SELECT id FROM providers WHERE name = $1',
          [p.name]
        )

        if (existing.length > 0) {
          const encKey = p.api_key ? encrypt(p.api_key) : undefined
          if (encKey) {
            await pool.query(
              'UPDATE providers SET type=$2, base_url=$3, model=$4, api_key=$5 WHERE id=$1',
              [existing[0].id, p.type, p.base_url, p.model ?? null, encKey]
            )
          } else {
            await pool.query(
              'UPDATE providers SET type=$2, base_url=$3, model=$4 WHERE id=$1',
              [existing[0].id, p.type, p.base_url, p.model ?? null]
            )
          }
          providerNameToId.set(p.name, existing[0].id)
        } else {
          const encKey = p.api_key ? encrypt(p.api_key) : null
          const { rows: inserted } = await pool.query(
            'INSERT INTO providers (name, type, base_url, api_key, model) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [p.name, p.type, p.base_url, encKey, p.model ?? null]
          )
          providerNameToId.set(p.name, inserted[0].id)
        }
      }

      const routing: Record<string, Array<{ provider_id: string; model: string }>> = {}
      for (const [routeName, routes] of Object.entries(body.routing)) {
        const resolved = (routes ?? [])
          .filter((r) => r.provider_name && providerNameToId.has(r.provider_name))
          .map((r) => ({ provider_id: providerNameToId.get(r.provider_name)!, model: r.model }))
        if (resolved.length > 0) routing[routeName] = resolved
      }

      const persona = body.persona
      const toneLabel =
        persona.tone === 'direct' ? 'Direct & concise'
        : persona.tone === 'thorough' ? 'Thorough & deliberate'
        : 'Collaborative & inquisitive'

      const personaLines = [`You are ${persona.name}, ${persona.focus}.`, `Tone: ${toneLabel}.`]
      if (persona.instructions?.trim()) personaLines.push('', persona.instructions.trim())

      const rules = body.rules
      const presetLines = rules.presets.map((k) => PRESET_LABELS[k]).filter(Boolean)
      const policyParts = [...presetLines]
      if (rules.custom?.trim()) policyParts.push('', rules.custom.trim())

      await pool.query(
        `INSERT INTO chief_profiles (id, name, persona, operating_policy)
         VALUES ('default', $1, $2, $3)
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               persona = EXCLUDED.persona,
               operating_policy = EXCLUDED.operating_policy,
               updated_at = now()`,
        [persona.name, personaLines.join('\n'), policyParts.join('\n')]
      )

      const costControls = body.cost_controls ?? { monthly_token_budget: 0 }
      const launch = body.launch === true

      await pool.query(
        `UPDATE prime_agent_config
         SET provider_routing=$1, cost_controls=$2, enabled=$3, setup_complete=true
         WHERE id='default'`,
        [JSON.stringify(routing), JSON.stringify(costControls), launch]
      )

      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: (err as Error).message ?? 'internal error' })
    }
  })
```

- [ ] **Step 4: Run the full setup route test suite**

```bash
cd /home/james/projects/agent-control-plane/backend
npm run test:db -- tests/setup.route.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/setup.ts backend/tests/setup.route.test.ts
git commit -m "feat(setup): add POST /api/setup/complete endpoint"
```

---

### Task 4: Mount setup router in app.ts

**Files:**
- Modify: `backend/src/app.ts`

- [ ] **Step 1: Add the import**

In `backend/src/app.ts`, add after the last existing route import (near line 17):

```ts
import { createSetupRouter } from './routes/setup.js'
```

- [ ] **Step 2: Mount the router**

In `backend/src/app.ts`, add before `app.use('/api', createRuntimeRouter(...))`:

```ts
  app.use('/api/setup', createSetupRouter({ pool: deps.pool }))
```

- [ ] **Step 3: Run the full backend test suite**

```bash
cd /home/james/projects/agent-control-plane/backend
npm run test:db 2>&1 | tail -15
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/app.ts
git commit -m "feat(app): mount /api/setup router"
```

---

### Task 5: buildPrimeSystemPrompt — async + chief_profiles persona

The function in `backend/src/prime-agent/llm-router.ts` needs to become async and read from `chief_profiles`. Its only call site is `callProvider` in the same file. The existing test in `llm-router.test.ts` calls it directly and needs updating. The configured-router tests in `llm-router-configured.test.ts` mock `pool.query` and need an updated mock that handles the new chief_profiles query.

**Files:**
- Modify: `backend/src/prime-agent/llm-router.ts`
- Modify: `backend/tests/prime-agent/llm-router.test.ts`
- Modify: `backend/tests/prime-agent/llm-router-configured.test.ts`

- [ ] **Step 1: Update llm-router.test.ts to use new async signature**

In `backend/tests/prime-agent/llm-router.test.ts`:

Add this import near the top (after existing imports):

```ts
import type pg from 'pg'
```

Add a mock pool constant near the top of the file (after the `minimalContext` definition):

```ts
const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as pg.Pool
```

Then update all three tests in the `describe('buildPrimeSystemPrompt', ...)` block — add `async` to each `it()` callback and `await` the function call:

```ts
describe('buildPrimeSystemPrompt', () => {
  it('includes the agent name and capabilities', async () => {
    const prompt = await buildPrimeSystemPrompt(minimalContext, mockPool)
    expect(prompt).toContain('Coder')
    expect(prompt).toContain('code')
  })

  it('includes instruction to return JSON with reasoning and actions', async () => {
    const prompt = await buildPrimeSystemPrompt(minimalContext, mockPool)
    expect(prompt).toContain('"reasoning"')
    expect(prompt).toContain('"actions"')
  })

  it('mentions all four allowed action types', async () => {
    const prompt = await buildPrimeSystemPrompt(minimalContext, mockPool)
    expect(prompt).toContain('delegate')
    expect(prompt).toContain('update_work_item')
    expect(prompt).toContain('request_approval')
    expect(prompt).toContain('no_op')
  })
})
```

- [ ] **Step 2: Update llm-router-configured.test.ts to handle the new chief_profiles pool.query call**

In `backend/tests/prime-agent/llm-router-configured.test.ts`, the `beforeEach` currently sets `mockGetProvider.mockResolvedValue({ rows: [anthropicProvider] })`. After the change, `buildPrimeSystemPrompt` adds a `pool.query` call for chief_profiles before the provider lookup inside `callProvider`. Update `beforeEach` to use `mockImplementation` that discriminates by SQL:

```ts
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProvider.mockImplementation((sql: string) => {
      if ((sql as string).includes('chief_profiles')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [anthropicProvider] })
    })
    mockGetProviderApiKey.mockResolvedValue('sk-test')
    mockGetPrimeConfig.mockResolvedValue({
      provider_routing: { planning: [{ provider_id: 'prov-1', model: 'claude-opus-4-7' }] },
    })
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(validDecision) }],
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'claude-opus-4-7-20251101',
    })
  })
```

Then update the three tests that override `mockGetProvider` to also use `mockImplementation`:

For `it('calls OpenAI SDK for openai provider', ...)`:

```ts
    mockGetProvider.mockImplementation((sql: string) => {
      if ((sql as string).includes('chief_profiles')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [openaiProvider] })
    })
```

For `it('uses base_url for llm provider type', ...)`:

```ts
    mockGetProvider.mockImplementation((sql: string) => {
      if ((sql as string).includes('chief_profiles')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [llmProvider] })
    })
```

For `it('falls back to second provider when first throws', ...)`, the mock needs to return the right provider per `provider_id`. Replace the `mockResolvedValueOnce` calls with an implementation:

```ts
    mockGetProvider.mockImplementation((sql: string, params?: unknown[]) => {
      if ((sql as string).includes('chief_profiles')) return Promise.resolve({ rows: [] })
      const providerId = params?.[0]
      if (providerId === 'prov-1') return Promise.resolve({ rows: [anthropicProvider] })
      return Promise.resolve({ rows: [openaiProvider] })
    })
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
cd /home/james/projects/agent-control-plane/backend
npm run test:db -- tests/prime-agent/llm-router.test.ts tests/prime-agent/llm-router-configured.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `buildPrimeSystemPrompt` is not async / doesn't accept a pool parameter.

- [ ] **Step 4: Update buildPrimeSystemPrompt in llm-router.ts**

In `backend/src/prime-agent/llm-router.ts`, replace the `buildPrimeSystemPrompt` function (currently at line ~123) with:

```ts
export async function buildPrimeSystemPrompt(context: PrimeContext, pool: pg.Pool): Promise<string> {
  const { rows } = await pool.query(
    "SELECT persona, operating_policy FROM chief_profiles WHERE id = 'default'"
  )

  const agentLines = context.fleet.agents.map(
    (a) => `- ${a.name} [${(a.capabilities as string[]).join(', ')}]${a.enabled ? '' : ' (disabled)'}`,
  )
  const workLines = context.fleet.workItems.map(
    (w) => `- [${w.id.slice(0, 8)}] ${w.title} (${w.status}/${w.lane})`,
  )
  const delegationLines = context.fleet.delegations.map(
    (d) => `- [${d.id.slice(0, 8)}] ${d.capability} → ${d.to_agent_id ?? 'unassigned'} (${d.status})`,
  )
  const eventLines = context.recentEvents.slice(0, 20).map(
    (e) => `- ${e.event_type} by ${e.actor}`,
  )
  const lessonLines = context.recentLessons.map((l) => `- ${l.content}`)

  const corePrompt = [
    'You are the Prime Agent — the orchestration brain of an autonomous AI agent fleet.',
    'Your job is to survey fleet state and decide the next actions.',
    '',
    '## Fleet Agents',
    '',
    ...agentLines,
    '',
    '## Active Work Items',
    '',
    ...workLines,
    '',
    '## Pending Delegations',
    '',
    ...delegationLines,
    '',
    '## Recent Events',
    '',
    ...eventLines,
    '',
    '## Lessons',
    '',
    ...lessonLines,
    '',
    '## Response Format',
    '',
    'Respond with a JSON object only — no markdown, no code fences:',
    '{',
    '  "reasoning": "<chain of thought, max 500 chars>",',
    '  "actions": [',
    '    { "type": "delegate"|"update_work_item"|"request_approval"|"no_op", "payload": {...}, "reason": "..." }',
    '  ]',
    '}',
    '',
    'For delegate, payload must include:',
    '  title (string), description (string), capability (string),',
    '  allowed_files (string[]), read_files (string[]),',
    '  verification_cmd (string, optional), thread_id (string, optional).',
    '',
    'Prefer no_op if nothing meaningful needs doing right now.',
  ].join('\n')

  const profile = rows[0]
  if (!profile?.persona) return corePrompt

  const prefix = [
    profile.persona,
    '',
    '## Standing Rules',
    '',
    profile.operating_policy,
    '',
    '---',
    '',
  ].join('\n')

  return prefix + corePrompt
}
```

Also update the call site in `callProvider` (same file, ~line 233):

Change:
```ts
  const systemPrompt = buildPrimeSystemPrompt(context)
```
To:
```ts
  const systemPrompt = await buildPrimeSystemPrompt(context, pool)
```

- [ ] **Step 5: Run the llm-router tests**

```bash
cd /home/james/projects/agent-control-plane/backend
npm run test:db -- tests/prime-agent/llm-router.test.ts tests/prime-agent/llm-router-configured.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 6: Run the full backend test suite to catch any other callers**

```bash
cd /home/james/projects/agent-control-plane/backend
npm run test:db 2>&1 | tail -15
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/src/prime-agent/llm-router.ts backend/tests/prime-agent/llm-router.test.ts backend/tests/prime-agent/llm-router-configured.test.ts
git commit -m "feat(prime-agent): buildPrimeSystemPrompt reads chief_profiles persona prefix"
```

---

### Task 6: Frontend — useSetupStatus hook + App.tsx gate

**Files:**
- Create: `web/src/hooks/useSetupStatus.ts`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Create the useSetupStatus hook**

Create `web/src/hooks/useSetupStatus.ts`:

```ts
import { useQuery } from '@tanstack/react-query'

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () =>
      fetch('/api/setup/status').then((r) => r.json()) as Promise<{ complete: boolean }>,
    staleTime: Infinity,
  })
}
```

- [ ] **Step 2: Modify App.tsx to add the setup gate**

In `web/src/App.tsx`, add these imports at the top (after existing imports):

```ts
import { useState } from 'react'
import { useSetupStatus } from './hooks/useSetupStatus.js'
```

(Note: `useState` may already be imported — check and avoid duplicating.)

Add a new `AppInner` component between the `Layout` function and the `App` export:

```tsx
function AppInner() {
  const { data: setupStatus, isLoading } = useSetupStatus()
  const [skipped, setSkipped] = useState(
    () => sessionStorage.getItem('setup-skipped') === '1'
  )

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-soft)] border-t-[var(--accent)]" />
      </div>
    )
  }

  if (!setupStatus?.complete && !skipped) {
    return (
      <Setup
        onSkip={() => {
          sessionStorage.setItem('setup-skipped', '1')
          setSkipped(true)
        }}
      />
    )
  }

  return <Layout />
}
```

Then change the `App` export to render `AppInner` instead of `Layout`:

```tsx
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  )
}
```

Also add the `Setup` import at the top of the file (with other page imports):

```ts
import { Setup } from './pages/Setup.js'
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/james/projects/agent-control-plane/web
npx tsc -b --noEmit 2>&1 | head -20
```

Expected: Errors only about `Setup` not existing yet (which is fine — we'll create it in the next task). If there are other errors, fix them.

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useSetupStatus.ts web/src/App.tsx
git commit -m "feat(frontend): add useSetupStatus hook and setup gate in App"
```

---

### Task 7: Setup.tsx — skeleton, types, step navigation

This task creates the `Setup.tsx` file with all type definitions, wizard state, and the step navigation shell. Subsequent tasks fill in each step's content.

**Files:**
- Create: `web/src/pages/Setup.tsx`

- [ ] **Step 1: Create the Setup.tsx skeleton**

Create `web/src/pages/Setup.tsx`:

```tsx
import { useState, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProviderDraft {
  id?: string  // set only when pre-created (device auth)
  name: string
  type: string
  base_url: string
  api_key?: string
  model?: string
  active: boolean
}

interface RoutingEntry {
  provider_name: string
  model: string
}

interface RoutingDraft {
  planning: RoutingEntry[]
  dispatching: RoutingEntry[]
  discussion: RoutingEntry[]
}

interface PersonaDraft {
  name: string
  focus: string
  tone: 'direct' | 'thorough' | 'collaborative'
  instructions: string
}

interface RulesDraft {
  presets: string[]
  custom: string
}

interface WizardState {
  providers: ProviderDraft[]
  routing: RoutingDraft
  persona: PersonaDraft
  rules: RulesDraft
  costControls: { monthlyTokenBudget: number }
}

const INITIAL_STATE: WizardState = {
  providers: [
    { name: 'anthropic-main', type: 'anthropic', base_url: 'https://api.anthropic.com', model: 'claude-sonnet-4-6', active: false },
    { name: 'openai-main', type: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o', active: false },
    { name: 'local-main', type: 'ollama', base_url: 'http://localhost:11434', model: '', active: false },
  ],
  routing: { planning: [], dispatching: [], discussion: [] },
  persona: { name: 'Prime', focus: '', tone: 'direct', instructions: '' },
  rules: { presets: [], custom: '' },
  costControls: { monthlyTokenBudget: 0 },
}

const STEPS = ['Providers', 'Routing', 'Personality', 'Rules', 'Launch'] as const
type Step = 0 | 1 | 2 | 3 | 4

// ─── CSS helpers ─────────────────────────────────────────────────────────────

const INPUT_CLS =
  'w-full bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]'
const LABEL_CLS = 'block text-xs text-[var(--muted)] mb-1'
const BTN_PRIMARY =
  'px-4 py-2 text-sm font-medium rounded border border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-400 hover:bg-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition'
const BTN_SECONDARY =
  'px-4 py-2 text-sm rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] text-[var(--muted)] hover:bg-[var(--panel)] transition'

// ─── Step components (stubs — filled in later tasks) ─────────────────────────

function StepProviders({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">Configure your LLM providers. At least one must be fully set up to continue.</p>
      {/* Step 1 content — implemented in Task 8 */}
      <p className="text-xs text-[var(--s-att-tx)] font-mono">Step 1 content pending Task 8</p>
    </div>
  )
}

function StepRouting({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">Assign providers to planning, dispatching, and discussion routes.</p>
      {/* Step 2 content — implemented in Task 9 */}
      <p className="text-xs text-[var(--s-att-tx)] font-mono">Step 2 content pending Task 9</p>
    </div>
  )
}

function StepPersonality({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">Define the Prime Agent's name, focus, and tone.</p>
      {/* Step 3 content — implemented in Task 9 */}
      <p className="text-xs text-[var(--s-att-tx)] font-mono">Step 3 content pending Task 9</p>
    </div>
  )
}

function StepRules({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">Choose standing rules for the Prime Agent to follow.</p>
      {/* Step 4 content — implemented in Task 9 */}
      <p className="text-xs text-[var(--s-att-tx)] font-mono">Step 4 content pending Task 9</p>
    </div>
  )
}

function StepLaunch({ state, onSubmit, submitting, error }: {
  state: WizardState
  onSubmit: (launch: boolean) => void
  submitting: boolean
  error: string | null
}) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">Review your configuration and launch.</p>
      {/* Step 5 content — implemented in Task 10 */}
      <p className="text-xs text-[var(--s-att-tx)] font-mono">Step 5 content pending Task 10</p>
      {error && (
        <p className="text-xs text-[var(--s-blk-tx)] font-mono">{error}</p>
      )}
      <div className="flex gap-3">
        <button onClick={() => onSubmit(true)} disabled={submitting} className={BTN_PRIMARY}>
          {submitting ? 'Launching…' : 'Launch Prime Agent'}
        </button>
        <button onClick={() => onSubmit(false)} disabled={submitting} className={BTN_SECONDARY}>
          Save & configure later
        </button>
      </div>
    </div>
  )
}

// ─── Main Setup component ─────────────────────────────────────────────────────

export function Setup({ onSkip }: { onSkip?: () => void }) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState<Step>(0)
  const [state, setState] = useState<WizardState>(INITIAL_STATE)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const canAdvance = (() => {
    if (step === 0) return state.providers.some((p) => p.active)
    return true
  })()

  async function handleSubmit(launch: boolean) {
    setSubmitting(true)
    setSubmitError(null)
    try {
      const body = {
        providers: state.providers
          .filter((p) => p.active)
          .map(({ active: _a, ...rest }) => rest),
        routing: {
          planning: state.routing.planning,
          dispatching: state.routing.dispatching,
          discussion: state.routing.discussion,
        },
        persona: {
          name: state.persona.name,
          focus: state.persona.focus,
          tone: state.persona.tone,
          instructions: state.persona.instructions,
        },
        rules: {
          presets: state.rules.presets,
          custom: state.rules.custom,
        },
        cost_controls: { monthly_token_budget: state.costControls.monthlyTokenBudget },
        launch,
      }
      const res = await fetch('/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setSubmitError(data.error ?? 'Setup failed')
      } else {
        await queryClient.invalidateQueries({ queryKey: ['setup-status'] })
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-[var(--text)]">Setup</h1>
          <p className="mt-1 text-xs text-[var(--muted)]">Configure your agent control plane</p>
        </div>

        {/* Step indicator */}
        <div className="mb-6 flex items-center justify-between">
          {STEPS.map((label, i) => (
            <button
              key={label}
              onClick={() => i < step && setStep(i as Step)}
              className={`flex flex-col items-center gap-1 ${i < step ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium ${
                i === step
                  ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-400'
                  : i < step
                  ? 'border-[var(--s-ok-bd)] bg-[var(--s-ok-bg)] text-[var(--s-ok-tx)]'
                  : 'border-[var(--border-soft)] text-[var(--muted)]'
              }`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`hidden text-[10px] sm:block ${i === step ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>
                {label}
              </span>
            </button>
          ))}
        </div>

        {/* Step content */}
        <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel)] p-6">
          <h2 className="mb-4 text-sm font-medium text-[var(--text)]">{STEPS[step]}</h2>

          {step === 0 && <StepProviders state={state} onChange={setState} />}
          {step === 1 && <StepRouting state={state} onChange={setState} />}
          {step === 2 && <StepPersonality state={state} onChange={setState} />}
          {step === 3 && <StepRules state={state} onChange={setState} />}
          {step === 4 && (
            <StepLaunch
              state={state}
              onSubmit={handleSubmit}
              submitting={submitting}
              error={submitError}
            />
          )}
        </div>

        {/* Navigation */}
        <div className="mt-4 flex items-center justify-between">
          <div>
            {step > 0 && (
              <button onClick={() => setStep((s) => (s - 1) as Step)} className={BTN_SECONDARY}>
                ← Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {onSkip && (
              <button onClick={onSkip} className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline">
                Skip for now
              </button>
            )}
            {step < 4 && (
              <button
                onClick={() => setStep((s) => (s + 1) as Step)}
                disabled={!canAdvance}
                className={BTN_PRIMARY}
              >
                Next →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/james/projects/agent-control-plane/web
npx tsc -b --noEmit 2>&1 | head -20
```

Expected: No errors (or only errors from the stub step components having unused params — those are OK).

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Setup.tsx
git commit -m "feat(setup): Setup.tsx skeleton with wizard state and step navigation"
```

---

### Task 8: Setup.tsx — Step 1 (Providers)

Three expandable cards: Anthropic, OpenAI, Local. The OpenAI card has an API Key tab and a Device Auth tab; device auth pre-creates the provider in the DB before starting the codex flow.

**Files:**
- Modify: `web/src/pages/Setup.tsx`

- [ ] **Step 1: Replace the StepProviders stub**

In `web/src/pages/Setup.tsx`, replace the `StepProviders` function with:

```tsx
type DeviceStep = 'idle' | 'starting' | 'waiting' | 'complete' | 'error'

function StepProviders({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  const updateProvider = (index: number, patch: Partial<ProviderDraft>) => {
    const next = state.providers.map((p, i) => (i === index ? { ...p, ...patch } : p))
    onChange({ ...state, providers: next })
  }

  const toggleCard = (index: number) => {
    updateProvider(index, { active: !state.providers[index].active })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--muted)]">
        Activate at least one provider to continue.
      </p>

      {/* Anthropic card */}
      <AnthropicCard
        draft={state.providers[0]}
        onToggle={() => toggleCard(0)}
        onChange={(patch) => updateProvider(0, patch)}
      />

      {/* OpenAI card */}
      <OpenAICard
        draft={state.providers[1]}
        onToggle={() => toggleCard(1)}
        onChange={(patch) => updateProvider(1, patch)}
      />

      {/* Local card */}
      <LocalCard
        draft={state.providers[2]}
        onToggle={() => toggleCard(2)}
        onChange={(patch) => updateProvider(2, patch)}
      />
    </div>
  )
}

function CardShell({ label, active, onToggle, children }: {
  label: string; active: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border transition ${active ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)]' : 'border-[var(--border-soft)] bg-[var(--panel-subtle)]'}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className={`text-sm font-medium ${active ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>{label}</span>
        <span className={`text-xs font-mono ${active ? 'text-blue-400' : 'text-[var(--muted)]'}`}>
          {active ? 'active' : 'click to configure'}
        </span>
      </button>
      {active && <div className="border-t border-[var(--border-soft)] px-4 py-3">{children}</div>}
    </div>
  )
}

function AnthropicCard({ draft, onToggle, onChange }: {
  draft: ProviderDraft; onToggle: () => void; onChange: (p: Partial<ProviderDraft>) => void
}) {
  return (
    <CardShell label="Anthropic" active={draft.active} onToggle={onToggle}>
      <div className="space-y-3">
        <div>
          <label className={LABEL_CLS}>API Key *</label>
          <input
            type="password"
            value={draft.api_key ?? ''}
            onChange={(e) => onChange({ api_key: e.target.value })}
            placeholder="sk-ant-…"
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label className={LABEL_CLS}>Model</label>
          <input
            value={draft.model ?? ''}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder="claude-sonnet-4-6"
            className={INPUT_CLS}
          />
        </div>
      </div>
    </CardShell>
  )
}

type OpenAITab = 'apikey' | 'device'

function OpenAICard({ draft, onToggle, onChange }: {
  draft: ProviderDraft; onToggle: () => void; onChange: (p: Partial<ProviderDraft>) => void
}) {
  const [tab, setTab] = useState<OpenAITab>('apikey')
  const [deviceStep, setDeviceStep] = useState<DeviceStep>('idle')
  const [deviceUrl, setDeviceUrl] = useState<string | null>(null)
  const [deviceCode, setDeviceCode] = useState<string | null>(null)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'url' | 'code' | null>(null)
  const sessionRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopPolling = () => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null }
  }

  const pollSession = (providerId: string, sessionId: string) => {
    pollRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/providers/${providerId}/codex/auth/device/${sessionId}`)
        const data = await res.json()
        if (data.status === 'complete') {
          setDeviceStep('complete')
        } else if (data.status === 'error') {
          setDeviceStep('error')
          setDeviceError(data.error ?? 'Auth failed')
        } else {
          pollSession(providerId, sessionId)
        }
      } catch {
        pollSession(providerId, sessionId)
      }
    }, 2_000)
  }

  const startDeviceAuth = async () => {
    setDeviceStep('starting')
    setDeviceError(null)
    try {
      // Pre-create the provider so we have an id for the codex auth endpoint
      const createRes = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'openai-wizard', type: 'openai', base_url: 'https://api.openai.com/v1' }),
      })
      const created = await createRes.json()
      if (!createRes.ok) throw new Error(created.error ?? 'Failed to create provider')

      onChange({ id: created.id, name: 'openai-wizard' })

      const authRes = await fetch(`/api/providers/${created.id}/codex/auth/device`, { method: 'POST' })
      const authData = await authRes.json()
      if (!authRes.ok) throw new Error(authData.error ?? 'Failed to start device auth')

      sessionRef.current = authData.session_id
      setDeviceUrl(authData.url)
      setDeviceCode(authData.code)
      setDeviceStep('waiting')
      pollSession(created.id, authData.session_id)
    } catch (err) {
      setDeviceStep('error')
      setDeviceError(err instanceof Error ? err.message : 'Error starting device auth')
    }
  }

  const copyToClipboard = (text: string, which: 'url' | 'code') => {
    navigator.clipboard.writeText(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1_500)
  }

  return (
    <CardShell label="OpenAI" active={draft.active} onToggle={onToggle}>
      <div className="space-y-3">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-[var(--border-soft)] pb-0">
          {(['apikey', 'device'] as OpenAITab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 font-mono text-xs uppercase tracking-wide border-b-2 -mb-px transition ${
                tab === t
                  ? 'border-[var(--sel-bd)] text-blue-400'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {t === 'apikey' ? 'API Key' : 'Device Auth'}
            </button>
          ))}
        </div>

        {tab === 'apikey' && (
          <div className="space-y-3">
            <div>
              <label className={LABEL_CLS}>API Key</label>
              <input
                type="password"
                value={draft.api_key ?? ''}
                onChange={(e) => onChange({ api_key: e.target.value })}
                placeholder="sk-…"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Base URL override (optional)</label>
              <input
                value={draft.base_url}
                onChange={(e) => onChange({ base_url: e.target.value })}
                placeholder="https://api.openai.com/v1"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>Model</label>
              <input
                value={draft.model ?? ''}
                onChange={(e) => onChange({ model: e.target.value })}
                placeholder="gpt-4o"
                className={INPUT_CLS}
              />
            </div>
          </div>
        )}

        {tab === 'device' && (
          <div className="space-y-3">
            <p className="text-xs text-[var(--muted)]">
              Login with your OpenAI / ChatGPT account via the codex CLI.
            </p>
            {deviceStep === 'idle' && (
              <button onClick={startDeviceAuth} className={BTN_PRIMARY}>
                Start device auth
              </button>
            )}
            {deviceStep === 'starting' && (
              <div className="flex items-center gap-2 text-xs text-[var(--muted)] font-mono">
                <span className="inline-block h-2 w-2 rounded-full bg-[var(--s-run-bd)] animate-pulse" />
                Starting…
              </div>
            )}
            {(deviceStep === 'waiting' || deviceStep === 'complete') && deviceUrl && (
              <div className="space-y-3">
                <div className="rounded border border-[var(--border-soft)] bg-[var(--panel-subtle)] px-3 py-2.5">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)] mb-1.5">1. Open this URL</div>
                  <div className="font-mono text-xs text-[var(--text)] break-all mb-2">{deviceUrl}</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(deviceUrl, 'url')}
                      className="flex-1 py-1 text-xs font-mono rounded border border-[var(--border-soft)] text-[var(--muted)] hover:bg-[var(--panel)]"
                    >
                      {copied === 'url' ? 'Copied!' : 'Copy URL'}
                    </button>
                    <button
                      type="button"
                      onClick={() => window.open(deviceUrl, '_blank')}
                      className="flex-1 py-1 text-xs font-mono rounded border border-[var(--sel-bd)] text-blue-400 hover:bg-blue-500/20"
                    >
                      Open ↗
                    </button>
                  </div>
                </div>
                {deviceCode && (
                  <div className="rounded border border-[var(--s-att-bd)] bg-[var(--s-att-bg)] px-3 py-2.5">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--s-att-tx)] mb-1.5">2. Enter this code</div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-2xl font-bold tracking-[0.25em] text-[var(--text)]">{deviceCode}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(deviceCode, 'code')}
                        className="shrink-0 px-3 py-1 text-xs font-mono rounded border border-[var(--s-att-bd)] text-[var(--s-att-tx)] hover:bg-[var(--s-att-bd)]/20"
                      >
                        {copied === 'code' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
                {deviceStep === 'waiting' && (
                  <div className="flex items-center gap-2 text-xs text-[var(--muted)] font-mono">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--s-run-bd)] animate-pulse" />
                    Waiting for browser login…
                  </div>
                )}
                {deviceStep === 'complete' && (
                  <div className="flex items-center gap-2 text-xs text-[var(--s-ok-tx)] font-mono">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--s-ok-bd)]" />
                    Authenticated successfully
                  </div>
                )}
              </div>
            )}
            {deviceStep === 'error' && (
              <div className="space-y-2">
                <div className="text-xs text-[var(--s-blk-tx)] font-mono">{deviceError}</div>
                <button type="button" onClick={() => { setDeviceStep('idle'); stopPolling() }}
                  className="text-xs text-[var(--muted)] underline hover:text-[var(--text)]">
                  Try again
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </CardShell>
  )
}

function LocalCard({ draft, onToggle, onChange }: {
  draft: ProviderDraft; onToggle: () => void; onChange: (p: Partial<ProviderDraft>) => void
}) {
  const [detecting, setDetecting] = useState(false)
  const [detectedModels, setDetectedModels] = useState<string[] | null>(null)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [localType, setLocalType] = useState<'ollama' | 'litellm'>('ollama')

  const detectModels = async () => {
    setDetecting(true)
    setDetectError(null)
    try {
      const res = await fetch(
        `/api/setup/ollama-models?base_url=${encodeURIComponent(draft.base_url)}`
      )
      const data = await res.json()
      if (data.error) {
        setDetectError('Could not reach Ollama — enter model name manually')
        setDetectedModels(null)
      } else {
        const names = (data.models as Array<{ name: string }> ?? []).map((m) => m.name)
        setDetectedModels(names)
        if (names.length > 0 && !draft.model) onChange({ model: names[0] })
      }
    } catch {
      setDetectError('Detection failed — enter model name manually')
    } finally {
      setDetecting(false)
    }
  }

  return (
    <CardShell label="Local (Ollama / LiteLLM)" active={draft.active} onToggle={onToggle}>
      <div className="space-y-3">
        <div>
          <label className={LABEL_CLS}>Base URL</label>
          <input
            value={draft.base_url}
            onChange={(e) => onChange({ base_url: e.target.value })}
            placeholder="http://localhost:11434"
            className={INPUT_CLS}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={detectModels}
            disabled={detecting}
            className={BTN_SECONDARY + ' text-xs py-1.5'}
          >
            {detecting ? 'Detecting…' : 'Detect models'}
          </button>
          {detectError && <span className="text-xs text-[var(--s-att-tx)]">{detectError}</span>}
        </div>
        <div>
          <label className={LABEL_CLS}>Model</label>
          {detectedModels && detectedModels.length > 0 ? (
            <select
              value={draft.model ?? ''}
              onChange={(e) => onChange({ model: e.target.value })}
              className={INPUT_CLS}
            >
              {detectedModels.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input
              value={draft.model ?? ''}
              onChange={(e) => onChange({ model: e.target.value })}
              placeholder="e.g. llama3.2:latest"
              className={INPUT_CLS}
            />
          )}
        </div>
        <div>
          <label className={LABEL_CLS}>Provider type</label>
          <div className="flex gap-3">
            {(['ollama', 'litellm'] as const).map((t) => (
              <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  checked={localType === t}
                  onChange={() => { setLocalType(t); onChange({ type: t }) }}
                  className="accent-blue-400"
                />
                <span className="text-xs text-[var(--text)]">{t === 'ollama' ? 'Ollama' : 'LiteLLM / Other'}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </CardShell>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/james/projects/agent-control-plane/web
npx tsc -b --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Setup.tsx
git commit -m "feat(setup): Step 1 — Providers cards with device auth flow"
```

---

### Task 9: Setup.tsx — Steps 2, 3, 4 (Routing, Personality, Rules)

**Files:**
- Modify: `web/src/pages/Setup.tsx`

- [ ] **Step 1: Replace StepRouting stub**

In `web/src/pages/Setup.tsx`, replace the `StepRouting` function:

```tsx
const ROUTE_LABELS: Record<string, string> = {
  planning: 'Planning',
  dispatching: 'Dispatching',
  discussion: 'Discussion',
}

function RoutingRow({ label, entries, providers, onChange }: {
  label: string
  entries: RoutingEntry[]
  providers: ProviderDraft[]
  onChange: (entries: RoutingEntry[]) => void
}) {
  const activeProviders = providers.filter((p) => p.active)
  const addFallback = () => onChange([...entries, { provider_name: activeProviders[0]?.name ?? '', model: '' }])
  const update = (i: number, patch: Partial<RoutingEntry>) => {
    onChange(entries.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  }
  const remove = (i: number) => onChange(entries.filter((_, idx) => idx !== i))

  const defaultEntries: RoutingEntry[] = entries.length > 0
    ? entries
    : [{ provider_name: activeProviders[0]?.name ?? '', model: activeProviders[0]?.model ?? '' }]

  return (
    <div className="grid grid-cols-[100px_1fr] gap-3 items-start">
      <span className="pt-2 text-xs text-[var(--muted)]">{label}</span>
      <div className="space-y-2">
        {defaultEntries.map((entry, i) => (
          <div key={i} className="flex gap-2 items-center">
            <select
              value={entry.provider_name}
              onChange={(e) => {
                const prov = activeProviders.find((p) => p.name === e.target.value)
                update(i, { provider_name: e.target.value, model: prov?.model ?? entry.model })
              }}
              className="flex-1 bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-2 py-1.5 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--sel-bd)]"
            >
              {activeProviders.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <input
              value={entry.model}
              onChange={(e) => update(i, { model: e.target.value })}
              placeholder="model"
              className="flex-1 bg-[var(--panel-subtle)] border border-[var(--border-soft)] rounded px-2 py-1.5 text-xs text-[var(--text)] placeholder-[var(--muted)] focus:outline-none focus:border-[var(--sel-bd)]"
            />
            {i > 0 && (
              <button type="button" onClick={() => remove(i)} className="text-xs text-[var(--muted)] hover:text-[var(--s-blk-tx)]">✕</button>
            )}
          </div>
        ))}
        <button type="button" onClick={addFallback} className="text-xs text-[var(--muted)] hover:text-[var(--text)] underline">
          + Add fallback
        </button>
      </div>
    </div>
  )
}

function StepRouting({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  const updateRoute = (key: keyof RoutingDraft, entries: RoutingEntry[]) => {
    onChange({ ...state, routing: { ...state.routing, [key]: entries } })
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--muted)]">
        Assign providers to each routing role. The planning route is used when no matching route is found.
      </p>
      <div className="space-y-4">
        {(['planning', 'dispatching', 'discussion'] as const).map((key) => (
          <RoutingRow
            key={key}
            label={ROUTE_LABELS[key]}
            entries={state.routing[key]}
            providers={state.providers}
            onChange={(entries) => updateRoute(key, entries)}
          />
        ))}
      </div>
      <div>
        <label className={LABEL_CLS}>Monthly token budget (0 = unlimited)</label>
        <input
          type="number"
          min={0}
          value={state.costControls.monthlyTokenBudget}
          onChange={(e) => onChange({ ...state, costControls: { monthlyTokenBudget: Number(e.target.value) } })}
          placeholder="0"
          className={INPUT_CLS}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Replace StepPersonality stub**

```tsx
const TONE_OPTIONS: Array<{ value: PersonaDraft['tone']; label: string }> = [
  { value: 'direct', label: 'Direct & concise' },
  { value: 'thorough', label: 'Thorough & deliberate' },
  { value: 'collaborative', label: 'Collaborative & inquisitive' },
]

function StepPersonality({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const update = (patch: Partial<PersonaDraft>) =>
    onChange({ ...state, persona: { ...state.persona, ...patch } })

  return (
    <div className="space-y-4">
      <div>
        <label className={LABEL_CLS}>Name</label>
        <input value={state.persona.name} onChange={(e) => update({ name: e.target.value })} placeholder="Prime" className={INPUT_CLS} />
      </div>
      <div>
        <label className={LABEL_CLS}>Focus</label>
        <input value={state.persona.focus} onChange={(e) => update({ focus: e.target.value })} placeholder="e.g. Senior backend engineer, DevOps specialist" className={INPUT_CLS} />
      </div>
      <div>
        <label className={LABEL_CLS}>Tone</label>
        <div className="flex flex-wrap gap-2">
          {TONE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => update({ tone: opt.value })}
              className={`px-3 py-1.5 text-xs rounded-full border transition ${
                state.persona.tone === opt.value
                  ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)] text-blue-400'
                  : 'border-[var(--border-soft)] text-[var(--muted)] hover:text-[var(--text)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
        >
          <span>{showAdvanced ? '▾' : '▸'}</span> Advanced
        </button>
        {showAdvanced && (
          <div className="mt-2">
            <label className={LABEL_CLS}>Additional instructions</label>
            <textarea
              value={state.persona.instructions}
              onChange={(e) => update({ instructions: e.target.value })}
              placeholder="Behavioral notes, decision-making style, domain expertise, etc."
              rows={4}
              className={INPUT_CLS + ' resize-none'}
            />
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Replace StepRules stub**

```tsx
const PRESET_RULES = [
  { key: 'test_before_delegate', label: 'Always run tests before delegating work to agents' },
  { key: 'no_force_push', label: 'Never force-push to main or protected branches' },
  { key: 'small_prs', label: 'Prefer small, reviewable pull requests over large ones' },
  { key: 'confirm_destructive', label: 'Ask before taking destructive or irreversible actions' },
  { key: 'humans_in_loop', label: 'Keep humans in the loop on external communications' },
]

function StepRules({ state, onChange }: { state: WizardState; onChange: (s: WizardState) => void }) {
  const toggle = (key: string) => {
    const presets = state.rules.presets.includes(key)
      ? state.rules.presets.filter((k) => k !== key)
      : [...state.rules.presets, key]
    onChange({ ...state, rules: { ...state.rules, presets } })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {PRESET_RULES.map((rule) => {
          const on = state.rules.presets.includes(rule.key)
          return (
            <button
              key={rule.key}
              type="button"
              onClick={() => toggle(rule.key)}
              className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                on
                  ? 'border-[var(--sel-bd)] bg-[var(--sel-bg)]'
                  : 'border-[var(--border-soft)] bg-[var(--panel-subtle)] hover:bg-[var(--panel)]'
              }`}
            >
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs ${
                on ? 'border-[var(--sel-bd)] bg-blue-400/20 text-blue-400' : 'border-[var(--border-soft)]'
              }`}>
                {on && '✓'}
              </span>
              <span className={`text-xs ${on ? 'text-[var(--text)]' : 'text-[var(--muted)]'}`}>{rule.label}</span>
            </button>
          )
        })}
      </div>
      <div>
        <label className={LABEL_CLS}>Additional rules</label>
        <textarea
          value={state.rules.custom}
          onChange={(e) => onChange({ ...state, rules: { ...state.rules, custom: e.target.value } })}
          placeholder="Any other constraints or behaviors not listed above"
          rows={3}
          className={INPUT_CLS + ' resize-none'}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/james/projects/agent-control-plane/web
npx tsc -b --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Setup.tsx
git commit -m "feat(setup): Steps 2-4 — Routing, Personality, Standing Rules"
```

---

### Task 10: Setup.tsx — Step 5 (Review + Launch)

**Files:**
- Modify: `web/src/pages/Setup.tsx`

- [ ] **Step 1: Replace StepLaunch stub**

In `web/src/pages/Setup.tsx`, replace the `StepLaunch` function:

```tsx
const TONE_LABEL: Record<PersonaDraft['tone'], string> = {
  direct: 'Direct & concise',
  thorough: 'Thorough & deliberate',
  collaborative: 'Collaborative & inquisitive',
}

function StepLaunch({ state, onSubmit, submitting, error, onGoToStep }: {
  state: WizardState
  onSubmit: (launch: boolean) => void
  submitting: boolean
  error: string | null
  onGoToStep: (step: Step) => void
}) {
  const activeProviders = state.providers.filter((p) => p.active)

  return (
    <div className="space-y-4">
      {/* Providers summary */}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[var(--text)]">Providers</span>
          <button type="button" onClick={() => onGoToStep(0)} className="text-xs text-blue-400 hover:underline">Edit</button>
        </div>
        {activeProviders.length === 0
          ? <p className="text-xs text-[var(--s-att-tx)]">No providers configured</p>
          : activeProviders.map((p) => (
              <div key={p.name} className="text-xs text-[var(--muted)] font-mono">{p.name} ({p.type}) · {p.model || '—'}</div>
            ))
        }
      </div>

      {/* Routing summary */}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[var(--text)]">Routing</span>
          <button type="button" onClick={() => onGoToStep(1)} className="text-xs text-blue-400 hover:underline">Edit</button>
        </div>
        {(['planning', 'dispatching', 'discussion'] as const).map((key) => {
          const entries = state.routing[key]
          if (entries.length === 0) return null
          return (
            <div key={key} className="text-xs text-[var(--muted)]">
              <span className="capitalize">{key}</span>: {entries.map((e) => `${e.provider_name} / ${e.model}`).join(' → ')}
            </div>
          )
        })}
        {state.costControls.monthlyTokenBudget > 0 && (
          <div className="text-xs text-[var(--muted)]">Budget: {state.costControls.monthlyTokenBudget.toLocaleString()} tokens/month</div>
        )}
      </div>

      {/* Personality summary */}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[var(--text)]">Personality</span>
          <button type="button" onClick={() => onGoToStep(2)} className="text-xs text-blue-400 hover:underline">Edit</button>
        </div>
        <div className="text-xs text-[var(--muted)] space-y-0.5">
          <div>Name: <span className="text-[var(--text)]">{state.persona.name || '—'}</span></div>
          <div>Focus: <span className="text-[var(--text)]">{state.persona.focus || '—'}</span></div>
          <div>Tone: <span className="text-[var(--text)]">{TONE_LABEL[state.persona.tone]}</span></div>
        </div>
      </div>

      {/* Rules summary */}
      <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--panel-subtle)] p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[var(--text)]">Standing Rules</span>
          <button type="button" onClick={() => onGoToStep(3)} className="text-xs text-blue-400 hover:underline">Edit</button>
        </div>
        {state.rules.presets.length === 0 && !state.rules.custom
          ? <p className="text-xs text-[var(--muted)]">None configured</p>
          : (
            <div className="text-xs text-[var(--muted)] space-y-0.5">
              {state.rules.presets.map((k) => {
                const rule = PRESET_RULES.find((r) => r.key === k)
                return rule ? <div key={k}>• {rule.label}</div> : null
              })}
              {state.rules.custom && <div>• {state.rules.custom}</div>}
            </div>
          )
        }
      </div>

      {error && (
        <div className="rounded border border-[var(--s-blk-bd)] bg-[var(--s-blk-bg)] px-3 py-2">
          <p className="text-xs text-[var(--s-blk-tx)] font-mono">{error}</p>
          <p className="text-xs text-[var(--muted)] mt-1">The endpoint is safe to retry — providers won't be duplicated.</p>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={() => onSubmit(true)} disabled={submitting} className={BTN_PRIMARY}>
          {submitting ? 'Launching…' : 'Launch Prime Agent'}
        </button>
        <button onClick={() => onSubmit(false)} disabled={submitting} className={BTN_SECONDARY}>
          Save & configure later
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update Setup to pass onGoToStep to StepLaunch**

In the `Setup` function body, the `StepLaunch` render currently passes `onSubmit`, `submitting`, and `error`. Add `onGoToStep`:

```tsx
          {step === 4 && (
            <StepLaunch
              state={state}
              onSubmit={handleSubmit}
              submitting={submitting}
              error={submitError}
              onGoToStep={(s) => setStep(s)}
            />
          )}
```

Also update `StepLaunch`'s prop type to add `onGoToStep`. The function signature already has it from the replacement above.

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
cd /home/james/projects/agent-control-plane/web
npx tsc -b --noEmit 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 4: Run the full backend test suite one final time**

```bash
cd /home/james/projects/agent-control-plane/backend
npm run test:db 2>&1 | tail -15
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/Setup.tsx
git commit -m "feat(setup): Step 5 — Review and Launch with submit logic"
```

---

## Self-Review Against Spec

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| `setup_complete` DB column | Task 1 |
| `GET /api/setup/status` — providers short-circuit | Task 2 |
| `GET /api/setup/ollama-models` — 3s timeout, `unreachable` on failure | Task 2 |
| `POST /api/setup/complete` — all write steps | Task 3 |
| Mount under `/api/setup` | Task 4 |
| `buildPrimeSystemPrompt` async + pool + chief_profiles prefix | Task 5 |
| `useSetupStatus` with `staleTime: Infinity` | Task 6 |
| App.tsx — loading spinner, Setup vs Layout conditional | Task 6 |
| Setup.tsx — "Skip for now" → sessionStorage flag | Task 7 |
| Wizard state in single `WizardState` object | Task 7 |
| Step 1 — Anthropic card (API key, model) | Task 8 |
| Step 1 — OpenAI card (API Key tab + Device Auth tab) | Task 8 |
| Step 1 — Device auth pre-creates provider, stores id | Task 8 |
| Step 1 — Local card (base_url, detect models, type radio) | Task 8 |
| Step 1 — at least one card active to advance | Task 7 |
| Step 2 — three route rows, primary + fallback | Task 9 |
| Step 2 — monthly token budget field | Task 9 |
| Step 3 — Name, Focus, Tone radio pills | Task 9 |
| Step 3 — Advanced section with instructions textarea | Task 9 |
| Step 4 — five preset toggles, custom textarea | Task 9 |
| Step 5 — summary sections with Edit links | Task 10 |
| Step 5 — Launch / Save buttons, launch=true/false | Task 10 |
| Step 5 — on success, invalidate `setup-status` | Task 7 (in handleSubmit) |
| Step 5 — on error, inline message + retry safe | Task 10 |
| chief_profiles not written until step 5 submit | Tasks 7-10 |
| `POST /api/setup/complete` skips pre-created provider by id | Task 3 |
| `POST /api/setup/complete` upserts provider by name on retry | Task 3 |

**Placeholder scan:** No TBDs or placeholder text in implementation code.

**Type consistency:** `ProviderDraft`, `RoutingEntry`, `WizardState` defined once in Task 7 and used consistently through Tasks 8-10. `Step` type is `0 | 1 | 2 | 3 | 4` used consistently. `PRESET_RULES` array defined in Task 9 and referenced in Task 10's `StepLaunch`.
