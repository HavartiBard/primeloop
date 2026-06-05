// Egress allowlist enforcement (FR-019, FR-021)
// Per-agent default-deny network egress

import { Pool } from 'pg'
import { ensurePendingApproval } from '../approvals.js'
import { insertRuntimeEvent } from '../runtime.js'
import { RuntimeEventTypes } from '../runtime-event-types.js'
import { EgressGuard } from './types.js'

function hostFromUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.port ? `${url.hostname}:${url.port}` : url.hostname
  } catch {
    return null
  }
}

export class EgressAllowlist implements EgressGuard {
  private pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  async isAllowed(agentId: string, host: string): Promise<boolean> {
    // Default-deny: only hosts in egress_allowlist for the agent are permitted (FR-019).
    const { rows } = await this.pool.query(
      `SELECT 1 FROM egress_allowlist WHERE agent_id = $1 AND host = $2`,
      [agentId, host]
    )
    const allowed = rows.length > 0
    if (!allowed) {
      // Emit an observable event for every denied attempt (FR-021, SC-007).
      await insertRuntimeEvent(this.pool, {
        event_type: RuntimeEventTypes.EGRESS_DENIED,
        actor: 'egress-allowlist',
        payload: { agent_id: agentId, host, reason: 'not_in_allowlist' },
      })
    }
    return allowed
  }

  async list(agentId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT host FROM egress_allowlist WHERE agent_id = $1`,
      [agentId]
    )
    return rows.map(r => r.host)
  }

  async deriveDefaults(agentId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT
         p.base_url AS provider_base_url,
         COALESCE(array_agg(ms.url) FILTER (WHERE ms.url IS NOT NULL), '{}') AS mcp_urls
       FROM agents a
       LEFT JOIN providers p ON p.id = a.provider_id
       LEFT JOIN agent_mcp_assignments ama ON ama.agent_id = a.id
       LEFT JOIN mcp_servers ms ON ms.id = ama.mcp_server_id
       WHERE a.id = $1
       GROUP BY p.base_url`,
      [agentId],
    )

    const row = rows[0] ?? { provider_base_url: null, mcp_urls: [] }
    const providerHost = hostFromUrl(row.provider_base_url)
    const mcpHosts = Array.isArray(row.mcp_urls)
      ? row.mcp_urls.map((url: string) => hostFromUrl(url)).filter(Boolean) as string[]
      : []

    const defaults = Array.from(new Set([...(providerHost ? [providerHost] : []), ...mcpHosts]))
    for (const host of defaults) {
      const source = host === providerHost ? 'capability' : 'mcp_assignment'
      await this.pool.query(
        `INSERT INTO egress_allowlist (agent_id, host, source)
         VALUES ($1, $2, $3)
         ON CONFLICT (agent_id, host) DO NOTHING`,
        [agentId, host, source],
      )
    }
    return defaults
  }

  async requestHost(agentId: string, host: string): Promise<'allowed' | 'pending_approval'> {
    if (await this.isAllowed(agentId, host)) {
      return 'allowed'
    }

    await ensurePendingApproval(this.pool, {
      approval_id: `egress:${agentId}:${host}`,
      run_id: agentId,
      action: `Allow agent ${agentId} network egress to ${host}`,
    })
    return 'pending_approval'
  }
}
