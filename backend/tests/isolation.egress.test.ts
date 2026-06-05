// T034 — Isolation test: non-allowlisted egress blocked, allowlisted succeeds (FR-019/SC-007).
// Requires running inside the runtime container where iptables owner-match rules
// enforce per-UID default-deny egress. Set ISOLATION_TESTS=1 and AGENT_EGRESS_ALLOWLIST
// to a comma-separated list of allowed hosts.

import { describe, expect, it } from 'vitest'
import dns from 'node:dns/promises'

const RUN_ISOLATION = process.env.ISOLATION_TESTS === '1'

describe.skipIf(!RUN_ISOLATION)('isolation.egress (T034) — requires sandboxed runtime', () => {
  it('DNS resolution fails inside the sandboxed runtime (no DNS)', async () => {
    // In the runtime container netns, /etc/resolv.conf is empty — DNS must fail.
    await expect(dns.lookup('evil.com')).rejects.toThrow()
  })

  it('TCP connect to a non-allowlisted host times out or is refused', async () => {
    // Direct TCP to an arbitrary internet host should be blocked by the iptables owner rule.
    const net = await import('node:net')
    await expect(
      new Promise((_, rej) => {
        const s = net.createConnection({ host: '1.2.3.4', port: 80, timeout: 2000 })
        s.on('error', rej)
        s.on('timeout', () => { s.destroy(); rej(new Error('timeout')) })
      })
    ).rejects.toThrow()
  })

  it('the control-plane proxy endpoint is reachable (allowlisted)', async () => {
    // The proxy is the one outbound route that MUST work.
    const proxyUrl = process.env.CONTROL_PLANE_URL ?? 'http://primeloop-backend:3100'
    const res = await fetch(`${proxyUrl}/health`).catch(() => null)
    // We just need it to respond (not 0 = ECONNREFUSED to a blocked host).
    expect(res).not.toBeNull()
  })
})
