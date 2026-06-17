# Agent Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Source spec: `docs/superpowers/specs/2026-05-11-agent-harness-design.md`
>
> **Delegation note:** This plan is optimized for delegation to local OpenCode/Pi agents. Each task lists exact files an agent may edit and which files it should read for context only. Do not let agents implement future-phase behavior — the task boundaries are deliberate.

**Goal:** Build a Fleet Executor that dispatches delegations to local agent harnesses (OpenCode and Pi), enforces scope, reports progress, and routes results back to Prime as events.

**Architecture:** A backend module (`backend/src/fleet-executor/`) that sits between Prime's delegation table and the running agent processes. Defines an abstract `AgentHarness` interface implemented by both `OpenCodeHarness` (HTTP server) and `PiHarness` (JSONL stdio). Per-agent persistent processes with git worktree isolation. Result delivery via `fleet.delegation.completed` / `failed` events on Prime's existing event queue.

**Tech Stack:** TypeScript, Node.js, pg (Postgres), vitest, existing Prime queue, OpenCode CLI (`opencode serve`), Pi CLI (`pi --mode rpc`).

---

## Repo Baseline (Important Context)

- `backend/src/prime-agent/queue.ts` — example of clean interface + in-memory impl
- `backend/src/prime-agent/events.ts` — `fleet.delegation.completed` and `fleet.delegation.failed` events already defined
- `backend/src/runtime.ts` — `createWorkItem`, `createDelegation`, `updateDelegation`, `appendThreadMessage`, `insertRuntimeEvent`
- `backend/src/registry.ts` — `RegistryAgent` shape and `listAgents`
- `backend/src/db.ts` — schema + migrations, idempotent
- Tests: `vitest`. Non-DB tests run with `npm run test`. DB tests need Postgres on `127.0.0.1:5434` and run with `npm run test:db`.
- Build: `cd backend && npm run build`
- Existing AGENTS.md instructs delegated agents to output a `TASK COMPLETE` block on completion.

## Delegation Guardrails For Local Agents

Each task below states `Allowed files` (the only files an agent may edit), `Read for context` (read-only), and `Verification command`. If a task asks to edit files outside `Allowed files`, refuse and report the violation.

## File Structure

Files this plan creates or modifies:

| File | Responsibility |
|---|---|
| `backend/src/fleet-executor/harness.ts` | Abstract `AgentHarness` + `TaskHandle` interfaces, event types |
| `backend/src/fleet-executor/opencode-harness.ts` | OpenCode adapter (spawn `opencode serve`, REST API) |
| `backend/src/fleet-executor/pi-harness.ts` | Pi adapter (spawn `pi --mode rpc`, JSONL stdio) |
| `backend/src/fleet-executor/process-manager.ts` | Per-agent harness lifecycle, picks impl by `agents.harness` |
| `backend/src/fleet-executor/worktree-manager.ts` | Per-agent git worktree creation, reset, removal |
| `backend/src/fleet-executor/prompt-format.ts` | Compose task prompt from delegation row |
| `backend/src/fleet-executor/dispatcher.ts` | Claim delegation, dispatch via harness, await completion |
| `backend/src/fleet-executor/scope-gate.ts` | Post-task `git diff` allow-list check |
| `backend/src/fleet-executor/result-router.ts` | Emit Prime events, update delegation, post to thread |
| `backend/src/fleet-executor/progress-reporter.ts` | Subscribe to harness events, post progress to thread |
| `backend/src/fleet-executor/service.ts` | Bootstrap — wires manager + dispatcher into `index.ts` |
| `backend/src/db.ts` | Add `agent_runtime_state` table + `harness` column on `agents` |
| `backend/src/index.ts` | Start fleet executor service on boot |

Tests mirror under `backend/tests/fleet-executor/`.

---

## Task H1: AgentHarness Interface

**Files:**
- Create: `backend/src/fleet-executor/harness.ts`
- Test: `backend/tests/fleet-executor/harness.test.ts`

**Allowed files:** the two above. **Read for context:** `backend/src/prime-agent/queue.ts`.

- [ ] **Step 1: Write the failing test**

`backend/tests/fleet-executor/harness.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type { AgentHarness, HarnessEvent, TaskHandle, TaskPrompt } from '../../src/fleet-executor/harness.js'

describe('AgentHarness interface', () => {
  it('describes a harness that can be implemented by a stub', async () => {
    const events: HarnessEvent[] = []
    const stub: AgentHarness = {
      async start() {},
      async dispatch(prompt: TaskPrompt): Promise<TaskHandle> {
        return {
          id: 'task-1',
          events: (async function* () {
            yield { type: 'task_start' } as HarnessEvent
            yield { type: 'task_end', result: { text: 'ok', tokens: 0 } } as HarnessEvent
          })(),
          done: Promise.resolve({ text: 'ok', tokens: 0 }),
        }
      },
      async abort() {},
      async close() {},
    }

    await stub.start({ cwd: '/tmp', model: { providerID: 'test', id: 'mock' } })
    const handle = await stub.dispatch({ text: 'hello', allowed_files: [], read_files: [] })
    for await (const ev of handle.events) events.push(ev)
    expect(events.map((e) => e.type)).toEqual(['task_start', 'task_end'])
    expect((await handle.done).text).toBe('ok')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/fleet-executor/harness.test.ts`
Expected: FAIL — module `../../src/fleet-executor/harness.js` does not resolve.

- [ ] **Step 3: Implement the interface**

`backend/src/fleet-executor/harness.ts`:

```typescript
export interface ModelRef {
  providerID: string
  id: string
}

export interface TaskPrompt {
  text: string
  allowed_files: string[]
  read_files: string[]
  verification_cmd?: string
  metadata?: Record<string, unknown>
}

export interface TaskResult {
  text: string
  tokens: number
  changed_files?: string[]
  verification?: { command: string; exit_code: number; output: string }
  error?: string
}

export type HarnessEvent =
  | { type: 'task_start' }
  | { type: 'tool_call_start'; tool: string; args: Record<string, unknown> }
  | { type: 'tool_call_end'; tool: string; result?: unknown; error?: string }
  | { type: 'message_update'; delta: string }
  | { type: 'progress'; summary: string }
  | { type: 'task_end'; result: TaskResult }

export interface TaskHandle {
  id: string
  events: AsyncIterable<HarnessEvent>
  done: Promise<TaskResult>
}

export interface AgentHarness {
  start(opts: { cwd: string; model: ModelRef }): Promise<void>
  dispatch(prompt: TaskPrompt): Promise<TaskHandle>
  abort(taskId: string): Promise<void>
  close(): Promise<void>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/fleet-executor/harness.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/fleet-executor/harness.ts backend/tests/fleet-executor/harness.test.ts
git commit -m "feat(fleet-executor): add AgentHarness interface"
```

---

## Task H2: OpenCode Harness Implementation

**Files:**
- Create: `backend/src/fleet-executor/opencode-harness.ts`
- Test: `backend/tests/fleet-executor/opencode-harness.test.ts`

**Allowed files:** the two above. **Read for context:** `backend/src/fleet-executor/harness.ts`.

This task uses a mocked `fetch` and mocked `child_process.spawn`. Do not spawn real `opencode serve` in tests.

- [ ] **Step 1: Write the failing test**

`backend/tests/fleet-executor/opencode-harness.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOpenCodeHarness } from '../../src/fleet-executor/opencode-harness.js'

describe('OpenCodeHarness', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let spawnMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    spawnMock = vi.fn(() => ({
      pid: 1234,
      stdout: { on: () => {}, off: () => {} },
      stderr: { on: () => {}, off: () => {} },
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'spawn') setTimeout(() => cb(0), 1)
      },
      kill: () => true,
    }))
  })

  it('starts the server, dispatches a prompt, and resolves done on /wait', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [] }) }) // health check
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'ses_test' }) }) // session create
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // prompt
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) }) // wait
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            { role: 'assistant', parts: [{ type: 'text', text: 'TASK COMPLETE\nChanged: none\nVerification: none\n' }] },
          ],
        }),
      })

    const harness = createOpenCodeHarness({
      port: 4199,
      fetchFn: fetchMock as unknown as typeof fetch,
      spawnFn: spawnMock as unknown as typeof import('child_process').spawn,
      readyTimeoutMs: 100,
    })

    await harness.start({ cwd: '/tmp', model: { providerID: 'lmstudio', id: 'unsloth/qwen3.6-35b-a3b' } })
    const handle = await harness.dispatch({ text: 'hi', allowed_files: [], read_files: [] })
    const result = await handle.done

    expect(result.text).toContain('TASK COMPLETE')
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(4)
    await harness.close()
  })

  it('rejects dispatch if server not started', async () => {
    const harness = createOpenCodeHarness({
      port: 4199,
      fetchFn: fetchMock as unknown as typeof fetch,
      spawnFn: spawnMock as unknown as typeof import('child_process').spawn,
    })
    await expect(
      harness.dispatch({ text: 'hi', allowed_files: [], read_files: [] })
    ).rejects.toThrow(/not started/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/fleet-executor/opencode-harness.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement OpenCodeHarness**

`backend/src/fleet-executor/opencode-harness.ts`:

```typescript
import { spawn as defaultSpawn, type ChildProcess } from 'child_process'
import type {
  AgentHarness,
  HarnessEvent,
  ModelRef,
  TaskHandle,
  TaskPrompt,
  TaskResult,
} from './harness.js'

