import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type pg from 'pg'

const routeResultMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/fleet-executor/result-router.js', () => ({ routeResult: routeResultMock }))

const appendThreadMessageMock = vi.hoisted(() => vi.fn())
vi.mock('../../src/runtime.js', () => ({ appendThreadMessage: appendThreadMessageMock }))

const execFileMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

const workspaceMocks = vi.hoisted(() => ({
  loadWorkspaceTemplate: vi.fn(),
  renderTemplate: vi.fn(),
}))
vi.mock('../../src/workspace.js', () => ({
  loadWorkspaceTemplate: workspaceMocks.loadWorkspaceTemplate,
  renderTemplate: workspaceMocks.renderTemplate,
}))

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
    workspaceMocks.loadWorkspaceTemplate.mockResolvedValue('Task {{title}} {{description}}')
    workspaceMocks.renderTemplate.mockImplementation((template: string) => template)
    primeQueue = createInMemoryPrimeQueue()
    pool = createPoolMock()

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
      query: vi.fn(async (sql: string) => {
        if (sql.includes(`SELECT * FROM delegations WHERE status = 'queued'`)) {
          return { rows: [pendingDelegation] }
        }
        if (sql.includes(`UPDATE delegations SET status='in_progress'`)) {
          return { rows: [] }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as pg.Pool
    dispatcher = new FleetDispatcher({ pool, primeQueue, getHarness: vi.fn().mockReturnValue(makeHarness()), pollIntervalMs: 50 })
    dispatcher.start()
    await new Promise((r) => setTimeout(r, 100))
    expect(routeResultMock).not.toHaveBeenCalled()
  })

  it('calls routeResult with failed outcome when harness.done rejects', async () => {
    const crashError = new Error('harness crashed')
    const rejectedDone = Promise.reject<TaskResult>(crashError)
    rejectedDone.catch(() => { /* suppress unhandled rejection — caught by dispatcher */ })
    const badHarness: AgentHarness = {
      start: vi.fn().mockResolvedValue(undefined),
      dispatch: vi.fn().mockResolvedValue({
        id: 'h2',
        events: (async function* () {})(),
        done: rejectedDone,
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
    pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes(`SELECT * FROM delegations WHERE status = 'queued'`)) {
          return { rows: [pendingDelegation] }
        }
        if (sql.includes(`UPDATE delegations SET status='in_progress'`)) {
          return { rows: [pendingDelegation] }
        }
        if (sql.includes('UPDATE agents')) return { rows: [], rowCount: 1 }
        if (sql.includes('INSERT INTO runtime_events')) return { rows: [], rowCount: 1 }
        if (sql.includes('SELECT worktree_path FROM agents')) {
          return { rows: [{ worktree_path: '/workspace/agent-1' }] }
        }
        return { rows: [], rowCount: 1 }
      }),
    } as unknown as pg.Pool
    dispatcher = new FleetDispatcher({ pool, primeQueue, getHarness: vi.fn().mockReturnValue(harnessWithChanges), pollIntervalMs: 50 })
    dispatcher.start()
    await new Promise((r) => setTimeout(r, 100))
    expect(routeResultMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ success: false, error: expect.stringContaining('scope violation') }),
    )
  })

  it('marks the target agent busy before dispatching the task', async () => {
    routeResultMock.mockResolvedValue(undefined)
    dispatcher.start()
    await new Promise((r) => setTimeout(r, 100))
    expect((pool.query as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agents'),
      ['agent-1', 'busy'],
    )
  })

  it('requests an on-demand harness when lazy provisioned work is routed', async () => {
    const ensureHarness = vi.fn().mockResolvedValue(makeHarness())
    dispatcher = new FleetDispatcher({
      pool,
      primeQueue,
      getHarness: vi.fn().mockReturnValue(undefined),
      ensureHarness,
      pollIntervalMs: 50,
    })

    routeResultMock.mockResolvedValue(undefined)
    dispatcher.start()
    await new Promise((r) => setTimeout(r, 100))

    expect(ensureHarness).toHaveBeenCalledWith('agent-1')
    expect(routeResultMock).toHaveBeenCalledWith(
      expect.objectContaining({ pool }),
      expect.objectContaining({ id: 'del-1' }),
      expect.objectContaining({ success: true }),
    )
  })
})

function createPoolMock(): pg.Pool {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes(`SELECT * FROM delegations WHERE status = 'queued'`)) {
        return { rows: [pendingDelegation] }
      }
      if (sql.includes(`UPDATE delegations SET status='in_progress'`)) {
        return { rows: [pendingDelegation] }
      }
      if (sql.includes('UPDATE agents')) return { rows: [], rowCount: 1 }
      if (sql.includes('INSERT INTO runtime_events')) return { rows: [], rowCount: 1 }
      return { rows: [], rowCount: 1 }
    }),
  } as unknown as pg.Pool
}
