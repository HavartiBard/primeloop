import { describe, it, expect, vi } from 'vitest'
import { dockerLifecycle } from '../src/lifecycle.js'
import type { SshExecFn } from '../src/lifecycle.js'

describe('dockerLifecycle', () => {
  it('calls exec with correct restart command', async () => {
    const exec: SshExecFn = vi.fn().mockResolvedValue({ ok: true, output: '' })
    const result = await dockerLifecycle(exec, 'myhost', 'myuser', 'my-container', 'restart')
    expect(exec).toHaveBeenCalledWith('myhost', 'myuser', 'docker restart my-container')
    expect(result).toEqual({ ok: true, output: '' })
  })

  it('calls exec with correct stop command', async () => {
    const exec: SshExecFn = vi.fn().mockResolvedValue({ ok: true, output: '' })
    await dockerLifecycle(exec, 'host', 'user', 'ctr', 'stop')
    expect(exec).toHaveBeenCalledWith('host', 'user', 'docker stop ctr')
  })

  it('calls exec with correct start command', async () => {
    const exec: SshExecFn = vi.fn().mockResolvedValue({ ok: true, output: '' })
    await dockerLifecycle(exec, 'host', 'user', 'ctr', 'start')
    expect(exec).toHaveBeenCalledWith('host', 'user', 'docker start ctr')
  })

  it('returns failed result when exec fails', async () => {
    const exec: SshExecFn = vi.fn().mockResolvedValue({ ok: false, output: 'connection refused' })
    const result = await dockerLifecycle(exec, 'host', 'user', 'ctr', 'restart')
    expect(result.ok).toBe(false)
    expect(result.output).toBe('connection refused')
  })
})
