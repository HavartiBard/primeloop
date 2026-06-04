// RuntimeLease implementation (FR-012, FR-013, FR-014)
// Drives on-demand provisioning of durable runtimes and idle reclamation

import { Pool } from 'pg'
import { RuntimeLease, LeaseResult } from './types.js'

export class RuntimeLeaseManager {
  private pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  async acquire(agentId: string): Promise<LeaseResult> {
    // Acquire a runtime for an agent, provisioning on first use
    // Concurrent callers for a still-provisioning agent await the same lease
    const { rows } = await this.pool.query(
      `INSERT INTO runtime_leases (agent_id, status, acquired_at, last_activity_at)
       VALUES ($1, 'provisioning', now(), now())
       ON CONFLICT (agent_id) DO UPDATE 
       SET status = CASE WHEN runtime_leases.status = 'reclaimed' THEN 'provisioning' ELSE runtime_leases.status END,
           last_activity_at = now()
       RETURNING id, agent_id, status, sandbox_id, acquired_at, last_activity_at, released_at`,
      [agentId]
    )
    
    const row = rows[0]
    return {
      leaseId: row.id,
      harness: {} as any  // Placeholder - actual harness creation happens in process-manager
    }
  }

  async touch(leaseId: string): Promise<void> {
    // Reset idle clock on activity
    await this.pool.query(
      `UPDATE runtime_leases SET last_activity_at = now() WHERE id = $1`,
      [leaseId]
    )
  }

  async release(leaseId: string): Promise<void> {
    // Explicit release
    await this.pool.query(
      `UPDATE runtime_leases SET status = 'idle', released_at = now() WHERE id = $1`,
      [leaseId]
    )
  }

  async reclaimIdle(): Promise<string[]> {
    // Sweep: tear down >10min idle, return agentIds
    const { rows } = await this.pool.query(
      `UPDATE runtime_leases 
       SET status = 'reclaimed', released_at = now()
       WHERE status = 'idle' AND last_activity_at < now() - INTERVAL '10 minutes'
       RETURNING agent_id`,
      []
    )
    return rows.map(r => r.agent_id)
  }
}