export interface OpenCodeHarnessOptions {
  port: number
  command?: string
  args?: string[]
  fetchFn?: typeof fetch
  spawnFn?: typeof defaultSpawn
  readyTimeoutMs?: number
  waitTimeoutMs?: number
}

export function createOpenCodeHarness(options: OpenCodeHarnessOptions): AgentHarness {
  const fetchFn = options.fetchFn ?? fetch
  const spawnFn = options.spawnFn ?? defaultSpawn
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000
  const waitTimeoutMs = options.waitTimeoutMs ?? 600_000
  const baseUrl = `http://127.0.0.1:${options.port}`

  let child: ChildProcess | null = null
  let started = false
  let cwd = ''
  let model: ModelRef | null = null
  let counter = 0

  async function healthCheck(): Promise<boolean> {
    try {
      const res = await fetchFn(`${baseUrl}/api/session`, { method: 'GET' })
      return res.ok
    } catch {
      return false
    }
  }

  async function waitForReady(): Promise<void> {
    const deadline = Date.now() + readyTimeoutMs
    while (Date.now() < deadline) {
      if (await healthCheck()) return
      await new Promise((r) => setTimeout(r, 250))
    }
    throw new Error('OpenCode server did not become ready in time')
  }

  return {
    async start(opts: { cwd: string; model: ModelRef }): Promise<void> {
      if (started) return
      cwd = opts.cwd
      model = opts.model
      const cmd = options.command ?? 'opencode'
      const args = options.args ?? ['serve', '--port', String(options.port), '--hostname', '127.0.0.1']
      child = spawnFn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      await new Promise<void>((resolve, reject) => {
        if (!child) return reject(new Error('spawn failed'))
        child.on('spawn', resolve)
        child.on('error', reject)
      })
      await waitForReady()
      started = true
    },

    async dispatch(prompt: TaskPrompt): Promise<TaskHandle> {
      if (!started || !model) throw new Error('OpenCodeHarness not started')

      const sessionRes = await fetchFn(
        `${baseUrl}/api/session?directory=${encodeURIComponent(cwd)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      )
      const session = (await sessionRes.json()) as { id?: string }
      if (!session.id) throw new Error('Could not create OpenCode session')
      const sessionId = session.id
      const taskId = `task-${++counter}`

      const promptBody = {
        content: [{ type: 'text', text: prompt.text }],
        model: { id: model.id, providerID: model.providerID },
      }

      await fetchFn(`${baseUrl}/api/session/${sessionId}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(promptBody),
      })

      const events: HarnessEvent[] = [{ type: 'task_start' }]

      const done = (async (): Promise<TaskResult> => {
        const waitPromise = fetchFn(`${baseUrl}/api/session/${sessionId}/wait`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('wait timeout')), waitTimeoutMs)
        )
        await Promise.race([waitPromise, timeoutPromise])

        const msgsRes = await fetchFn(`${baseUrl}/api/session/${sessionId}/message`, { method: 'GET' })
        const msgs = (await msgsRes.json()) as {
          items: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>
        }
        const finalText = msgs.items
          .filter((m) => m.role === 'assistant')
          .flatMap((m) => m.parts.filter((p) => p.type === 'text').map((p) => p.text ?? ''))
          .join('\n')

        const result: TaskResult = { text: finalText, tokens: 0 }
        events.push({ type: 'task_end', result })
        return result
      })()

      return {
        id: taskId,
        events: (async function* () {
          for (const ev of events) yield ev
          await done
          for (let i = 1; i < events.length; i++) {
            // events appended during done are already yielded above when iterator reads
          }
          // re-yield the task_end we appended last (if any new events arrived after iterator started)
          if (events.length > 1) yield events[events.length - 1]
        })(),
        done,
      }
    },

    async abort(_taskId: string): Promise<void> {
      // OpenCode has no per-task abort; closing the harness ends everything
      // For per-task abort, future work could call session-level cancel if added.
    },

    async close(): Promise<void> {
      if (child && !child.killed) child.kill('SIGTERM')
      child = null
      started = false
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/fleet-executor/opencode-harness.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/fleet-executor/opencode-harness.ts backend/tests/fleet-executor/opencode-harness.test.ts
git commit -m "feat(fleet-executor): add OpenCode harness implementation"
```

---

## Task H2b: Pi Harness Implementation

**Files:**
- Create: `backend/src/fleet-executor/pi-harness.ts`
- Test: `backend/tests/fleet-executor/pi-harness.test.ts`

**Allowed files:** the two above. **Read for context:** `backend/src/fleet-executor/harness.ts`, `backend/src/fleet-executor/opencode-harness.ts`.

Pi RPC mode contract (key facts from `pi.dev/docs/latest/rpc`):
- Spawn `pi --mode rpc` with stdio piped.
- Commands and events are JSON, one per line, terminated by `\n`. Strip optional trailing `\r`.
- Send a prompt: `{"id":"req-1","type":"prompt","message":"..."}` via stdin.
- Listen on stdout for `agent_start`, `message_update`, `tool_execution_start`, `tool_execution_end`, `agent_end` events.
- `agent_end` is the completion signal; its payload contains `messages`.
- Abort: send `{"type":"abort"}` on stdin.

- [ ] **Step 1: Write the failing test**

`backend/tests/fleet-executor/pi-harness.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter, Readable, Writable } from 'stream'
import { createPiHarness } from '../../src/fleet-executor/pi-harness.js'

function makeChild() {
  const stdin = new Writable({ write: (chunk, _, cb) => { lines.push(chunk.toString()); cb() } })
  const stdout = new Readable({ read() {} })
  const stderr = new Readable({ read() {} })
  const lines: string[] = []
  const child = Object.assign(new EventEmitter(), {
    pid: 4242,
    stdin,
    stdout,
    stderr,
    kill: () => true,
    killed: false,
  })
  return { child, stdin, stdout, stderr, lines }
}

