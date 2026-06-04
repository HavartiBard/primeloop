// Egress allowlist enforcement (FR-019, FR-021)
// Per-agent default-deny network egress

import { Pool } from 'pg'
import { EgressGuard } from './types.js'

export class EgressAllowlist implements EgressGuard {
  private pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  async isAllowed(agentId: string, host: string): Promise<boolean> {
    // Default-deny: only hosts in egress_allowlist for the agent are permitted
    const { rows } = await this.pool.query(
      `SELECT 1 FROM egress_allowlist 
       WHERE agent_id = $1 AND host = $2`,
      [agentId, host]
    )
    return rows.length > 0
  }

  async list(agentId: string): Promise<string[]> {
    const { rows } = await this.pool.query(
      `SELECT host FROM egress_allowlist WHERE agent_id = $1`,
      [agentId]
    )
    return rows.map(r => r.host)
  }

  async deriveDefaults(agentId: string): Promise<string[]> {
    // Derive defaults from capabilities + MCP assignments
    // Placeholder implementation
    return []
  }

  async requestHost(agentId: string, host: string): Promise<'allowed' | 'pending_approval'> {
    // For unknown hosts, route to approval queue
    // Placeholder implementation
    return 'pending_approval'
  }
}
