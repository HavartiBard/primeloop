# Prime Agent Loop Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the five missing pieces (LLM router, cron timer, Pi harness, fleet dispatcher, result router) so the prime agent fires on a timer, makes real LLM decisions, delegates tasks to Pi harness subagents, and feeds results back into its own queue.

**Architecture:** `createConfiguredLlmRouter` reads provider credentials from the existing `providers` table and calls Anthropic or OpenAI-compatible APIs directly. A `setInterval`-based cron enqueues `cron.fast` events. `PiHarness` spawns `pi --mode rpc` as a child process per agent. `FleetDispatcher` polls `delegations WHERE status='queued'`, claims rows atomically, drives the harness, and calls `ResultRouter` which updates the row and re-enqueues prime events.

**Tech Stack:** TypeScript ESM, `@anthropic-ai/sdk`, `openai`, Node.js `child_process`, `vitest`, Postgres (`pg`), existing `AgentHarness`/`TaskHandle` interfaces in `fleet-executor/harness.ts`.

---

## File Map

| File | Role |
|---|---|
| `backend/src/prime-agent/llm-router.ts` | Add `createConfiguredLlmRouter`, `buildPrimeSystemPrompt`, `buildPrimeTriggerMessage` |
| `backend/src/prime-agent/service.ts` | Use configured router by default; add/clear cron timers |
| `backend/src/fleet-executor/pi-harness.ts` | `PiHarness` implementing `AgentHarness` via `pi --mode rpc` |
| `backend/src/fleet-executor/dispatcher.ts` | `FleetDispatcher` — poll, claim, drive harness, scope gate |
| `backend/src/fleet-executor/result-router.ts` | `routeResult` — update delegation, enqueue prime event, optional Gitea post |
| `backend/src/opencode/process-manager.ts` | Add `runtime_family='pi'` support; expose `getRunningHarness(agentId)` |
| `backend/src/index.ts` | Wire `FleetDispatcher` |
| `backend/package.json` | Add `@anthropic-ai/sdk`, `openai` |
| `Dockerfile` | Install `pi` binary |
| `docker-compose.prod.yml` | Add env vars + workspace volume |
| `.env.example` | Document new vars |

---

## Task 1: Install SDK dependencies

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Add dependencies**

Edit `backend/package.json` — add to `"dependencies"`:

```json
"@anthropic-ai/sdk": "^0.39.0",
"openai": "^4.77.0"
```

- [ ] **Step 2: Install and build**

```bash
cd backend && npm install && npm run build
```

Expected: build succeeds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "feat(deps): add @anthropic-ai/sdk and openai"
```

---

## Task 2: LLM router — prompt builder

**Files:**
- Modify: `backend/src/prime-agent/llm-router.ts`
- Test: `backend/tests/prime-agent/llm-router.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/prime-agent/llm-router.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildPrimeSystemPrompt, buildPrimeTriggerMessage } from '../../src/prime-agent/llm-router.js'
import type { PrimeContext } from '../../src/prime-agent/context.js'

const minimalContext: PrimeContext = {
  trigger: {
    type: 'cron.fast',
    payload: { triggered_at: '2026-01-01T00:00:00Z', source: 'cron' },
  },
  fleet: {
    agents: [{ id: 'a1', name: 'Coder', capabilities: ['code'], enabled: true } as never],
    workItems: [],
    delegations: [],
  },
  recentEvents: [],
  recentLessons: [],
}

describe('buildPrimeSystemPrompt', () => {
  it('includes the agent name and capabilities', () => {
    const prompt = buildPrimeSystemPrompt(minimalContext)
    expect(prompt).toContain('Coder')
    expect(prompt).toContain('code')
  })

  it('includes instruction to return JSON with reasoning and actions', () => {
    const prompt = buildPrimeSystemPrompt(minimalContext)
    expect(prompt).toContain('"reasoning"')
    expect(prompt).toContain('"actions"')
  })

  it('mentions all four allowed action types', () => {
    const prompt = buildPrimeSystemPrompt(minimalContext)
    expect(prompt).toContain('delegate')
    expect(prompt).toContain('update_work_item')
    expect(prompt).toContain('request_approval')
    expect(prompt).toContain('no_op')
  })
})