describe('PiHarness', () => {
  it('starts pi, dispatches, and resolves on agent_end', async () => {
    const { child, stdout, lines } = makeChild()
    const spawnMock = vi.fn(() => child as any)

    const harness = createPiHarness({
      spawnFn: spawnMock as any,
      readyTimeoutMs: 200,
    })

    const startPromise = harness.start({
      cwd: '/tmp',
      model: { providerID: 'lmstudio', id: 'unsloth/qwen3.6-35b-a3b' },
    })
    setTimeout(() => child.emit('spawn'), 1)
    await startPromise

    const handlePromise = harness.dispatch({ text: 'hi', allowed_files: [], read_files: [] })

    setTimeout(() => {
      stdout.push(JSON.stringify({ type: 'agent_start' }) + '\n')
      stdout.push(
        JSON.stringify({
          type: 'agent_end',
          messages: [
            { role: 'assistant', content: [{ type: 'text', text: 'TASK COMPLETE\nChanged: none\n' }] },
          ],
        }) + '\n'
      )
    }, 10)

    const handle = await handlePromise
    const result = await handle.done

    expect(result.text).toContain('TASK COMPLETE')
    const promptLine = lines.find((l) => l.includes('"type":"prompt"'))
    expect(promptLine).toBeDefined()
    await harness.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/fleet-executor/pi-harness.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement PiHarness**

`backend/src/fleet-executor/pi-harness.ts`:

```typescript
import { spawn as defaultSpawn, type ChildProcess } from 'child_process'
import type {
  AgentHarness,
  HarnessEvent,
  ModelRef,
  TaskHandle,
  TaskPrompt,
  TaskResult,
} from './harness.js'

export interface PiHarnessOptions {
  command?: string
  args?: string[]
  spawnFn?: typeof defaultSpawn
  readyTimeoutMs?: number
  waitTimeoutMs?: number
}

interface PiAssistantContentPart {
  type: 'text' | 'thinking' | 'toolCall'
  text?: string
}

interface PiMessage {
  role: 'user' | 'assistant' | 'toolResult'
  content?: string | PiAssistantContentPart[]
}

interface PiEvent {
  type: string
  messages?: PiMessage[]
  [key: string]: unknown
}

export function createPiHarness(options: PiHarnessOptions = {}): AgentHarness {
  const spawnFn = options.spawnFn ?? defaultSpawn
  const readyTimeoutMs = options.readyTimeoutMs ?? 30_000
  const waitTimeoutMs = options.waitTimeoutMs ?? 600_000

  let child: ChildProcess | null = null
  let started = false
  let counter = 0

  const eventSubscribers: Array<(event: PiEvent) => void> = []
  let lineBuffer = ''

  function dispatchLine(line: string): void {
    if (!line) return
    if (line.endsWith('\r')) line = line.slice(0, -1)
    try {
      const event = JSON.parse(line) as PiEvent
      for (const sub of eventSubscribers) sub(event)
    } catch {
      // Non-JSON line — ignore.
    }
  }

  function attachReader(): void {
    if (!child?.stdout) return
    child.stdout.on('data', (chunk: Buffer | string) => {
      lineBuffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      let nl: number
      while ((nl = lineBuffer.indexOf('\n')) !== -1) {
        const line = lineBuffer.slice(0, nl)
        lineBuffer = lineBuffer.slice(nl + 1)
        dispatchLine(line)
      }
    })
  }

  function writeCommand(cmd: Record<string, unknown>): void {
    if (!child?.stdin) throw new Error('Pi stdin not available')
    child.stdin.write(JSON.stringify(cmd) + '\n')
  }

  function extractText(messages: PiMessage[]): string {
    const parts: string[] = []
    for (const m of messages) {
      if (m.role !== 'assistant') continue
      if (typeof m.content === 'string') {
        parts.push(m.content)
      } else if (Array.isArray(m.content)) {
        for (const p of m.content) {
          if (p.type === 'text' && typeof p.text === 'string') parts.push(p.text)
        }
      }
    }
    return parts.join('\n')
  }

  return {
    async start(opts: { cwd: string; model: ModelRef }): Promise<void> {
      if (started) return
      const cmd = options.command ?? 'pi'
      const args = options.args ?? [
        '--mode', 'rpc',
        '--no-session',
        '--provider', opts.model.providerID,
        '--model', opts.model.id,
      ]
      child = spawnFn(cmd, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] })
      await new Promise<void>((resolve, reject) => {
        if (!child) return reject(new Error('spawn failed'))
        const timer = setTimeout(() => reject(new Error('pi did not start in time')), readyTimeoutMs)
        child.on('spawn', () => {
          clearTimeout(timer)
          resolve()
        })
        child.on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
      })
      attachReader()
      started = true
    },

    async dispatch(prompt: TaskPrompt): Promise<TaskHandle> {
      if (!started) throw new Error('PiHarness not started')
      const taskId = `task-${++counter}`
      const events: HarnessEvent[] = [{ type: 'task_start' }]

      const done = new Promise<TaskResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          eventSubscribers.splice(eventSubscribers.indexOf(handler), 1)
          reject(new Error('pi task timeout'))
        }, waitTimeoutMs)

        const handler = (event: PiEvent): void => {
          if (event.type === 'tool_execution_start') {
            events.push({ type: 'tool_call_start', tool: String(event.tool ?? ''), args: {} })
          } else if (event.type === 'tool_execution_end') {
            events.push({ type: 'tool_call_end', tool: String(event.tool ?? '') })
          } else if (event.type === 'agent_end') {
            clearTimeout(timer)
            eventSubscribers.splice(eventSubscribers.indexOf(handler), 1)
            const text = extractText(event.messages ?? [])
            const result: TaskResult = { text, tokens: 0 }
            events.push({ type: 'task_end', result })
            resolve(result)
          }
        }
        eventSubscribers.push(handler)

        try {
          writeCommand({ id: taskId, type: 'prompt', message: prompt.text })
        } catch (err) {
          clearTimeout(timer)
          eventSubscribers.splice(eventSubscribers.indexOf(handler), 1)
          reject(err)
        }
      })

      return {
        id: taskId,
        events: (async function* () {
          for (const ev of events) yield ev
          await done
          const last = events[events.length - 1]
          if (last && last.type === 'task_end') yield last
        })(),
        done,
      }
    },

    async abort(_taskId: string): Promise<void> {
      try {
        writeCommand({ type: 'abort' })
      } catch {
        // ignore
      }
    },

    async close(): Promise<void> {
      if (child && !child.killed) {
        try {
          child.stdin?.end()
        } catch {
          // ignore
        }
        child.kill('SIGTERM')
      }
      child = null
      started = false
      eventSubscribers.length = 0
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/fleet-executor/pi-harness.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/fleet-executor/pi-harness.ts backend/tests/fleet-executor/pi-harness.test.ts
git commit -m "feat(fleet-executor): add Pi harness implementation"
```

---

## Task H3: Schema — agent_runtime_state + agents.harness column

**Files:**
- Modify: `backend/src/db.ts`
- Test: `backend/tests/fleet-executor/db.test.ts`

**Allowed files:** the two above.

- [ ] **Step 1: Write the failing test (DB test)**

`backend/tests/fleet-executor/db.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { runMigrations } from '../../src/db.js'

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5434/postgres'

describe('fleet-executor schema', () => {
  const pool = new pg.Pool({ connectionString: TEST_DB_URL })

  beforeAll(async () => {
    await runMigrations(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('creates agent_runtime_state table', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'agent_runtime_state'
       ORDER BY column_name`
    )
    const cols = rows.map((r) => r.column_name)
    expect(cols).toEqual(
      expect.arrayContaining(['agent_id', 'pid', 'port', 'worktree_path', 'status', 'last_error', 'started_at', 'updated_at'])
    )
  })

  it('adds harness column to agents table with default opencode', async () => {
    const { rows } = await pool.query(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'agents' AND column_name = 'harness'`
    )
    expect(rows[0]).toBeDefined()
    expect(rows[0].column_default).toMatch(/opencode/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:db -- tests/fleet-executor/db.test.ts`
Expected: FAIL — `agent_runtime_state` does not exist; `harness` column not found.

- [ ] **Step 3: Add migrations to db.ts**

Open `backend/src/db.ts`. Append two new migration blocks inside `runMigrations` (idempotent). Find the existing `prime_agent_sessions` block and add the new blocks immediately after it.

```typescript
// Add an idempotent agents.harness column
await pool.query(`
  ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS harness TEXT NOT NULL DEFAULT 'opencode';
`)

// Agent runtime state table for fleet executor
await pool.query(`
  CREATE TABLE IF NOT EXISTS agent_runtime_state (
    agent_id      TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
    pid           INTEGER,
    port          INTEGER,
    worktree_path TEXT,
    status        TEXT NOT NULL DEFAULT 'stopped',
    last_error    TEXT,
    started_at    TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`)
await pool.query(`
  CREATE INDEX IF NOT EXISTS idx_agent_runtime_state_status
    ON agent_runtime_state (status);
`)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm run test:db -- tests/fleet-executor/db.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/db.ts backend/tests/fleet-executor/db.test.ts
git commit -m "feat(db): add agent_runtime_state and agents.harness column"
```

---

## Task H4: Worktree Manager

**Files:**
- Create: `backend/src/fleet-executor/worktree-manager.ts`
- Test: `backend/tests/fleet-executor/worktree-manager.test.ts`

**Allowed files:** the two above.

- [ ] **Step 1: Write the failing test**

`backend/tests/fleet-executor/worktree-manager.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createWorktreeManager } from '../../src/fleet-executor/worktree-manager.js'

describe('WorktreeManager', () => {
  it('creates a worktree under the configured root', async () => {
    const execCalls: string[] = []
    const execFile = vi.fn(async (cmd: string, args: string[]) => {
      execCalls.push([cmd, ...args].join(' '))
      return { stdout: '', stderr: '' }
    })
    const mgr = createWorktreeManager({
      repoRoot: '/repo',
      worktreesRoot: '/repo/worktrees',
      execFile: execFile as unknown as (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>,
    })

    const path = await mgr.create('agent-1')
    expect(path).toBe('/repo/worktrees/agent-1')
    expect(execCalls.some((c) => c.startsWith('git worktree add'))).toBe(true)
  })

  it('resets a worktree to origin/main', async () => {
    const execCalls: string[] = []
    const execFile = vi.fn(async (cmd: string, args: string[]) => {
      execCalls.push([cmd, ...args].join(' '))
      return { stdout: '', stderr: '' }
    })
    const mgr = createWorktreeManager({
      repoRoot: '/repo',
      worktreesRoot: '/repo/worktrees',
      execFile: execFile as unknown as (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>,
    })

    await mgr.reset('agent-1', 'main')
    expect(execCalls).toContain('git -C /repo/worktrees/agent-1 fetch origin main')
    expect(execCalls).toContain('git -C /repo/worktrees/agent-1 reset --hard origin/main')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/fleet-executor/worktree-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement WorktreeManager**

`backend/src/fleet-executor/worktree-manager.ts`:

```typescript
import { execFile as defaultExecFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'

export interface WorktreeManagerOptions {
  repoRoot: string
  worktreesRoot: string
  execFile?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
}

export interface WorktreeManager {
  create(agentId: string, branch?: string): Promise<string>
  reset(agentId: string, baseBranch: string): Promise<void>
  remove(agentId: string): Promise<void>
  pathFor(agentId: string): string
}

export function createWorktreeManager(opts: WorktreeManagerOptions): WorktreeManager {
  const execFile = opts.execFile ?? promisify(defaultExecFile)

  function pathFor(agentId: string): string {
    return path.join(opts.worktreesRoot, agentId)
  }

  async function run(cmd: string, args: string[]): Promise<void> {
    await execFile(cmd, args)
  }

  return {
    pathFor,

    async create(agentId: string, branch = 'main'): Promise<string> {
      const wtPath = pathFor(agentId)
      await run('git', ['-C', opts.repoRoot, 'worktree', 'add', wtPath, branch])
      return wtPath
    },

    async reset(agentId: string, baseBranch: string): Promise<void> {
      const wtPath = pathFor(agentId)
      await run('git', ['-C', wtPath, 'fetch', 'origin', baseBranch])
      await run('git', ['-C', wtPath, 'reset', '--hard', `origin/${baseBranch}`])
    },

    async remove(agentId: string): Promise<void> {
      const wtPath = pathFor(agentId)
      await run('git', ['-C', opts.repoRoot, 'worktree', 'remove', '--force', wtPath])
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/fleet-executor/worktree-manager.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/fleet-executor/worktree-manager.ts backend/tests/fleet-executor/worktree-manager.test.ts
git commit -m "feat(fleet-executor): add worktree manager"
```

---

## Task H5: Process Manager

**Files:**
- Create: `backend/src/fleet-executor/process-manager.ts`
- Test: `backend/tests/fleet-executor/process-manager.test.ts`

**Allowed files:** the two above. **Read for context:** `backend/src/fleet-executor/harness.ts`, `backend/src/fleet-executor/worktree-manager.ts`.

- [ ] **Step 1: Write the failing test**

`backend/tests/fleet-executor/process-manager.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createProcessManager } from '../../src/fleet-executor/process-manager.js'
import type { AgentHarness } from '../../src/fleet-executor/harness.js'

function stubHarness(): AgentHarness {
  return {
    start: vi.fn(async () => {}),
    dispatch: vi.fn(async () => ({ id: 't', events: (async function* () {})(), done: Promise.resolve({ text: '', tokens: 0 }) })),
    abort: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }
}

describe('ProcessManager', () => {
  it('starts a harness for an agent using the harness factory', async () => {
    const factory = vi.fn(() => stubHarness())
    const mgr = createProcessManager({
      harnessFactories: { opencode: factory, pi: () => stubHarness() },
      worktreeRoot: '/tmp/worktrees',
      ensureWorktree: vi.fn(async () => '/tmp/worktrees/a1'),
      portAllocator: () => 4500,
    })

    const harness = await mgr.startAgent({
      id: 'a1',
      name: 'Test Agent',
      harness: 'opencode',
      model: { providerID: 'lmstudio', id: 'unsloth/qwen3.6-35b-a3b' },
    })

    expect(harness).toBeDefined()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(mgr.getHarness('a1')).toBe(harness)
  })

  it('returns the existing harness on repeated start', async () => {
    const factory = vi.fn(() => stubHarness())
    const mgr = createProcessManager({
      harnessFactories: { opencode: factory, pi: () => stubHarness() },
      worktreeRoot: '/tmp/worktrees',
      ensureWorktree: vi.fn(async () => '/tmp/worktrees/a2'),
      portAllocator: () => 4501,
    })
    const h1 = await mgr.startAgent({ id: 'a2', name: '', harness: 'opencode', model: { providerID: 'p', id: 'm' } })
    const h2 = await mgr.startAgent({ id: 'a2', name: '', harness: 'opencode', model: { providerID: 'p', id: 'm' } })
    expect(h1).toBe(h2)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('stops and removes a harness', async () => {
    const h = stubHarness()
    const factory = vi.fn(() => h)
    const mgr = createProcessManager({
      harnessFactories: { opencode: factory, pi: () => stubHarness() },
      worktreeRoot: '/tmp/worktrees',
      ensureWorktree: vi.fn(async () => '/tmp/worktrees/a3'),
      portAllocator: () => 4502,
    })
    await mgr.startAgent({ id: 'a3', name: '', harness: 'opencode', model: { providerID: 'p', id: 'm' } })
    await mgr.stopAgent('a3')
    expect(h.close).toHaveBeenCalled()
    expect(mgr.getHarness('a3')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/fleet-executor/process-manager.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ProcessManager**

`backend/src/fleet-executor/process-manager.ts`:

```typescript
import type { AgentHarness, ModelRef } from './harness.js'

export type HarnessKind = 'opencode' | 'pi'

export interface AgentDescriptor {
  id: string
  name: string
  harness: HarnessKind
  model: ModelRef
}

export interface HarnessFactoryOptions {
  port: number
  agent: AgentDescriptor
}

export type HarnessFactory = (opts: HarnessFactoryOptions) => AgentHarness

export interface ProcessManagerOptions {
  harnessFactories: Record<HarnessKind, HarnessFactory>
  worktreeRoot: string
  ensureWorktree: (agentId: string) => Promise<string>
  portAllocator: () => number
}

export interface ProcessManager {
  startAgent(agent: AgentDescriptor): Promise<AgentHarness>
  stopAgent(agentId: string): Promise<void>
  getHarness(agentId: string): AgentHarness | undefined
  closeAll(): Promise<void>
}

export function createProcessManager(opts: ProcessManagerOptions): ProcessManager {
  const harnesses = new Map<string, AgentHarness>()

  return {
    async startAgent(agent: AgentDescriptor): Promise<AgentHarness> {
      const existing = harnesses.get(agent.id)
      if (existing) return existing

      const factory = opts.harnessFactories[agent.harness]
      if (!factory) throw new Error(`No harness factory for kind: ${agent.harness}`)

      const cwd = await opts.ensureWorktree(agent.id)
      const port = opts.portAllocator()
      const harness = factory({ port, agent })
      await harness.start({ cwd, model: agent.model })
      harnesses.set(agent.id, harness)
      return harness
    },

    async stopAgent(agentId: string): Promise<void> {
      const h = harnesses.get(agentId)
      if (!h) return
      await h.close()
      harnesses.delete(agentId)
    },

    getHarness(agentId: string): AgentHarness | undefined {
      return harnesses.get(agentId)
    },

    async closeAll(): Promise<void> {
      for (const [id, h] of harnesses) {
        try {
          await h.close()
        } catch {
          // ignore
        }
        harnesses.delete(id)
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/fleet-executor/process-manager.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/fleet-executor/process-manager.ts backend/tests/fleet-executor/process-manager.test.ts
git commit -m "feat(fleet-executor): add process manager"
```

---

## Task H6: Prompt Format

**Files:**
- Create: `backend/src/fleet-executor/prompt-format.ts`
- Test: `backend/tests/fleet-executor/prompt-format.test.ts`

**Allowed files:** the two above.

- [ ] **Step 1: Write the failing test**

`backend/tests/fleet-executor/prompt-format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { formatTaskPrompt, type DelegationRequest } from '../../src/fleet-executor/prompt-format.js'

describe('formatTaskPrompt', () => {
  it('includes title, description, allowed files, verification cmd', () => {
    const req: DelegationRequest = {
      title: 'Add foo',
      description: 'Implement foo helper.',
      allowed_files: ['backend/src/foo.ts'],
      read_files: ['backend/src/bar.ts'],
      verification_cmd: 'cd backend && npm run build',
    }
    const text = formatTaskPrompt(req)
    expect(text).toContain('Add foo')
    expect(text).toContain('Implement foo helper.')
    expect(text).toContain('backend/src/foo.ts')
    expect(text).toContain('backend/src/bar.ts')
    expect(text).toContain('cd backend && npm run build')
    expect(text).toContain('TASK COMPLETE')
  })

  it('uses sensible placeholders when fields are missing', () => {
    const text = formatTaskPrompt({ title: '', description: '', allowed_files: [], read_files: [] })
    expect(text).toContain('TASK COMPLETE')
    expect(text).toContain('(none)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/fleet-executor/prompt-format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement formatTaskPrompt**

`backend/src/fleet-executor/prompt-format.ts`:

```typescript
export interface DelegationRequest {
  title: string
  description: string
  allowed_files: string[]
  read_files: string[]
  verification_cmd?: string
  notes?: string
}

export function formatTaskPrompt(req: DelegationRequest): string {
  const list = (xs: string[]): string => (xs.length === 0 ? '(none)' : xs.map((x) => `- ${x}`).join('\n'))

  return [
    '# Task',
    '',
    req.title || '(untitled)',
    '',
    '## Context',
    '',
    req.description || '(no description provided)',
    '',
    '## Files you may read',
    '',
    list(req.read_files),
    '',
    '## Files you may edit',
    '',
    list(req.allowed_files),
    '',
    '## Files you may NOT touch',
    '',
    'Everything else in the repository. If you need to edit something outside the list above, stop and report.',
    '',
    '## Verification',
    '',
    req.verification_cmd ? `Run: ${req.verification_cmd}` : 'No verification command specified.',
    '',
    req.notes ? `## Notes\n\n${req.notes}\n` : '',
    '## Completion',
    '',
    'Output the TASK COMPLETE block per AGENTS.md and stop. Do not summarize after.',
  ].join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/fleet-executor/prompt-format.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/fleet-executor/prompt-format.ts backend/tests/fleet-executor/prompt-format.test.ts
git commit -m "feat(fleet-executor): add task prompt format"
```

---

## Task H7: Scope Gate

**Files:**
- Create: `backend/src/fleet-executor/scope-gate.ts`
- Test: `backend/tests/fleet-executor/scope-gate.test.ts`

**Allowed files:** the two above.

- [ ] **Step 1: Write the failing test**

`backend/tests/fleet-executor/scope-gate.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { checkScope } from '../../src/fleet-executor/scope-gate.js'

describe('checkScope', () => {
  it('passes when all changed files are in allow-list', async () => {
    const execFile = vi.fn(async () => ({ stdout: 'backend/src/foo.ts\nbackend/src/bar.ts\n', stderr: '' }))
    const result = await checkScope({
      worktreePath: '/tmp/wt',
      allowedFiles: ['backend/src/foo.ts', 'backend/src/bar.ts'],
      execFile: execFile as any,
    })
    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('fails when a changed file is outside allow-list', async () => {
    const execFile = vi.fn(async () => ({ stdout: 'backend/src/foo.ts\nbackend/src/sneaky.ts\n', stderr: '' }))
    const result = await checkScope({
      worktreePath: '/tmp/wt',
      allowedFiles: ['backend/src/foo.ts'],
      execFile: execFile as any,
    })
    expect(result.ok).toBe(false)
    expect(result.violations).toEqual(['backend/src/sneaky.ts'])
  })

  it('treats no changes as a pass', async () => {
    const execFile = vi.fn(async () => ({ stdout: '', stderr: '' }))
    const result = await checkScope({
      worktreePath: '/tmp/wt',
      allowedFiles: ['backend/src/foo.ts'],
      execFile: execFile as any,
    })
    expect(result.ok).toBe(true)
    expect(result.changed).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/fleet-executor/scope-gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement checkScope**

`backend/src/fleet-executor/scope-gate.ts`:

```typescript
import { execFile as defaultExecFile } from 'child_process'
import { promisify } from 'util'

export interface ScopeCheckOptions {
  worktreePath: string
  allowedFiles: string[]
  execFile?: (cmd: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
}

export interface ScopeCheckResult {
  ok: boolean
  changed: string[]
  violations: string[]
}

export async function checkScope(opts: ScopeCheckOptions): Promise<ScopeCheckResult> {
  const execFile = opts.execFile ?? promisify(defaultExecFile)
  const { stdout } = await execFile('git', ['-C', opts.worktreePath, 'diff', '--name-only', 'HEAD'])
  const changed = stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const allow = new Set(opts.allowedFiles)
  const violations = changed.filter((f) => !allow.has(f))
  return { ok: violations.length === 0, changed, violations }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/fleet-executor/scope-gate.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/fleet-executor/scope-gate.ts backend/tests/fleet-executor/scope-gate.test.ts
git commit -m "feat(fleet-executor): add scope gate"
```

---

## Task H8: Result Router

**Files:**
- Create: `backend/src/fleet-executor/result-router.ts`
- Test: `backend/tests/fleet-executor/result-router.test.ts`

**Allowed files:** the two above. **Read for context:** `backend/src/prime-agent/events.ts`, `backend/src/prime-agent/queue.ts`, `backend/src/runtime.ts`.

- [ ] **Step 1: Write the failing test**

`backend/tests/fleet-executor/result-router.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createResultRouter, type DeliveryDeps } from '../../src/fleet-executor/result-router.js'

function depsStub(): DeliveryDeps & {
  enqueued: unknown[]
  threadPosts: unknown[]
  delegationUpdates: unknown[]
} {
  const enqueued: unknown[] = []
  const threadPosts: unknown[] = []
  const delegationUpdates: unknown[] = []
  return {
    enqueued,
    threadPosts,
    delegationUpdates,
    enqueuePrimeEvent: vi.fn(async (e) => {
      enqueued.push(e)
    }),
    appendThreadMessage: vi.fn(async (threadId, msg) => {
      threadPosts.push({ threadId, ...msg })
      return { id: 'm', ...msg }
    }) as DeliveryDeps['appendThreadMessage'],
    updateDelegation: vi.fn(async (id, patch) => {
      delegationUpdates.push({ id, patch })
    }),
  }
}

describe('ResultRouter', () => {
  it('emits fleet.delegation.completed and updates the delegation row on success', async () => {
    const deps = depsStub()
    const router = createResultRouter(deps)
    await router.deliver({
      delegation_id: 'd1',
      work_item_id: 'w1',
      agent_id: 'a1',
      thread_id: 't1',
      success: true,
      result: { changed_files: ['x.ts'], verification: { command: 'npm test', exit_code: 0, output: 'ok' } },
    })
    expect(deps.enqueued[0]).toMatchObject({ type: 'fleet.delegation.completed' })
    expect(deps.delegationUpdates[0]).toMatchObject({ id: 'd1', patch: { status: 'completed' } })
    expect(deps.threadPosts[0]).toMatchObject({ threadId: 't1' })
  })

  it('emits fleet.delegation.failed on failure', async () => {
    const deps = depsStub()
    const router = createResultRouter(deps)
    await router.deliver({
      delegation_id: 'd2',
      work_item_id: 'w2',
      agent_id: 'a2',
      thread_id: 't2',
      success: false,
      error: 'scope violation: foo.ts',
    })
    expect(deps.enqueued[0]).toMatchObject({ type: 'fleet.delegation.failed', payload: expect.objectContaining({ error: 'scope violation: foo.ts' }) })
    expect(deps.delegationUpdates[0]).toMatchObject({ id: 'd2', patch: { status: 'failed' } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/fleet-executor/result-router.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ResultRouter**

`backend/src/fleet-executor/result-router.ts`:

```typescript
import type { FleetDelegationCompletedEvent, FleetDelegationFailedEvent } from '../prime-agent/events.js'

export interface DeliveryRecord {
  delegation_id: string
  work_item_id?: string
  agent_id?: string
  thread_id?: string
  success: boolean
  result?: {
    changed_files?: string[]
    verification?: { command: string; exit_code: number; output: string }
  }
  error?: string
}

export interface DeliveryDeps {
  enqueuePrimeEvent: (event: FleetDelegationCompletedEvent | FleetDelegationFailedEvent) => Promise<void>
  appendThreadMessage: (
    threadId: string,
    message: { role: 'assistant'; sender: string; content: string; metadata?: Record<string, unknown> }
  ) => Promise<{ id: string }>
  updateDelegation: (id: string, patch: { status: string; result?: unknown; error?: string }) => Promise<void>
}

export interface ResultRouter {
  deliver(record: DeliveryRecord): Promise<void>
}

export function createResultRouter(deps: DeliveryDeps): ResultRouter {
  return {
    async deliver(record: DeliveryRecord): Promise<void> {
      if (record.success) {
        const event: FleetDelegationCompletedEvent = {
          type: 'fleet.delegation.completed',
          payload: {
            delegation_id: record.delegation_id,
            work_item_id: record.work_item_id,
            agent_id: record.agent_id,
            result: record.result as Record<string, unknown> | undefined,
          },
        }
        await deps.enqueuePrimeEvent(event)
        await deps.updateDelegation(record.delegation_id, { status: 'completed', result: record.result })
        if (record.thread_id) {
          await deps.appendThreadMessage(record.thread_id, {
            role: 'assistant',
            sender: 'Fleet Executor',
            content: `Delegation ${record.delegation_id} completed.${
              record.result?.changed_files ? ` Changed: ${record.result.changed_files.join(', ')}.` : ''
            }`,
            metadata: { source: 'fleet-executor', delegation_id: record.delegation_id },
          })
        }
      } else {
        const event: FleetDelegationFailedEvent = {
          type: 'fleet.delegation.failed',
          payload: {
            delegation_id: record.delegation_id,
            work_item_id: record.work_item_id,
            agent_id: record.agent_id,
            error: record.error ?? 'unknown error',
          },
        }
        await deps.enqueuePrimeEvent(event)
        await deps.updateDelegation(record.delegation_id, { status: 'failed', error: record.error })
        if (record.thread_id) {
          await deps.appendThreadMessage(record.thread_id, {
            role: 'assistant',
            sender: 'Fleet Executor',
            content: `Delegation ${record.delegation_id} failed: ${record.error ?? 'unknown error'}`,
            metadata: { source: 'fleet-executor', delegation_id: record.delegation_id },
          })
        }
      }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/fleet-executor/result-router.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/fleet-executor/result-router.ts backend/tests/fleet-executor/result-router.test.ts
git commit -m "feat(fleet-executor): add result router"
```

---

## Task H9: Progress Reporter

**Files:**
- Create: `backend/src/fleet-executor/progress-reporter.ts`
- Test: `backend/tests/fleet-executor/progress-reporter.test.ts`

**Allowed files:** the two above. **Read for context:** `backend/src/fleet-executor/harness.ts`.

- [ ] **Step 1: Write the failing test**

`backend/tests/fleet-executor/progress-reporter.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { runProgressReporter } from '../../src/fleet-executor/progress-reporter.js'
import type { HarnessEvent } from '../../src/fleet-executor/harness.js'

describe('runProgressReporter', () => {
  it('extracts progress summaries and posts them to the thread', async () => {
    const events: HarnessEvent[] = [
      { type: 'task_start' },
      { type: 'message_update', delta: '## Progress\n### Done\n- Read file\n' },
      { type: 'tool_call_start', tool: 'bash', args: {} },
      { type: 'message_update', delta: '## Progress\n### Done\n- Read file\n- Wrote test\n' },
      { type: 'task_end', result: { text: 'ok', tokens: 0 } },
    ]

    const posts: string[] = []
    const appendThreadMessage = vi.fn(async (_threadId: string, msg: { content: string }) => {
      posts.push(msg.content)
      return { id: 'm' }
    })

    await runProgressReporter({
      threadId: 't1',
      events: (async function* () {
        for (const e of events) yield e
      })(),
      appendThreadMessage: appendThreadMessage as any,
    })

    expect(posts.length).toBeGreaterThanOrEqual(1)
    expect(posts.some((p) => p.includes('Wrote test'))).toBe(true)
  })

  it('does not post duplicates', async () => {
    const events: HarnessEvent[] = [
      { type: 'message_update', delta: '## Progress\n### Done\n- Same\n' },
      { type: 'message_update', delta: '## Progress\n### Done\n- Same\n' },
      { type: 'task_end', result: { text: '', tokens: 0 } },
    ]
    const posts: string[] = []
    const append = vi.fn(async (_t: string, m: { content: string }) => {
      posts.push(m.content)
      return { id: 'm' }
    })
    await runProgressReporter({
      threadId: 't',
      events: (async function* () {
        for (const e of events) yield e
      })(),
      appendThreadMessage: append as any,
    })
    expect(posts.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/fleet-executor/progress-reporter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement runProgressReporter**

`backend/src/fleet-executor/progress-reporter.ts`:

```typescript
import type { HarnessEvent } from './harness.js'

export interface ProgressReporterOpts {
  threadId: string
  events: AsyncIterable<HarnessEvent>
  appendThreadMessage: (
    threadId: string,
    message: { role: 'assistant'; sender: string; content: string; metadata?: Record<string, unknown> }
  ) => Promise<{ id: string }>
}

const PROGRESS_RE = /## Progress[\s\S]*?(?=\n## |\n# |$)/

export async function runProgressReporter(opts: ProgressReporterOpts): Promise<void> {
  let buffer = ''
  let lastPosted: string | null = null

  for await (const event of opts.events) {
    if (event.type === 'message_update') {
      buffer += event.delta
      const match = buffer.match(PROGRESS_RE)
      if (match) {
        const block = match[0].trim()
        if (block !== lastPosted) {
          await opts.appendThreadMessage(opts.threadId, {
            role: 'assistant',
            sender: 'Fleet Executor',
            content: block,
            metadata: { source: 'fleet-executor-progress' },
          })
          lastPosted = block
        }
      }
    } else if (event.type === 'progress') {
      if (event.summary !== lastPosted) {
        await opts.appendThreadMessage(opts.threadId, {
          role: 'assistant',
          sender: 'Fleet Executor',
          content: event.summary,
          metadata: { source: 'fleet-executor-progress' },
        })
        lastPosted = event.summary
      }
    } else if (event.type === 'task_end') {
      return
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/fleet-executor/progress-reporter.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/fleet-executor/progress-reporter.ts backend/tests/fleet-executor/progress-reporter.test.ts
git commit -m "feat(fleet-executor): add progress reporter"
```

---

## Task H10: Dispatcher

**Files:**
- Create: `backend/src/fleet-executor/dispatcher.ts`
- Test: `backend/tests/fleet-executor/dispatcher.test.ts`

**Allowed files:** the two above. **Read for context:** all other files in `backend/src/fleet-executor/`.

This is the integration task that wires harness + scope gate + result router + progress reporter together.

- [ ] **Step 1: Write the failing test**

`backend/tests/fleet-executor/dispatcher.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { dispatchOne, type DispatchDeps, type Delegation } from '../../src/fleet-executor/dispatcher.js'
import type { AgentHarness } from '../../src/fleet-executor/harness.js'

function harnessThatCompletes(text: string): AgentHarness {
  return {
    start: vi.fn(async () => {}),
    dispatch: vi.fn(async () => {
      const result = { text, tokens: 0 }
      return {
        id: 't',
        events: (async function* () {
          yield { type: 'task_start' as const }
          yield { type: 'task_end' as const, result }
        })(),
        done: Promise.resolve(result),
      }
    }),
    abort: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }
}

const delegation: Delegation = {
  id: 'd1',
  work_item_id: 'w1',
  to_agent_id: 'a1',
  thread_id: 't1',
  capability: 'implementation',
  status: 'queued',
  request: {
    title: 'Do thing',
    description: 'Implement a thing.',
    allowed_files: ['backend/src/thing.ts'],
    read_files: [],
    verification_cmd: 'echo ok',
  },
}

describe('dispatchOne', () => {
  it('runs the full pipeline on success', async () => {
    const harness = harnessThatCompletes('TASK COMPLETE\nChanged: backend/src/thing.ts\nVerification: echo ok\n')

    const deps: DispatchDeps = {
      getHarness: vi.fn(() => harness),
      worktreePathFor: vi.fn(() => '/tmp/wt'),
      checkScope: vi.fn(async () => ({ ok: true, changed: ['backend/src/thing.ts'], violations: [] })),
      resetWorktree: vi.fn(async () => {}),
      deliver: vi.fn(async () => {}),
      runProgressReporter: vi.fn(async () => {}),
      claim: vi.fn(async () => delegation),
    }

    const result = await dispatchOne(deps, delegation.id)
    expect(result.success).toBe(true)
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({ success: true }))
  })

  it('marks failed if scope is violated', async () => {
    const harness = harnessThatCompletes('TASK COMPLETE\nChanged: foo.ts\nVerification: echo ok\n')
    const deps: DispatchDeps = {
      getHarness: vi.fn(() => harness),
      worktreePathFor: vi.fn(() => '/tmp/wt'),
      checkScope: vi.fn(async () => ({ ok: false, changed: ['foo.ts'], violations: ['foo.ts'] })),
      resetWorktree: vi.fn(async () => {}),
      deliver: vi.fn(async () => {}),
      runProgressReporter: vi.fn(async () => {}),
      claim: vi.fn(async () => delegation),
    }
    const result = await dispatchOne(deps, delegation.id)
    expect(result.success).toBe(false)
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.stringMatching(/scope/i) }))
  })

  it('marks failed if no harness exists for the agent', async () => {
    const deps: DispatchDeps = {
      getHarness: vi.fn(() => undefined),
      worktreePathFor: vi.fn(() => '/tmp/wt'),
      checkScope: vi.fn(async () => ({ ok: true, changed: [], violations: [] })),
      resetWorktree: vi.fn(async () => {}),
      deliver: vi.fn(async () => {}),
      runProgressReporter: vi.fn(async () => {}),
      claim: vi.fn(async () => delegation),
    }
    const result = await dispatchOne(deps, delegation.id)
    expect(result.success).toBe(false)
    expect(deps.deliver).toHaveBeenCalledWith(expect.objectContaining({ success: false }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/fleet-executor/dispatcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement dispatchOne**

`backend/src/fleet-executor/dispatcher.ts`:

```typescript
import type { AgentHarness } from './harness.js'
import { formatTaskPrompt, type DelegationRequest } from './prompt-format.js'
import type { ScopeCheckResult } from './scope-gate.js'
import type { DeliveryRecord } from './result-router.js'

export interface Delegation {
  id: string
  work_item_id?: string
  to_agent_id?: string
  thread_id?: string
  capability?: string
  status: string
  request: DelegationRequest
}

export interface DispatchDeps {
  claim: (delegationId: string) => Promise<Delegation | null>
  getHarness: (agentId: string) => AgentHarness | undefined
  worktreePathFor: (agentId: string) => string
  resetWorktree: (agentId: string) => Promise<void>
  checkScope: (opts: { worktreePath: string; allowedFiles: string[] }) => Promise<ScopeCheckResult>
  runProgressReporter: (opts: { threadId: string; events: AsyncIterable<unknown> }) => Promise<void>
  deliver: (record: DeliveryRecord) => Promise<void>
}

export interface DispatchOutcome {
  success: boolean
  error?: string
}

export async function dispatchOne(deps: DispatchDeps, delegationId: string): Promise<DispatchOutcome> {
  const delegation = await deps.claim(delegationId)
  if (!delegation) {
    return { success: false, error: 'delegation not found or already claimed' }
  }

  if (!delegation.to_agent_id) {
    await deps.deliver({
      delegation_id: delegation.id,
      work_item_id: delegation.work_item_id,
      thread_id: delegation.thread_id,
      success: false,
      error: 'no target agent assigned',
    })
    return { success: false, error: 'no target agent' }
  }

  const harness = deps.getHarness(delegation.to_agent_id)
  if (!harness) {
    await deps.deliver({
      delegation_id: delegation.id,
      work_item_id: delegation.work_item_id,
      agent_id: delegation.to_agent_id,
      thread_id: delegation.thread_id,
      success: false,
      error: `no running harness for agent ${delegation.to_agent_id}`,
    })
    return { success: false, error: 'no harness' }
  }

  await deps.resetWorktree(delegation.to_agent_id)
  const worktreePath = deps.worktreePathFor(delegation.to_agent_id)

  const promptText = formatTaskPrompt(delegation.request)
  let handle
  try {
    handle = await harness.dispatch({
      text: promptText,
      allowed_files: delegation.request.allowed_files,
      read_files: delegation.request.read_files,
      verification_cmd: delegation.request.verification_cmd,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await deps.deliver({
      delegation_id: delegation.id,
      work_item_id: delegation.work_item_id,
      agent_id: delegation.to_agent_id,
      thread_id: delegation.thread_id,
      success: false,
      error: `dispatch failed: ${message}`,
    })
    return { success: false, error: message }
  }

  if (delegation.thread_id) {
    void deps.runProgressReporter({ threadId: delegation.thread_id, events: handle.events as AsyncIterable<unknown> })
  }

  let result
  try {
    result = await handle.done
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await deps.deliver({
      delegation_id: delegation.id,
      work_item_id: delegation.work_item_id,
      agent_id: delegation.to_agent_id,
      thread_id: delegation.thread_id,
      success: false,
      error: `task error: ${message}`,
    })
    return { success: false, error: message }
  }

  const scope = await deps.checkScope({ worktreePath, allowedFiles: delegation.request.allowed_files })
  if (!scope.ok) {
    await deps.deliver({
      delegation_id: delegation.id,
      work_item_id: delegation.work_item_id,
      agent_id: delegation.to_agent_id,
      thread_id: delegation.thread_id,
      success: false,
      error: `scope violation: ${scope.violations.join(', ')}`,
      result: { changed_files: scope.changed },
    })
    return { success: false, error: 'scope violation' }
  }

  await deps.deliver({
    delegation_id: delegation.id,
    work_item_id: delegation.work_item_id,
    agent_id: delegation.to_agent_id,
    thread_id: delegation.thread_id,
    success: true,
    result: { changed_files: scope.changed },
  })
  return { success: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/fleet-executor/dispatcher.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/fleet-executor/dispatcher.ts backend/tests/fleet-executor/dispatcher.test.ts
git commit -m "feat(fleet-executor): add dispatcher integration"
```

---

## Task H11: Bootstrap Service

**Files:**
- Create: `backend/src/fleet-executor/service.ts`
- Modify: `backend/src/index.ts`
- Test: `backend/tests/fleet-executor/service.test.ts`

**Allowed files:** the three above. **Read for context:** all other files in `backend/src/fleet-executor/`.

- [ ] **Step 1: Write the failing test**

`backend/tests/fleet-executor/service.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { createFleetExecutorService } from '../../src/fleet-executor/service.js'

describe('createFleetExecutorService', () => {
  it('creates a service that exposes process manager and dispatcher', () => {
    const service = createFleetExecutorService({
      pool: {} as any,
      primeQueue: { enqueue: vi.fn(async () => {}) } as any,
      repoRoot: '/repo',
      worktreesRoot: '/repo/worktrees',
      portStart: 4500,
    })
    expect(typeof service.start).toBe('function')
    expect(typeof service.close).toBe('function')
    expect(typeof service.dispatchDelegation).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/fleet-executor/service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement service.ts**

`backend/src/fleet-executor/service.ts`:

```typescript
import type pg from 'pg'
import type { PrimeQueue } from '../prime-agent/queue.js'
import { createProcessManager, type HarnessFactory, type HarnessKind } from './process-manager.js'
import { createWorktreeManager } from './worktree-manager.js'
import { createOpenCodeHarness } from './opencode-harness.js'
import { createPiHarness } from './pi-harness.js'
import { createResultRouter } from './result-router.js'
import { runProgressReporter } from './progress-reporter.js'
import { checkScope } from './scope-gate.js'
import { dispatchOne, type Delegation, type DispatchDeps } from './dispatcher.js'
import { appendThreadMessage } from '../runtime.js'

export interface FleetExecutorOptions {
  pool: pg.Pool
  primeQueue: PrimeQueue
  repoRoot: string
  worktreesRoot: string
  portStart: number
}

export interface FleetExecutorService {
  start(): Promise<void>
  close(): Promise<void>
  dispatchDelegation(delegationId: string): Promise<{ success: boolean; error?: string }>
}

export function createFleetExecutorService(opts: FleetExecutorOptions): FleetExecutorService {
  let nextPort = opts.portStart

  const worktrees = createWorktreeManager({
    repoRoot: opts.repoRoot,
    worktreesRoot: opts.worktreesRoot,
  })

  const harnessFactories: Record<HarnessKind, HarnessFactory> = {
    opencode: ({ port }) => createOpenCodeHarness({ port }),
    pi: () => createPiHarness(),
  }

  const processes = createProcessManager({
    harnessFactories,
    worktreeRoot: opts.worktreesRoot,
    ensureWorktree: async (agentId) => {
      try {
        return await worktrees.create(agentId)
      } catch {
        return worktrees.pathFor(agentId)
      }
    },
    portAllocator: () => nextPort++,
  })

  const router = createResultRouter({
    enqueuePrimeEvent: async (event) => opts.primeQueue.enqueue(event),
    appendThreadMessage: async (threadId, msg) => appendThreadMessage(opts.pool, threadId, msg),
    updateDelegation: async (id, patch) => {
      await opts.pool.query(
        `UPDATE delegations
         SET status = $2,
             response = COALESCE($3, response),
             error = COALESCE($4, error),
             updated_at = now()
         WHERE id = $1`,
        [id, patch.status, JSON.stringify(patch.result ?? null), patch.error ?? null]
      )
    },
  })

  async function claimDelegation(delegationId: string): Promise<Delegation | null> {
    const { rows } = await opts.pool.query(
      `UPDATE delegations
       SET status = 'in_progress', updated_at = now()
       WHERE id = $1 AND status = 'queued'
       RETURNING id, work_item_id, to_agent_id, status, capability, request`,
      [delegationId]
    )
    const row = rows[0]
    if (!row) return null
    const request = (row.request ?? {}) as Record<string, unknown>
    const threadId = typeof request.thread_id === 'string' ? (request.thread_id as string) : undefined
    return {
      id: row.id,
      work_item_id: row.work_item_id ?? undefined,
      to_agent_id: row.to_agent_id ?? undefined,
      thread_id: threadId,
      capability: row.capability ?? undefined,
      status: row.status,
      request: {
        title: String(request.title ?? ''),
        description: String(request.description ?? ''),
        allowed_files: Array.isArray(request.allowed_files) ? (request.allowed_files as string[]) : [],
        read_files: Array.isArray(request.read_files) ? (request.read_files as string[]) : [],
        verification_cmd: typeof request.verification_cmd === 'string' ? (request.verification_cmd as string) : undefined,
      },
    }
  }

  const dispatchDeps: DispatchDeps = {
    claim: claimDelegation,
    getHarness: (id) => processes.getHarness(id),
    worktreePathFor: (id) => worktrees.pathFor(id),
    resetWorktree: async (id) => worktrees.reset(id, 'main').catch(() => {}),
    checkScope: (o) => checkScope({ worktreePath: o.worktreePath, allowedFiles: o.allowedFiles }),
    runProgressReporter: async ({ threadId, events }) =>
      runProgressReporter({
        threadId,
        events: events as AsyncIterable<import('./harness.js').HarnessEvent>,
        appendThreadMessage: async (tid, msg) => appendThreadMessage(opts.pool, tid, msg),
      }),
    deliver: (r) => router.deliver(r),
  }

  return {
    async start(): Promise<void> {
      // Boot harnesses for enabled agents at startup.
      const { rows } = await opts.pool.query(
        `SELECT id, name, harness, model FROM agents WHERE enabled = true`
      )
      for (const row of rows) {
        const harnessKind = (row.harness ?? 'opencode') as HarnessKind
        const model = row.model as { providerID?: string; id?: string } | null
        if (!model?.providerID || !model.id) continue
        try {
          await processes.startAgent({
            id: row.id,
            name: row.name,
            harness: harnessKind,
            model: { providerID: model.providerID, id: model.id },
          })
        } catch (err) {
          console.error(`[fleet-executor] failed to start agent ${row.id}:`, err)
        }
      }
    },

    async close(): Promise<void> {
      await processes.closeAll()
    },

    async dispatchDelegation(delegationId: string) {
      return dispatchOne(dispatchDeps, delegationId)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/fleet-executor/service.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Wire into index.ts**

Open `backend/src/index.ts`. Find where `primeService` is created (around line 34). Immediately below it, add:

```typescript
import { createFleetExecutorService } from './fleet-executor/service.js'

const fleetExecutor = createFleetExecutorService({
  pool,
  primeQueue: primeService.queue,
  repoRoot: process.cwd(),
  worktreesRoot: `${process.cwd()}/worktrees`,
  portStart: Number(process.env.FLEET_EXECUTOR_PORT_START ?? 4500),
})
await fleetExecutor.start()
```

Find the existing shutdown hook (the line `await primeService.close()...`) and add immediately after:

```typescript
await fleetExecutor.close().catch((err) => console.error('[fleet-executor] shutdown failed:', err))
```

- [ ] **Step 6: Build check**

Run: `cd backend && npm run build`
Expected: clean build, no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/fleet-executor/service.ts backend/src/index.ts backend/tests/fleet-executor/service.test.ts
git commit -m "feat(fleet-executor): bootstrap service and wire into index"
```

---

## Task H12: REST Endpoint For Manual Dispatch

**Files:**
- Create: `backend/src/routes/fleet-executor.ts`
- Modify: `backend/src/app.ts` (mount router only)
- Test: `backend/tests/fleet-executor/route.test.ts`

**Allowed files:** the three above. **Read for context:** `backend/src/routes/prime-agent.ts`.

- [ ] **Step 1: Write the failing test**

`backend/tests/fleet-executor/route.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createFleetExecutorRouter } from '../../src/routes/fleet-executor.ts'

describe('fleet-executor router', () => {
  it('POST /dispatch/:id calls the service', async () => {
    const dispatchDelegation = vi.fn(async () => ({ success: true }))
    const app = express()
    app.use(express.json())
    app.use('/api/fleet-executor', createFleetExecutorRouter({ service: { dispatchDelegation } as any }))

    const res = await request(app).post('/api/fleet-executor/dispatch/d1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(dispatchDelegation).toHaveBeenCalledWith('d1')
  })

  it('returns 500 if dispatch throws', async () => {
    const dispatchDelegation = vi.fn(async () => {
      throw new Error('boom')
    })
    const app = express()
    app.use(express.json())
    app.use('/api/fleet-executor', createFleetExecutorRouter({ service: { dispatchDelegation } as any }))

    const res = await request(app).post('/api/fleet-executor/dispatch/d2')
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/fleet-executor/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement router**

`backend/src/routes/fleet-executor.ts`:

```typescript
import { Router } from 'express'
import type { FleetExecutorService } from '../fleet-executor/service.js'

export function createFleetExecutorRouter({ service }: { service: FleetExecutorService }) {
  const router = Router()

  router.post('/dispatch/:id', async (req, res) => {
    try {
      const result = await service.dispatchDelegation(req.params.id)
      res.json(result)
    } catch (err) {
      res.status(500).json({ error: (err as Error).message })
    }
  })

  return router
}
```

- [ ] **Step 4: Mount router in app.ts**

Open `backend/src/app.ts`. Find the existing router mount block (`app.use('/api/prime-agent', ...)`). Add a parallel line for fleet-executor. The deps object needs a new field `fleetExecutor`. Add the import at top and the mount near the other `app.use('/api/...')` lines:

```typescript
import { createFleetExecutorRouter } from './routes/fleet-executor.js'
// ...
app.use('/api/fleet-executor', createFleetExecutorRouter({ service: deps.fleetExecutor }))
```

Add `fleetExecutor: FleetExecutorService` to the `AppDeps` type used by `createApp`. Pass `fleetExecutor` from `index.ts` when calling `createApp`.

- [ ] **Step 5: Update index.ts to pass fleetExecutor into createApp**

In `backend/src/index.ts`, find the `createApp({...})` call. Add `fleetExecutor` to the deps object.

- [ ] **Step 6: Run tests**

Run: `cd backend && npx vitest run tests/fleet-executor/route.test.ts`
Expected: PASS, 2 tests.

Run full build: `cd backend && npm run build`
Expected: clean build.

- [ ] **Step 7: Commit**

```bash
cd /home/james/projects/agent-control-plane
git add backend/src/routes/fleet-executor.ts backend/src/app.ts backend/src/index.ts backend/tests/fleet-executor/route.test.ts
git commit -m "feat(fleet-executor): add manual dispatch REST endpoint"
```

---

## Task H13: End-to-end Smoke Test (Manual)

**Files:** none modified — this is a verification task.

**Goal:** Verify the harness pipeline works against real OpenCode and real Pi (with LM Studio).

- [ ] **Step 1: Confirm prerequisites**

Run: `opencode --version && pi --version`
Expected: both commands print versions. If `pi` is missing, install with `npm i -g @earendil-works/pi-coding-agent`.

Run: `curl -s http://spraycheese.lab.klsll.com:1234/v1/models | head -5`
Expected: LM Studio returns model list (contains `unsloth/qwen3.6-35b-a3b`).

- [ ] **Step 2: Bring up backend with fleet-executor**

Run: `cd backend && npm run dev`
Expected: log line containing `[fleet-executor]` indicating service started. No crash.

- [ ] **Step 3: Register a test agent with harness = opencode**

```bash
curl -X POST http://localhost:8000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "id": "test-opencode",
    "name": "Test OpenCode Agent",
    "enabled": true,
    "harness": "opencode",
    "model": {"providerID": "lmstudio", "id": "unsloth/qwen3.6-35b-a3b"}
  }'
```

Expected: 200 OK with the created agent.

If the agents POST route does not yet support `harness` and `model` columns, the agent can be inserted via SQL for this smoke test:

```bash
psql "$DATABASE_URL" -c "
  INSERT INTO agents (id, name, enabled, harness, model)
  VALUES ('test-opencode', 'Test OpenCode Agent', true, 'opencode', '{\"providerID\":\"lmstudio\",\"id\":\"unsloth/qwen3.6-35b-a3b\"}'::jsonb)
  ON CONFLICT (id) DO UPDATE SET harness = EXCLUDED.harness, model = EXCLUDED.model;"
```

- [ ] **Step 4: Create a delegation and dispatch it**

```bash
DELEGATION_ID=$(psql -t "$DATABASE_URL" -c "
  INSERT INTO delegations (work_item_id, to_agent_id, capability, status, request)
  VALUES (NULL, 'test-opencode', 'implementation', 'queued',
    '{\"title\":\"Echo task\",\"description\":\"Read README.md and report its first heading.\",\"allowed_files\":[],\"read_files\":[\"README.md\"]}'::jsonb)
  RETURNING id;" | xargs)
echo "Delegation: $DELEGATION_ID"

curl -X POST "http://localhost:8000/api/fleet-executor/dispatch/$DELEGATION_ID"
```

Expected: `{"success":true}` within a couple of minutes.

- [ ] **Step 5: Verify result event**

```bash
psql "$DATABASE_URL" -c "SELECT status, error FROM delegations WHERE id = '$DELEGATION_ID';"
psql "$DATABASE_URL" -c "SELECT trigger_type, status FROM prime_agent_sessions ORDER BY started_at DESC LIMIT 5;"
```

Expected: delegation status = `completed`. A new Prime session for the `fleet.delegation.completed` event should appear (if Prime is enabled).

- [ ] **Step 6: Repeat for Pi**

Repeat Step 3 with `id=test-pi` and `harness=pi`. Dispatch a delegation against it. Confirm the same successful completion via Pi.

- [ ] **Step 7: Commit smoke-test results**

Append the manual smoke-test outcome to a brief notes file (no production code changed):

```bash
cat > /tmp/smoke-results.md <<EOF
Fleet Executor smoke test — $(date +%Y-%m-%d)
- OpenCode harness: <result>
- Pi harness: <result>
EOF
```

Smoke test is verification only — nothing to commit unless adjustments to source were needed.

---

## Self-Review Findings

After drafting the plan, I checked it against the spec:

1. **Spec coverage:** All spec components (Process Manager, Task Dispatcher, Progress Reporter, Result Router, Scope Gate) have explicit tasks. Both OpenCode and Pi harnesses are implemented in the same plan per the updated verdict. The `harness` column and `agent_runtime_state` table are added in H3.

2. **External tracker integration (spec H10)**: deferred — not in this plan. Will follow as a follow-up plan once core delegation is proven end-to-end. Updated H10 → not in scope here.

3. **Health checks + auto restart (spec H9)**: deferred — not in this plan. Initial deploy assumes manual restart on agent failure; auto-restart is a follow-up.

4. **Type consistency check:** `AgentHarness`, `TaskHandle`, `TaskPrompt`, `TaskResult`, `HarnessEvent` are defined in H1 and used consistently across H2, H2b, H5, H9, H10. `Delegation` is defined in H10 and used in H11. `DeliveryRecord` is defined in H8 and used in H10.

5. **Open spec questions:**
   - "Worktrees persistent vs fresh per task" — resolved: persistent per agent with `git reset --hard origin/main` between tasks (H10 calls `resetWorktree` before each dispatch).
   - "Capability-based agent selection" — unchanged from existing Prime behavior; not modified here.
   - "In-process module vs separate process" — in-process (H11 wires into `index.ts`).
   - "Session forking vs fresh-create" — fresh session per dispatch on OpenCode (H2 creates session inside `dispatch`).

## Phase Completion Definition

This implementation is complete when:

- `cd backend && npm run build` passes clean.
- All `tests/fleet-executor/*.test.ts` non-DB tests pass.
- H3 DB schema migration succeeds against an empty DB.
- A delegation row created against an OpenCode-backed agent runs end-to-end, lands in `fleet.delegation.completed`, and shows `delegations.status = 'completed'`.
- The same flow works against a Pi-backed agent.
- Worktrees are created under `<repoRoot>/worktrees/<agent-id>` and reset to `main` between tasks.
- Scope violations block completion and emit `fleet.delegation.failed`.
