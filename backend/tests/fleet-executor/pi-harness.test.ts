import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import type { HarnessEvent, TaskResult } from '../../src/fleet-executor/harness.js'

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

    // consume events concurrently so the generator can run
    void (async () => { for await (const _ of handle.events) {} })()

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
})