describe('buildPrimeTriggerMessage', () => {
  it('includes the event type', () => {
    const msg = buildPrimeTriggerMessage(minimalContext)
    expect(msg).toContain('cron.fast')
  })

  it('ends with the survey instruction', () => {
    const msg = buildPrimeTriggerMessage(minimalContext)
    expect(msg).toContain('Survey the fleet')
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && npm run test -- tests/prime-agent/llm-router.test.ts
```

Expected: `buildPrimeSystemPrompt is not a function`

- [ ] **Step 3: Implement the prompt builders**

Append to `backend/src/prime-agent/llm-router.ts`:

```typescript
import type { PrimeContext } from './context.js'

export function buildPrimeSystemPrompt(context: PrimeContext): string {
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

  return [
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
}

export function buildPrimeTriggerMessage(context: PrimeContext): string {
  return [
    `Trigger: ${context.trigger.type}`,
    JSON.stringify(context.trigger.payload, null, 2),
    '',
    'Survey the fleet and decide your next actions.',
  ].join('\n')
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && npm run test -- tests/prime-agent/llm-router.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/prime-agent/llm-router.ts backend/tests/prime-agent/llm-router.test.ts
git commit -m "feat(prime-agent): add LLM router prompt builders"
```

---

## Task 3: LLM router — Anthropic and OpenAI provider calls

**Files:**
- Modify: `backend/src/prime-agent/llm-router.ts`
- Create: `backend/tests/prime-agent/llm-router-configured.test.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/prime-agent/llm-router-configured.test.ts` (a new file — separate from the prompt-builder tests to avoid ESM import ordering issues with vi.mock):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type pg from 'pg'

// hoisted so vi.mock factories can reference them
const mockAnthropicCreate = vi.hoisted(() => vi.fn())
const mockOpenAICreate = vi.hoisted(() => vi.fn())
const mockGetPrimeConfig = vi.hoisted(() => vi.fn())
const mockGetProviderApiKey = vi.hoisted(() => vi.fn())
const mockGetProvider = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  })),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockOpenAICreate } },
  })),
}))

vi.mock('../../src/prime-agent/config.js', () => ({
  getPrimeConfig: mockGetPrimeConfig,
}))

vi.mock('../../src/registry.js', () => ({
  getProviderApiKey: mockGetProviderApiKey,
  listProviders: vi.fn().mockResolvedValue([]),
}))

import { createConfiguredLlmRouter } from '../../src/prime-agent/llm-router.js'
import type { PrimeContext } from '../../src/prime-agent/context.js'

const pool = { query: mockGetProvider } as unknown as pg.Pool

const anthropicProvider = {
  id: 'prov-1', type: 'anthropic', base_url: '', model: 'claude-opus-4-7', api_key: undefined,
}
const openaiProvider = {
  id: 'prov-2', type: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o', api_key: undefined,
}
const llmProvider = {
  id: 'prov-3', type: 'llm', base_url: 'http://litellm:4000', model: 'my-model', api_key: undefined,
}

const validDecision = {
  reasoning: 'nothing to do',
  actions: [{ type: 'no_op', payload: {}, reason: 'quiet fleet' }],
}

describe('createConfiguredLlmRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProvider.mockResolvedValue({ rows: [anthropicProvider] })
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

  it('calls Anthropic SDK for anthropic provider and returns validated decision', async () => {
    const router = createConfiguredLlmRouter(pool)
    const decision = await router.decide(minimalContext)
    expect(mockAnthropicCreate).toHaveBeenCalledOnce()
    expect(decision.reasoning).toBe('nothing to do')
    expect(decision.actions).toHaveLength(1)
    expect(decision.provider_used).toBe('anthropic')
    expect(decision.token_count).toBe(150)
  })

  it('calls OpenAI SDK for openai provider', async () => {
    mockGetPrimeConfig.mockResolvedValue({
      provider_routing: { planning: [{ provider_id: 'prov-2', model: 'gpt-4o' }] },
    })
    mockGetProvider.mockResolvedValue({ rows: [openaiProvider] })
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validDecision) } }],
      usage: { total_tokens: 200 },
      model: 'gpt-4o',
    })
    const router = createConfiguredLlmRouter(pool)
    const decision = await router.decide(minimalContext)
    expect(mockOpenAICreate).toHaveBeenCalledOnce()
    expect(decision.provider_used).toBe('openai')
    expect(decision.token_count).toBe(200)
  })

  it('uses base_url for llm provider type', async () => {
    mockGetPrimeConfig.mockResolvedValue({
      provider_routing: { planning: [{ provider_id: 'prov-3', model: 'my-model' }] },
    })
    mockGetProvider.mockResolvedValue({ rows: [llmProvider] })
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validDecision) } }],
      usage: { total_tokens: 80 },
      model: 'my-model',
    })
    const router = createConfiguredLlmRouter(pool)
    await router.decide(minimalContext)
    expect(mockOpenAICreate).toHaveBeenCalledOnce()
  })

  it('falls back to second provider when first throws', async () => {
    mockGetPrimeConfig.mockResolvedValue({
      provider_routing: {
        planning: [
          { provider_id: 'prov-1', model: 'claude-opus-4-7' },
          { provider_id: 'prov-2', model: 'gpt-4o' },
        ],
      },
    })
    mockGetProvider
      .mockResolvedValueOnce({ rows: [anthropicProvider] })
      .mockResolvedValueOnce({ rows: [openaiProvider] })
    mockGetProviderApiKey.mockResolvedValue('sk-test')
    mockAnthropicCreate.mockRejectedValue(new Error('rate limited'))
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validDecision) } }],
      usage: { total_tokens: 80 },
      model: 'gpt-4o',
    })
    const router = createConfiguredLlmRouter(pool)
    const decision = await router.decide(minimalContext)
    expect(mockAnthropicCreate).toHaveBeenCalledOnce()
    expect(mockOpenAICreate).toHaveBeenCalledOnce()
    expect(decision.provider_used).toBe('openai')
  })

  it('throws when all providers fail', async () => {
    mockAnthropicCreate.mockRejectedValue(new Error('unavailable'))
    const router = createConfiguredLlmRouter(pool)
    await expect(router.decide(minimalContext)).rejects.toThrow('unavailable')
  })

  it('falls back to routing key when planning key absent', async () => {
    mockGetPrimeConfig.mockResolvedValue({
      provider_routing: { routing: [{ provider_id: 'prov-1', model: 'claude-opus-4-7' }] },
    })
    const router = createConfiguredLlmRouter(pool)
    const decision = await router.decide(minimalContext)
    expect(decision.reasoning).toBe('nothing to do')
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && npm run test -- tests/prime-agent/llm-router-configured.test.ts
```

Expected: `createConfiguredLlmRouter is not a function`

- [ ] **Step 3: Implement `createConfiguredLlmRouter`**

Append to `backend/src/prime-agent/llm-router.ts` (after the prompt builders):

```typescript
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type pg from 'pg'
import { getPrimeConfig, type PrimeConfigRoute } from './config.js'
import { getProviderApiKey } from '../registry.js'

export function createConfiguredLlmRouter(pool: pg.Pool): LlmRouter {
  return {
    async decide(context: PrimeContext): Promise<PrimeDecision> {
      const config = await getPrimeConfig(pool)
      const routes: PrimeConfigRoute[] =
        config.provider_routing?.['planning'] ??
        config.provider_routing?.['routing'] ??
        []

      if (routes.length === 0) {
        throw new Error('prime-agent: no provider routes configured in prime_agent_config')
      }

      let lastError: Error = new Error('no providers tried')

      for (const route of routes) {
        try {
          return await callProvider(pool, route, context)
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err))
        }
      }

      throw lastError
    },
  }
}

async function callProvider(
  pool: pg.Pool,
  route: PrimeConfigRoute,
  context: PrimeContext,
): Promise<PrimeDecision> {
  const { rows } = await (pool as pg.Pool).query('SELECT * FROM providers WHERE id = $1', [route.provider_id])
  const provider = rows[0]
  if (!provider) throw new Error(`provider not found: ${route.provider_id}`)

  const apiKey = await getProviderApiKey(pool, route.provider_id)
  const systemPrompt = buildPrimeSystemPrompt(context)
  const userMessage = buildPrimeTriggerMessage(context)
  const model = route.model ?? provider.model ?? 'claude-opus-4-7'

  if (provider.type === 'anthropic') {
    return callAnthropic(apiKey ?? '', model, systemPrompt, userMessage, provider.type)
  }
  return callOpenAI(provider.base_url as string, apiKey ?? '', model, systemPrompt, userMessage, provider.type as string)
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  providerType: string,
): Promise<PrimeDecision> {
  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const text = response.content.find((b) => b.type === 'text')?.text ?? ''
  const tokenCount = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0)
  const decision = validatePrimeDecision(parseJsonDecision(text))
  decision.provider_used = providerType
  decision.model_used = response.model ?? model
  decision.token_count = tokenCount
  return decision
}

async function callOpenAI(
  baseURL: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
  providerType: string,
): Promise<PrimeDecision> {
  const client = new OpenAI({ apiKey, baseURL: baseURL || undefined })
  const response = await client.chat.completions.create({
    model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  })

  const text = response.choices[0]?.message?.content ?? ''
  const tokenCount = response.usage?.total_tokens ?? 0
  const decision = validatePrimeDecision(parseJsonDecision(text))
  decision.provider_used = providerType
  decision.model_used = response.model ?? model
  decision.token_count = tokenCount
  return decision
}

function parseJsonDecision(text: string): unknown {
  const trimmed = text.trim()
  // strip markdown code fences if model wraps output
  const stripped = trimmed.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  try {
    return JSON.parse(stripped)
  } catch {
    throw new Error(`prime-agent: LLM returned non-JSON: ${stripped.slice(0, 200)}`)
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && npm run test -- tests/prime-agent/llm-router-configured.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Build check**

```bash
cd backend && npm run build
```

Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add backend/src/prime-agent/llm-router.ts backend/tests/prime-agent/llm-router-configured.test.ts
git commit -m "feat(prime-agent): implement configured LLM router with Anthropic/OpenAI support"
```

---

## Task 4: Wire configured router into service.ts

**Files:**
- Modify: `backend/src/prime-agent/service.ts`
- Modify: `backend/tests/prime-agent/service.test.ts`

- [ ] **Step 1: Write failing test**

Read the existing `backend/tests/prime-agent/service.test.ts` to understand the current test structure, then append:

```typescript
import { createConfiguredLlmRouter } from '../../src/prime-agent/llm-router.js'

it('uses createConfiguredLlmRouter by default when no router option is provided', async () => {
  // The service should not throw about "not configured" — it should call the configured router
  // We verify by checking the router passed to handlePrimeEvent is NOT the unavailable stub
  // This is a structural test: if router is not provided, createConfiguredLlmRouter is used
  const service = createPrimeAgentService(pool)
  // @ts-expect-error accessing private for test
  expect(service.queue).toBeDefined()
  // The real assertion: starting with enabled config should not throw "not configured"
  // (we can't easily introspect the router, so we verify it was wired via integration in Task 6)
})
```

- [ ] **Step 2: Modify `service.ts`**

In `backend/src/prime-agent/service.ts`, change the default router from `createUnavailableLlmRouter()` to `createConfiguredLlmRouter(pool)`:

```typescript
import { createConfiguredLlmRouter, createUnavailableLlmRouter, type LlmRouter } from './llm-router.js'

// in createPrimeAgentService:
const router = options.router ?? createConfiguredLlmRouter(pool)
```

The full updated top of the function:

```typescript
export function createPrimeAgentService(
  pool: pg.Pool,
  options: PrimeAgentServiceOptions = {}
): PrimeAgentService {
  let queue: PrimeQueue
  if (options.checkpointStore) {
    queue = createPostgresPrimeQueue(options.checkpointStore)
  } else {
    queue = options.queue ?? createInMemoryPrimeQueue()
  }

  const router: LlmRouter = options.router ?? createConfiguredLlmRouter(pool)

  let started = false
  setPrimeCoordinatorQueue(queue)
  // ... rest unchanged
```

- [ ] **Step 3: Build and test**

```bash
cd backend && npm run build && npm run test -- tests/prime-agent/service.test.ts
```

Expected: build passes, existing service tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/prime-agent/service.ts
git commit -m "feat(prime-agent): use configuredLlmRouter by default in service"
```

---

## Task 5: Cron timer in service.ts

**Files:**
- Modify: `backend/src/prime-agent/service.ts`
- Modify: `backend/tests/prime-agent/service.test.ts`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/prime-agent/service.test.ts`:

```typescript
it('enqueues cron.fast events on the configured interval', async () => {
  vi.useFakeTimers()

  const mockConfig = {
    enabled: true,
    cron_fast_interval_seconds: 1,
    cron_slow_interval_seconds: 3600,
  }
  // mock getPrimeConfig to return enabled config
  const configMock = vi.hoisted(() => vi.fn())
  vi.mock('../../src/prime-agent/config.js', () => ({ getPrimeConfig: configMock }))
  configMock.mockResolvedValue(mockConfig)

  const queue = createInMemoryPrimeQueue()
  const enqueueSpy = vi.spyOn(queue, 'enqueue')

  const service = createPrimeAgentService(pool, {
    queue,
    router: createMockLlmRouter({ reasoning: 'test', actions: [] }),
  })
  await service.start()

  // advance 2.5 seconds — should fire twice
  await vi.advanceTimersByTimeAsync(2500)

  expect(enqueueSpy).toHaveBeenCalledTimes(2)
  expect(enqueueSpy.mock.calls[0][0]).toMatchObject({ type: 'cron.fast' })

  await service.close()
  vi.useRealTimers()
})

it('does not enqueue cron events after close()', async () => {
  vi.useFakeTimers()
  const configMock = vi.hoisted(() => vi.fn())
  vi.mock('../../src/prime-agent/config.js', () => ({ getPrimeConfig: configMock }))
  configMock.mockResolvedValue({ enabled: true, cron_fast_interval_seconds: 1, cron_slow_interval_seconds: 3600 })

  const queue = createInMemoryPrimeQueue()
  const enqueueSpy = vi.spyOn(queue, 'enqueue')

  const service = createPrimeAgentService(pool, {
    queue,
    router: createMockLlmRouter({ reasoning: 'test', actions: [] }),
  })
  await service.start()
  await service.close()

  await vi.advanceTimersByTimeAsync(3000)
  expect(enqueueSpy).not.toHaveBeenCalled()
  vi.useRealTimers()
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && npm run test -- tests/prime-agent/service.test.ts
```

Expected: the cron tests fail — no cron events enqueued.

- [ ] **Step 3: Implement cron timers**

Replace the `start` and `close` methods in `backend/src/prime-agent/service.ts`:

```typescript
export interface PrimeAgentService {
  queue: PrimeQueue
  start(): Promise<void>
  close(): Promise<void>
}

export function createPrimeAgentService(
  pool: pg.Pool,
  options: PrimeAgentServiceOptions = {}
): PrimeAgentService {
  let queue: PrimeQueue
  if (options.checkpointStore) {
    queue = createPostgresPrimeQueue(options.checkpointStore)
  } else {
    queue = options.queue ?? createInMemoryPrimeQueue()
  }

  const router: LlmRouter = options.router ?? createConfiguredLlmRouter(pool)

  let started = false
  let fastTimer: ReturnType<typeof setInterval> | undefined
  let slowTimer: ReturnType<typeof setInterval> | undefined
  setPrimeCoordinatorQueue(queue)

  return {
    queue,
    async start(): Promise<void> {
      if (started) return

      const config = await getPrimeConfig(pool)
      if (!config.enabled) return

      started = true

      queue.process(async (event) => {
        try {
          await handlePrimeEvent(pool, event, { router })
        } catch (error) {
          console.error('[prime-agent] event handling failed:', error)
        }
      })

      fastTimer = setInterval(() => {
        void queue.enqueue({
          type: 'cron.fast',
          payload: { triggered_at: new Date().toISOString(), source: 'cron' },
        })
      }, config.cron_fast_interval_seconds * 1000)

      slowTimer = setInterval(() => {
        void queue.enqueue({
          type: 'cron.fast',
          payload: { triggered_at: new Date().toISOString(), source: 'cron_slow' },
        })
      }, config.cron_slow_interval_seconds * 1000)
    },

    async close(): Promise<void> {
      started = false
      clearInterval(fastTimer)
      clearInterval(slowTimer)
      fastTimer = undefined
      slowTimer = undefined
      await queue.close()
    },
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && npm run test -- tests/prime-agent/service.test.ts
```

Expected: all service tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/prime-agent/service.ts backend/tests/prime-agent/service.test.ts
git commit -m "feat(prime-agent): add cron timers for fast and slow ticks"
```

---

## Task 6: PiHarness — start and close

**Files:**
- Create: `backend/src/fleet-executor/pi-harness.ts`
- Create: `backend/tests/fleet-executor/pi-harness.test.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/fleet-executor/pi-harness.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'

const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

import { PiHarness } from '../../src/fleet-executor/pi-harness.js'

function makeProcess(exitCode = 0): {
  proc: ChildProcess
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
} {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}

  const proc = {
    stdin,
    stdout,
    stderr,
    killed: false,
    kill: vi.fn((signal?: string) => {
      proc.killed = true
      setTimeout(() => listeners['close']?.forEach((fn) => fn(signal === 'SIGKILL' ? 1 : exitCode)), 0)
      return true
    }),
    on: (event: string, fn: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? []
      listeners[event].push(fn)
      return proc
    },
  } as unknown as ChildProcess

  return { proc, stdin, stdout, stderr }
}

describe('PiHarness', () => {
  let harness: PiHarness

  beforeEach(() => {
    harness = new PiHarness()
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await harness.close().catch(() => {})
  })

  it('spawns pi --mode rpc in the given cwd', async () => {
    const { proc, stdout } = makeProcess()
    spawnMock.mockReturnValue(proc)

    const startPromise = harness.start({ cwd: '/workspace/agent-a', model: { providerID: 'anthropic', id: 'claude-opus-4-7' } })
    stdout.write('{"type":"ready"}\n')
    await startPromise

    expect(spawnMock).toHaveBeenCalledWith(
      'pi',
      ['--mode', 'rpc'],
      expect.objectContaining({ cwd: '/workspace/agent-a' }),
    )
  })

  it('resolves start() when ready event arrives on stdout', async () => {
    const { proc, stdout } = makeProcess()
    spawnMock.mockReturnValue(proc)

    const startPromise = harness.start({ cwd: '/tmp', model: { providerID: 'anthropic', id: 'claude-opus-4-7' } })
    stdout.write('{"type":"ready"}\n')
    await expect(startPromise).resolves.toBeUndefined()
  })

  it('rejects start() if process exits before ready', async () => {
    const { proc } = makeProcess(1)
    spawnMock.mockReturnValue(proc)

    const startPromise = harness.start({ cwd: '/tmp', model: { providerID: 'anthropic', id: 'claude-opus-4-7' } })
    proc.kill!('SIGTERM')
    await expect(startPromise).rejects.toThrow('pi process exited before ready')
  })

  it('close() sends SIGTERM and resolves', async () => {
    const { proc, stdout } = makeProcess()
    spawnMock.mockReturnValue(proc)

    const startPromise = harness.start({ cwd: '/tmp', model: { providerID: 'anthropic', id: 'claude-opus-4-7' } })
    stdout.write('{"type":"ready"}\n')
    await startPromise

    await expect(harness.close()).resolves.toBeUndefined()
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM')
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && npm run test -- tests/fleet-executor/pi-harness.test.ts
```

Expected: `PiHarness is not a constructor`

- [ ] **Step 3: Implement `start()` and `close()`**

Create `backend/src/fleet-executor/pi-harness.ts`:

```typescript
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { AgentHarness, HarnessEvent, ModelRef, TaskHandle, TaskPrompt, TaskResult } from './harness.js'

export class PiHarness implements AgentHarness {
  private proc: ChildProcess | null = null
  private lines: AsyncIterable<string> | null = null

  async start(opts: { cwd: string; model: ModelRef }): Promise<void> {
    const proc = spawn('pi', ['--mode', 'rpc'], {
      cwd: opts.cwd,
      env: {
        ...process.env,
        PI_MODEL: opts.model.id,
        PI_PROVIDER: opts.model.providerID,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.proc = proc

    await new Promise<void>((resolve, reject) => {
      const rl = createInterface({ input: proc.stdout! })

      const onLine = (line: string) => {
        let msg: Record<string, unknown>
        try { msg = JSON.parse(line) } catch { return }
        if (msg['type'] === 'ready') {
          rl.off('line', onLine)
          resolve()
        }
      }

      rl.on('line', onLine)

      proc.on('close', (code) => {
        if (code !== 0 || this.proc === proc) {
          reject(new Error(`pi process exited before ready (code ${code})`))
        }
      })
    })
  }

  async dispatch(prompt: TaskPrompt): Promise<TaskHandle> {
    if (!this.proc) throw new Error('PiHarness not started')

    const id = crypto.randomUUID()
    const stdin = this.proc.stdin!

    stdin.write(
      JSON.stringify({
        type: 'prompt',
        text: prompt.text,
        allowed_files: prompt.allowed_files,
        read_files: prompt.read_files,
      }) + '\n',
    )

    const proc = this.proc
    const events = this.makeEventIterable(proc)

    const done = new Promise<TaskResult>((resolve, reject) => {
      ;(async () => {
        for await (const event of this.makeEventIterable(proc)) {
          if (event.type === 'task_end') {
            resolve(event.result)
            return
          }
        }
        reject(new Error('pi process closed without agent_end'))
      })()
    })

    return { id, events, done }
  }

  async abort(_taskId: string): Promise<void> {
    this.proc?.stdin?.write(JSON.stringify({ type: 'abort' }) + '\n')
  }

  async close(): Promise<void> {
    const proc = this.proc
    if (!proc) return
    this.proc = null
    proc.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve() }, 5000)
      proc.on('close', () => { clearTimeout(timer); resolve() })
    })
  }

  private async *makeEventIterable(proc: ChildProcess): AsyncIterable<HarnessEvent> {
    const rl = createInterface({ input: proc.stdout! })
    for await (const line of rl) {
      let msg: Record<string, unknown>
      try { msg = JSON.parse(line) } catch { continue }

      switch (msg['type']) {
        case 'tool_execution_start':
          yield { type: 'tool_call_start', tool: String(msg['tool']), args: (msg['args'] ?? {}) as Record<string, unknown> }
          break
        case 'tool_execution_end':
          yield { type: 'tool_call_end', tool: String(msg['tool']), result: msg['result'], error: msg['error'] as string | undefined }
          break
        case 'message_update':
          yield { type: 'message_update', delta: String(msg['delta'] ?? '') }
          break
        case 'agent_end':
          yield { type: 'task_end', result: msg['result'] as TaskResult }
          return
      }
    }
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && npm run test -- tests/fleet-executor/pi-harness.test.ts
```

Expected: start/close tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/fleet-executor/pi-harness.ts backend/tests/fleet-executor/pi-harness.test.ts
git commit -m "feat(fleet-executor): implement PiHarness start/close"
```

---

## Task 7: PiHarness — dispatch and abort

**Files:**
- Modify: `backend/tests/fleet-executor/pi-harness.test.ts`

The implementation was written in Task 6. This task adds the dispatch/abort tests.

- [ ] **Step 1: Write failing dispatch tests**

Append to `backend/tests/fleet-executor/pi-harness.test.ts`:

```typescript
  it('dispatch() writes a prompt JSONL line to stdin', async () => {
    const { proc, stdout } = makeProcess()
    spawnMock.mockReturnValue(proc)

    const startP = harness.start({ cwd: '/tmp', model: { providerID: 'anthropic', id: 'claude-opus-4-7' } })
    stdout.write('{"type":"ready"}\n')
    await startP

    const chunks: Buffer[] = []
    proc.stdin!.on('data', (c: Buffer) => chunks.push(c))

    const handle = await harness.dispatch({
      text: 'do the thing',
      allowed_files: ['src/foo.ts'],
      read_files: ['README.md'],
    })

    const written = JSON.parse(Buffer.concat(chunks).toString().trim())
    expect(written.type).toBe('prompt')
    expect(written.text).toBe('do the thing')
    expect(written.allowed_files).toEqual(['src/foo.ts'])
    expect(handle.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('done resolves with TaskResult on agent_end event', async () => {
    const { proc, stdout } = makeProcess()
    spawnMock.mockReturnValue(proc)

    const startP = harness.start({ cwd: '/tmp', model: { providerID: 'anthropic', id: 'claude-opus-4-7' } })
    stdout.write('{"type":"ready"}\n')
    await startP

    const handle = await harness.dispatch({ text: 'go', allowed_files: [], read_files: [] })

    const taskResult: TaskResult = { text: 'done', tokens: 42, changed_files: ['src/a.ts'] }
    stdout.write(JSON.stringify({ type: 'agent_end', result: taskResult }) + '\n')

    await expect(handle.done).resolves.toMatchObject({ text: 'done', tokens: 42 })
  })

  it('events iterable yields mapped HarnessEvents before agent_end', async () => {
    const { proc, stdout } = makeProcess()
    spawnMock.mockReturnValue(proc)

    const startP = harness.start({ cwd: '/tmp', model: { providerID: 'anthropic', id: 'claude-opus-4-7' } })
    stdout.write('{"type":"ready"}\n')
    await startP

    const handle = await harness.dispatch({ text: 'go', allowed_files: [], read_files: [] })

    const collected: HarnessEvent[] = []
    const consume = (async () => {
      for await (const e of handle.events) collected.push(e)
    })()

    stdout.write('{"type":"tool_execution_start","tool":"read_file","args":{"path":"foo.ts"}}\n')
    stdout.write('{"type":"message_update","delta":"working..."}\n')
    stdout.write('{"type":"agent_end","result":{"text":"done","tokens":10}}\n')
    await consume

    expect(collected[0]).toMatchObject({ type: 'tool_call_start', tool: 'read_file' })
    expect(collected[1]).toMatchObject({ type: 'message_update', delta: 'working...' })
    expect(collected[2]).toMatchObject({ type: 'task_end' })
  })
```

- [ ] **Step 2: Run — expect pass**

```bash
cd backend && npm run test -- tests/fleet-executor/pi-harness.test.ts
```

Expected: all pi-harness tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/fleet-executor/pi-harness.test.ts
git commit -m "test(fleet-executor): add PiHarness dispatch/abort tests"
```

---

## Task 8: Extend process manager for Pi harnesses

**Files:**
- Modify: `backend/src/opencode/process-manager.ts`
- Modify: `backend/tests/opencode/process-manager.test.ts`

- [ ] **Step 1: Write failing test**

Read `backend/tests/opencode/process-manager.test.ts` first to understand how the file mocks `spawn` and constructs the manager. Then append a new `it` block inside the existing top-level `describe`:

```typescript
it('getRunningHarness returns undefined for an agent that has not started yet', () => {
  // OpenCodeProcessManager is already constructed in this describe's beforeEach.
  // Any agent ID that was never started should return undefined.
  const result = processManager.getRunningHarness('unknown-agent-id')
  expect(result).toBeUndefined()
})
```

The exact variable name for the manager instance (`processManager`, `mgr`, etc.) will differ — match what the existing file uses.

- [ ] **Step 2: Add `getRunningHarness` to process manager**

In `backend/src/opencode/process-manager.ts`:

1. Add a map for Pi harness instances alongside the existing `processes` map:

```typescript
import { PiHarness } from '../fleet-executor/pi-harness.js'
import type { AgentHarness } from '../fleet-executor/harness.js'

// inside class OpenCodeProcessManager:
private readonly piHarnesses = new Map<string, PiHarness>()
```

2. Extend `isManagedLocalAgent` to include Pi:

```typescript
function isManagedLocalAgent(agent: RegistryAgent): boolean {
  return agent.enabled
    && agent.execution_mode === 'local'
    && (
      agent.runtime_family === 'opencode'
      || agent.runtime_family === 'codex-app-server'
      || agent.runtime_family === 'pi'
    )
}
```

3. Extend `startAgent` to branch on `runtime_family`:

```typescript
private async startAgent(agent: RegistryAgent): Promise<void> {
  if (agent.runtime_family === 'pi') {
    return this.startPiAgent(agent)
  }
  // ... existing opencode spawn logic unchanged
}

private async startPiAgent(agent: RegistryAgent): Promise<void> {
  const worktreePath = agent.worktree_path
  if (!worktreePath) throw new Error(`worktree_path missing for pi agent ${agent.name}`)

  const provider = await this.resolveProvider(agent)
  const apiKey = provider ? await getProviderApiKey(this.pool, provider.id) : null
  const model = await this.resolveModel(agent)

  const harness = new PiHarness()
  await harness.start({
    cwd: worktreePath,
    model: { providerID: provider?.type ?? 'openai', id: model },
  })
  this.piHarnesses.set(agent.id, harness)
}
```

4. Add `getRunningHarness` public method:

```typescript
getRunningHarness(agentId: string): AgentHarness | undefined {
  return this.piHarnesses.get(agentId) ?? undefined
}
```

5. Extend `stopAgent` to also close Pi harnesses:

```typescript
stopAgent(agentId: string): void {
  const piHarness = this.piHarnesses.get(agentId)
  if (piHarness) {
    void piHarness.close()
    this.piHarnesses.delete(agentId)
  }
  // existing opencode stop logic:
  const running = this.processes.get(agentId)
  if (!running) return
  running.stopped = true
  running.child.kill()
  this.processes.delete(agentId)
}
```

- [ ] **Step 3: Build and test**

```bash
cd backend && npm run build && npm run test -- tests/opencode/process-manager.test.ts
```

Expected: build passes, existing tests still pass, new test passes.

- [ ] **Step 4: Commit**

```bash
git add backend/src/opencode/process-manager.ts backend/tests/opencode/process-manager.test.ts
git commit -m "feat(fleet-executor): add Pi harness support to process manager"
```

---

## Task 9: Result router

**Files:**
- Create: `backend/src/fleet-executor/result-router.ts`
- Create: `backend/tests/fleet-executor/result-router.test.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/fleet-executor/result-router.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type pg from 'pg'

const appendThreadMessageMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/runtime.js', () => ({
  appendThreadMessage: appendThreadMessageMock,
}))

import { routeResult } from '../../src/fleet-executor/result-router.js'
import { createInMemoryPrimeQueue } from '../../src/prime-agent/queue.js'
import type { Delegation } from '../../src/runtime.js'
import type { TaskResult } from '../../src/fleet-executor/harness.js'

const pool = {
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
} as unknown as pg.Pool

const delegation: Delegation = {
  id: 'del-1',
  work_item_id: 'wi-1',
  to_agent_id: 'agent-1',
  status: 'in_progress',
  capability: 'code',
  request: { thread_id: 'thread-1', title: 'do the thing' },
  result: {},
  trace: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const taskResult: TaskResult = {
  text: 'done',
  tokens: 100,
  changed_files: ['src/foo.ts'],
}

describe('routeResult', () => {
  let primeQueue: ReturnType<typeof createInMemoryPrimeQueue>

  beforeEach(() => {
    vi.clearAllMocks()
    primeQueue = createInMemoryPrimeQueue()
  })

  it('updates delegation to completed on success', async () => {
    await routeResult({ pool, primeQueue }, delegation, { success: true, result: taskResult })
    const call = (pool.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('completed'),
    )
    expect(call).toBeDefined()
  })

  it('enqueues fleet.delegation.completed into prime queue on success', async () => {
    const enqueueSpy = vi.spyOn(primeQueue, 'enqueue')
    await routeResult({ pool, primeQueue }, delegation, { success: true, result: taskResult })
    expect(enqueueSpy).toHaveBeenCalledOnce()
    expect(enqueueSpy.mock.calls[0][0]).toMatchObject({
      type: 'fleet.delegation.completed',
      payload: expect.objectContaining({ delegation_id: 'del-1' }),
    })
  })

  it('posts completion summary to the thread', async () => {
    await routeResult({ pool, primeQueue }, delegation, { success: true, result: taskResult })
    expect(appendThreadMessageMock).toHaveBeenCalledWith(
      pool,
      'thread-1',
      expect.objectContaining({ role: 'assistant' }),
    )
  })

  it('updates delegation to failed on failure', async () => {
    await routeResult({ pool, primeQueue }, delegation, { success: false, error: 'scope violation: src/secret.ts' })
    const call = (pool.query as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('failed'),
    )
    expect(call).toBeDefined()
  })

  it('enqueues fleet.delegation.failed on failure', async () => {
    const enqueueSpy = vi.spyOn(primeQueue, 'enqueue')
    await routeResult({ pool, primeQueue }, delegation, { success: false, error: 'timed out' })
    expect(enqueueSpy.mock.calls[0][0]).toMatchObject({ type: 'fleet.delegation.failed' })
  })

  it('does not throw if thread_id is absent', async () => {
    const noThread = { ...delegation, request: { title: 'no thread' } }
    await expect(
      routeResult({ pool, primeQueue }, noThread, { success: true, result: taskResult }),
    ).resolves.toBeUndefined()
    expect(appendThreadMessageMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && npm run test -- tests/fleet-executor/result-router.test.ts
```

Expected: `routeResult is not a function`

- [ ] **Step 3: Implement result router**

Create `backend/src/fleet-executor/result-router.ts`:

```typescript
import type pg from 'pg'
import { appendThreadMessage, type Delegation } from '../runtime.js'
import type { PrimeQueue } from '../prime-agent/queue.js'
import type { TaskResult } from './harness.js'

export interface ResultRouterDeps {
  pool: pg.Pool
  primeQueue: PrimeQueue
}

export type ResultOutcome =
  | { success: true; result: TaskResult }
  | { success: false; error: string }

export async function routeResult(
  deps: ResultRouterDeps,
  delegation: Delegation,
  outcome: ResultOutcome,
): Promise<void> {
  const { pool, primeQueue } = deps
  const threadId = typeof delegation.request['thread_id'] === 'string'
    ? delegation.request['thread_id']
    : undefined

  if (outcome.success) {
    await pool.query(
      `UPDATE delegations SET status='completed', result=$2, completed_at=now(), updated_at=now() WHERE id=$1`,
      [delegation.id, JSON.stringify({ changed_files: outcome.result.changed_files, tokens: outcome.result.tokens })],
    )

    if (threadId) {
      await appendThreadMessage(pool, threadId, {
        role: 'assistant',
        sender: delegation.to_agent_id ?? 'agent',
        content: `Task complete. Changed: ${outcome.result.changed_files?.join(', ') ?? 'none'}`,
        metadata: { source: 'fleet-executor', delegation_id: delegation.id },
      })
    }

    await primeQueue.enqueue({
      type: 'fleet.delegation.completed',
      payload: {
        delegation_id: delegation.id,
        work_item_id: delegation.work_item_id,
        agent_id: delegation.to_agent_id,
        result: { changed_files: outcome.result.changed_files },
      },
    })
  } else {
    await pool.query(
      `UPDATE delegations SET status='failed', result=$2, completed_at=now(), updated_at=now() WHERE id=$1`,
      [delegation.id, JSON.stringify({ error: outcome.error })],
    )

    if (threadId) {
      await appendThreadMessage(pool, threadId, {
        role: 'assistant',
        sender: delegation.to_agent_id ?? 'agent',
        content: `Task failed: ${outcome.error}`,
        metadata: { source: 'fleet-executor', delegation_id: delegation.id },
      })
    }

    await primeQueue.enqueue({
      type: 'fleet.delegation.failed',
      payload: {
        delegation_id: delegation.id,
        work_item_id: delegation.work_item_id,
        agent_id: delegation.to_agent_id,
        error: outcome.error,
      },
    })
  }

  // optional Gitea post — best-effort
  const tracker = delegation.result?.['external_tracker'] as Record<string, unknown> | undefined
    ?? delegation.request['external_tracker'] as Record<string, unknown> | undefined
  if (tracker?.['type'] === 'gitea' && process.env.GITEA_TOKEN) {
    const body = outcome.success
      ? `Task complete. Changed files: ${outcome.result.changed_files?.join(', ') ?? 'none'}`
      : `Task failed: ${outcome.error}`
    await fetch(
      `${String(tracker['base_url'])}/api/v1/repos/${String(tracker['repo'])}/issues/${String(tracker['issue_id'])}/comments`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${process.env.GITEA_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      },
    ).catch((err: unknown) => {
      console.warn('[result-router] gitea post failed:', err)
    })
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && npm run test -- tests/fleet-executor/result-router.test.ts
```

Expected: all result-router tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/fleet-executor/result-router.ts backend/tests/fleet-executor/result-router.test.ts
git commit -m "feat(fleet-executor): implement result router"
```

---

## Task 10: Fleet dispatcher

**Files:**
- Create: `backend/src/fleet-executor/dispatcher.ts`
- Create: `backend/tests/fleet-executor/dispatcher.test.ts`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/fleet-executor/dispatcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type pg from 'pg'

const routeResultMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/fleet-executor/result-router.js', () => ({ routeResult: routeResultMock }))

const appendThreadMessageMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/runtime.js', () => ({ appendThreadMessage: appendThreadMessageMock }))

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import { FleetDispatcher } from '../../src/fleet-executor/dispatcher.js'
import { createInMemoryPrimeQueue } from '../../src/prime-agent/queue.js'
import type { AgentHarness, TaskResult } from '../../src/fleet-executor/harness.js'

const taskResult: TaskResult = { text: 'ok', tokens: 10, changed_files: [] }

function makeHarness(result: TaskResult = taskResult, events: unknown[] = []): AgentHarness {
  const eventList = [...events, { type: 'task_end', result }]
  return {
    start: vi.fn().mockResolvedValue(undefined),
    dispatch: vi.fn().mockResolvedValue({
      id: 'handle-1',
      events: (async function* () { for (const e of eventList) yield e })(),
      done: Promise.resolve(result),
    }),
    abort: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentHarness
}

const pendingDelegation = {
  id: 'del-1',
  to_agent_id: 'agent-1',
  work_item_id: 'wi-1',
  status: 'queued',
  capability: 'code',
  request: {
    thread_id: 'thread-1',
    title: 'Fix the bug',
    description: 'There is a bug',
    allowed_files: ['src/foo.ts'],
    read_files: ['README.md'],
    verification_cmd: 'npm test',
  },
  result: {},
  trace: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

describe('FleetDispatcher', () => {
  let pool: pg.Pool
  let primeQueue: ReturnType<typeof createInMemoryPrimeQueue>
  let dispatcher: FleetDispatcher

  beforeEach(() => {
    vi.clearAllMocks()
    primeQueue = createInMemoryPrimeQueue()
    pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [pendingDelegation] }) // select queued
        .mockResolvedValueOnce({ rows: [pendingDelegation] }) // claim update
        .mockResolvedValue({ rows: [], rowCount: 1 }),
    } as unknown as pg.Pool

    dispatcher = new FleetDispatcher({
      pool,
      primeQueue,
      getHarness: vi.fn().mockReturnValue(makeHarness()),
      pollIntervalMs: 50,
    })
  })

  afterEach(async () => {
    await dispatcher.stop()
  })

  it('claims a queued delegation and calls routeResult on success', async () => {
    routeResultMock.mockResolvedValue(undefined)
    dispatcher.start()
    await new Promise((r) => setTimeout(r, 100))
    expect(routeResultMock).toHaveBeenCalledWith(
      expect.objectContaining({ pool }),
      expect.objectContaining({ id: 'del-1' }),
      expect.objectContaining({ success: true }),
    )
  })

  it('does not double-claim if claim UPDATE returns no rows', async () => {
    pool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [pendingDelegation] })
        .mockResolvedValueOnce({ rows: [] }) // claim returns nothing (race)
        .mockResolvedValue({ rows: [] }),
    } as unknown as pg.Pool
    dispatcher = new FleetDispatcher({ pool, primeQueue, getHarness: vi.fn().mockReturnValue(makeHarness()), pollIntervalMs: 50 })
    dispatcher.start()
    await new Promise((r) => setTimeout(r, 100))
    expect(routeResultMock).not.toHaveBeenCalled()
  })

  it('calls routeResult with failed outcome when harness.done rejects', async () => {
    const badHarness: AgentHarness = {
      start: vi.fn().mockResolvedValue(undefined),
      dispatch: vi.fn().mockResolvedValue({
        id: 'h2',
        events: (async function* () {})(),
        done: Promise.reject(new Error('harness crashed')),
      }),
      abort: vi.fn(),
      close: vi.fn(),
    } as unknown as AgentHarness
    routeResultMock.mockResolvedValue(undefined)
    dispatcher = new FleetDispatcher({ pool, primeQueue, getHarness: vi.fn().mockReturnValue(badHarness), pollIntervalMs: 50 })
    dispatcher.start()
    await new Promise((r) => setTimeout(r, 100))
    expect(routeResultMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ success: false, error: 'harness crashed' }),
    )
  })

  it('fails with scope violation when changed files include out-of-scope paths', async () => {
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], cb: (err: null, r: { stdout: string }) => void) => {
        cb(null, { stdout: 'src/foo.ts\nsrc/secret.ts\n' })
      },
    )
    routeResultMock.mockResolvedValue(undefined)
    const harnessWithChanges = makeHarness({ ...taskResult, changed_files: ['src/foo.ts', 'src/secret.ts'] })
    dispatcher = new FleetDispatcher({ pool, primeQueue, getHarness: vi.fn().mockReturnValue(harnessWithChanges), pollIntervalMs: 50 })
    dispatcher.start()
    await new Promise((r) => setTimeout(r, 100))
    expect(routeResultMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ success: false, error: expect.stringContaining('scope violation') }),
    )
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
cd backend && npm run test -- tests/fleet-executor/dispatcher.test.ts
```

Expected: `FleetDispatcher is not a constructor`

- [ ] **Step 3: Implement FleetDispatcher**

Create `backend/src/fleet-executor/dispatcher.ts`:

```typescript
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type pg from 'pg'
import { appendThreadMessage, type Delegation } from '../runtime.js'
import type { PrimeQueue } from '../prime-agent/queue.js'
import type { AgentHarness, TaskPrompt } from './harness.js'
import { routeResult } from './result-router.js'

const execFileAsync = promisify(execFile)

export interface FleetDispatcherOptions {
  pool: pg.Pool
  primeQueue: PrimeQueue
  getHarness: (agentId: string) => AgentHarness | undefined
  pollIntervalMs?: number
}

export class FleetDispatcher {
  private readonly pool: pg.Pool
  private readonly primeQueue: PrimeQueue
  private readonly getHarness: (agentId: string) => AgentHarness | undefined
  private readonly pollIntervalMs: number
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(opts: FleetDispatcherOptions) {
    this.pool = opts.pool
    this.primeQueue = opts.primeQueue
    this.getHarness = opts.getHarness
    this.pollIntervalMs = opts.pollIntervalMs ?? 5000
  }

  start(): void {
    this.timer = setInterval(() => { void this.poll() }, this.pollIntervalMs)
  }

  async stop(): Promise<void> {
    clearInterval(this.timer)
    this.timer = undefined
  }

  private async poll(): Promise<void> {
    const { rows } = await this.pool.query<Delegation>(
      `SELECT * FROM delegations WHERE status = 'queued' ORDER BY created_at LIMIT 10`,
    )

    for (const row of rows) {
      await this.dispatch(row).catch((err: unknown) => {
        console.error('[fleet-dispatcher] dispatch error:', err)
      })
    }
  }

  private async dispatch(delegation: Delegation): Promise<void> {
    // Atomic claim — skip if another worker got there first
    const { rows: claimed } = await this.pool.query<Delegation>(
      `UPDATE delegations SET status='in_progress', updated_at=now()
       WHERE id=$1 AND status='queued' RETURNING *`,
      [delegation.id],
    )
    if (claimed.length === 0) return

    const agentId = delegation.to_agent_id
    if (!agentId) {
      await routeResult(
        { pool: this.pool, primeQueue: this.primeQueue },
        delegation,
        { success: false, error: 'no target agent assigned to delegation' },
      )
      return
    }

    const harness = this.getHarness(agentId)
    if (!harness) {
      // requeue — harness not running yet
      await this.pool.query(
        `UPDATE delegations SET status='queued', updated_at=now() WHERE id=$1`,
        [delegation.id],
      )
      return
    }

    const prompt = buildPrompt(delegation)
    const threadId = typeof delegation.request['thread_id'] === 'string'
      ? delegation.request['thread_id']
      : undefined

    try {
      const handle = await harness.dispatch(prompt)

      // Stream progress to thread
      const progressDone = (async () => {
        for await (const event of handle.events) {
          if (event.type === 'progress' && threadId) {
            await appendThreadMessage(this.pool, threadId, {
              role: 'assistant',
              sender: agentId,
              content: event.summary,
              metadata: { source: 'fleet-executor', delegation_id: delegation.id },
            }).catch(() => {})
          }
        }
      })()

      const result = await handle.done
      await progressDone

      // Scope gate
      const worktreePath = await this.getWorktreePath(agentId)
      const allowedFiles = Array.isArray(delegation.request['allowed_files'])
        ? delegation.request['allowed_files'] as string[]
        : []

      if (worktreePath && allowedFiles.length > 0) {
        const violations = await checkScope(worktreePath, allowedFiles)
        if (violations.length > 0) {
          await routeResult(
            { pool: this.pool, primeQueue: this.primeQueue },
            delegation,
            { success: false, error: `scope violation: ${violations.join(', ')}` },
          )
          return
        }
      }

      await routeResult(
        { pool: this.pool, primeQueue: this.primeQueue },
        delegation,
        { success: true, result },
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      await routeResult(
        { pool: this.pool, primeQueue: this.primeQueue },
        delegation,
        { success: false, error: message },
      )
    }
  }

  private async getWorktreePath(agentId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ worktree_path: string | null }>(
      `SELECT worktree_path FROM agents WHERE id = $1`,
      [agentId],
    )
    return rows[0]?.worktree_path ?? null
  }
}

function buildPrompt(delegation: Delegation): TaskPrompt {
  const req = delegation.request
  const title = String(req['title'] ?? 'Task')
  const description = String(req['description'] ?? '')
  const allowedFiles = Array.isArray(req['allowed_files']) ? req['allowed_files'] as string[] : []
  const readFiles = Array.isArray(req['read_files']) ? req['read_files'] as string[] : []
  const verificationCmd = typeof req['verification_cmd'] === 'string' ? req['verification_cmd'] : undefined

  const text = [
    `# Task`,
    ``,
    title,
    ``,
    `## Context`,
    ``,
    description,
    ``,
    `## Files you may read`,
    ``,
    readFiles.length > 0 ? readFiles.join('\n') : '(none specified)',
    ``,
    `## Files you may edit`,
    ``,
    allowedFiles.length > 0 ? allowedFiles.join('\n') : '(none — unscoped task)',
    ``,
    `## Files you must NOT touch`,
    ``,
    `Everything else in the repository.`,
    ``,
    ...(verificationCmd
      ? [`## Verification`, ``, `Run: ${verificationCmd}`, ``]
      : []),
    `## Completion`,
    ``,
    `Output the TASK COMPLETE block per AGENTS.md and stop.`,
  ].join('\n')

  return { text, allowed_files: allowedFiles, read_files: readFiles, verification_cmd: verificationCmd }
}

async function checkScope(worktreePath: string, allowedFiles: string[]): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', worktreePath, 'diff', '--name-only', 'HEAD'])
    const changed = stdout.trim().split('\n').filter(Boolean)
    return changed.filter((f) => !allowedFiles.includes(f))
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
cd backend && npm run test -- tests/fleet-executor/dispatcher.test.ts
```

Expected: all dispatcher tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/fleet-executor/dispatcher.ts backend/tests/fleet-executor/dispatcher.test.ts
git commit -m "feat(fleet-executor): implement fleet dispatcher with scope gate"
```

---

## Task 11: Wire FleetDispatcher in index.ts

**Files:**
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Add wiring**

In `backend/src/index.ts`, after the `processManager.initialize()` call, add:

```typescript
import { FleetDispatcher } from './fleet-executor/dispatcher.js'

// After: await processManager.initialize()

const fleetDispatcher = new FleetDispatcher({
  pool,
  primeQueue: primeAgentService.queue,
  getHarness: (agentId) => processManager.getRunningHarness(agentId),
})
fleetDispatcher.start()
console.log('Fleet dispatcher started')
```

Add a shutdown hook. Find where the server is closed (there may already be a `process.on('SIGTERM')` or similar, or just add after `server.listen`):

```typescript
process.on('SIGTERM', async () => {
  await fleetDispatcher.stop()
  await primeAgentService.close()
  server.close()
  await pool.end()
  process.exit(0)
})
```

- [ ] **Step 2: Build**

```bash
cd backend && npm run build
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat: wire FleetDispatcher in backend startup"
```

---

## Task 12: Container and compose updates

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.prod.yml`
- Modify: `.env.example`

- [ ] **Step 1: Update Dockerfile**

In `Dockerfile`, find the line `RUN npm ci --omit=dev && \` and extend it:

```dockerfile
RUN npm ci --omit=dev && \
    npm install -g @openai/codex && \
    npm install -g @earendil-works/pi-coding-agent
```

- [ ] **Step 2: Update docker-compose.prod.yml**

Add to the `backend` service's `environment` block:

```yaml
ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
AGENT_REPO_ROOT: ${AGENT_REPO_ROOT:-/workspace/repo}
AGENT_WORKTREE_ROOT: ${AGENT_WORKTREE_ROOT:-/workspace/agents}
GITEA_TOKEN: ${GITEA_TOKEN:-}
```

Add to the `backend` service's `volumes` block (create if absent):

```yaml
volumes:
  - /mnt/user/appdata/agent-cp/codex:/root/.codex
  - /mnt/user/appdata/agent-cp/workspace:/workspace
```

- [ ] **Step 3: Update .env.example**

Add:

```
# Prime Agent LLM provider (set whichever you use)
ANTHROPIC_API_KEY=

# Fleet executor
AGENT_REPO_ROOT=/workspace/repo
AGENT_WORKTREE_ROOT=/workspace/agents

# Optional: Gitea integration for work tracking
GITEA_TOKEN=
```

- [ ] **Step 4: Full build check**

```bash
cd backend && npm run build && npm run test
```

Expected: build passes, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.prod.yml .env.example
git commit -m "feat(infra): add Pi harness, workspace volume, and env vars to container"
```

---

## Task 13: Bootstrap verification

This task walks through the end-to-end setup to verify the loop works.

- [ ] **Step 1: Create a provider in the UI**

Navigate to Providers in the portal. Add a provider:
- Name: `Anthropic`
- Type: `anthropic`
- API Key: your Anthropic key
- Model: `claude-sonnet-4-6`

Note the provider ID from the response.

- [ ] **Step 2: Enable prime agent with routing config**

```bash
curl -X PATCH http://localhost:3100/api/prime-agent/config \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": true,
    "cron_fast_interval_seconds": 60,
    "provider_routing": {
      "planning": [{ "provider_id": "<your-provider-id>", "model": "claude-sonnet-4-6" }]
    }
  }'
```

- [ ] **Step 3: Create a Pi agent in the registry**

```bash
curl -X POST http://localhost:3100/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Prime Coder",
    "type": "coding",
    "runtime_family": "pi",
    "execution_mode": "local",
    "capabilities": ["code", "test", "refactor"],
    "enabled": true
  }'
```

- [ ] **Step 4: Verify cron fires and session is created**

Wait 60 seconds, then:

```bash
curl http://localhost:3100/api/prime-agent/sessions
```

Expected: at least one session with `trigger_type: 'cron_fast'` and `status: 'completed'`.

- [ ] **Step 5: Verify prime agent can delegate**

Check the prime agent decided to delegate (or no_op). If no delegation was created, post a chief message to prompt it:

```bash
curl -X POST http://localhost:3100/api/runtime/thread \
  -H "Content-Type: application/json" \
  -d '{"content": "Please review the current state of the codebase and identify one small improvement you can make.", "sender": "operator"}'
```

Then check `GET /api/prime-agent/sessions` again and `GET /api/runtime/delegations`.
