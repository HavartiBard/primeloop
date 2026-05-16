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
