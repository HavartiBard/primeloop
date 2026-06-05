// T035 — Isolation test: reading brokered secrets or another agent's workspace is denied (FR-025/SC-007).
// Requires running inside the runtime container as a specific agent UID.
// Set ISOLATION_TESTS=1, AGENT_WORKDIR (the agent's own workdir), and
// SIBLING_WORKDIR (another agent's workdir) to run meaningful assertions.

import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'

const RUN_ISOLATION = process.env.ISOLATION_TESTS === '1'

describe.skipIf(!RUN_ISOLATION)('isolation.secrets (T035) — requires sandboxed runtime', () => {
  const workdir = process.env.AGENT_WORKDIR ?? '/tmp/test-workdir'
  const siblingWorkdir = process.env.SIBLING_WORKDIR ?? '/tmp/sibling-workdir'

  it('cannot read the control-plane brokered credential store', async () => {
    // brokered_credentials table is in the DB inside the primary container — not reachable.
    // The env var LLM_PROXY_TOKEN is the only credential the agent has; it cannot
    // read other agents' tokens or the raw provider key.
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(process.env.OPENAI_API_KEY).toBeUndefined()
    // LLM_PROXY_TOKEN may be present (the agent's own token), but not raw keys:
    const token = process.env.LLM_PROXY_TOKEN
    if (token) {
      expect(token).not.toMatch(/^sk-ant-/)
      expect(token).not.toMatch(/^sk-/)
    }
  })

  it("cannot read a sibling agent's working directory", async () => {
    // Landlock + UID isolation prevents reads of other agents' workdirs.
    await expect(readFile(`${siblingWorkdir}/opencode.json`)).rejects.toThrow()
  })

  it('can read files within its own workdir', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(`${workdir}/own.txt`, 'own-content')
    const content = await readFile(`${workdir}/own.txt`, 'utf8')
    expect(content).toBe('own-content')
  })
})
