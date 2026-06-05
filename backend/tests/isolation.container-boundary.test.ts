// T065 — Container boundary test: a compromise inside the runtime container cannot
// reach the primary container's secrets or filesystem, nor a sibling agent's token (SC-009).
// Requires running INSIDE the runtime container. Set ISOLATION_TESTS=1.

import { describe, expect, it } from 'vitest'

const RUN_ISOLATION = process.env.ISOLATION_TESTS === '1'

describe.skipIf(!RUN_ISOLATION)('isolation.container-boundary (T065) — requires runtime container', () => {
  it('the primary container filesystem is not mounted here', async () => {
    const { readFile } = await import('node:fs/promises')
    // The primary container's source is at /app inside its own container.
    // From the runtime container this path either does not exist or contains
    // the launcher, not the backend source.
    const content = await readFile('/app/src/crypto.ts', 'utf8').catch(() => null)
    expect(content).toBeNull()
  })

  it('cannot reach the control-plane DB directly (no direct Postgres socket)', async () => {
    // The runtime container has no DATABASE_URL — it cannot query brokered_credentials.
    expect(process.env.DATABASE_URL).toBeUndefined()
  })

  it('cannot read a sibling agent UID env via /proc (UID isolation)', async () => {
    const { readdir } = await import('node:fs/promises')
    // Each agent runs as a distinct UID. Under UID isolation, /proc/<pid>/environ
    // for another agent's PID is unreadable.
    const procs = await readdir('/proc').catch(() => [] as string[])
    const numericPids = procs.filter((p) => /^\d+$/.test(p))

    let foundForeignToken = false
    for (const pid of numericPids.slice(0, 20)) {
      const env = await import('node:fs/promises')
        .then(({ readFile: rf }) => rf(`/proc/${pid}/environ`, 'utf8'))
        .catch(() => '')
      if (env.includes('LLM_PROXY_TOKEN') && !env.includes(process.env.LLM_PROXY_TOKEN ?? '___no_match___')) {
        foundForeignToken = true
        break
      }
    }
    expect(foundForeignToken).toBe(false)
  })
})
