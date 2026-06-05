// T033 — Isolation test: write outside the working directory is denied (FR-018/SC-007).
// These tests MUST run from inside a sandboxed agent runtime (Landlock-scoped workdir).
// They are skipped when not in a sandbox environment to avoid false positives on the
// dev host where there is no kernel-level FS restriction.
//
// To run: launch the test image inside the runtime container with ISOLATION_TESTS=1

import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const RUN_ISOLATION = process.env.ISOLATION_TESTS === '1'

describe.skipIf(!RUN_ISOLATION)('isolation.fs (T033) — requires sandboxed runtime', () => {
  const workdir = process.env.AGENT_WORKDIR ?? '/tmp/test-workdir'
  const escapeTarget = path.join(workdir, '..', 'escape.txt')

  it('writing inside the workdir succeeds', async () => {
    await expect(writeFile(path.join(workdir, 'test.txt'), 'ok')).resolves.toBeUndefined()
  })

  it('writing outside the workdir is denied by the kernel (Landlock/mount-ns)', async () => {
    await expect(writeFile(escapeTarget, 'escape')).rejects.toThrow()
  })

  it('reading a path outside the workdir is denied', async () => {
    const { readFile } = await import('node:fs/promises')
    await expect(readFile('/etc/shadow')).rejects.toThrow()
  })
})
