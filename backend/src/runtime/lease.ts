// RuntimeLease implementation (FR-012, FR-013, FR-014)
// Drives on-demand provisioning of durable runtimes and idle reclamation

import cron, { type ScheduledTask } from 'node-cron'
import { Pool, PoolClient } from 'pg'
import type { AgentState } from '../registry.js'
import { insertRuntimeEvent } from '../runtime.js'
import { RuntimeEventTypes } from '../runtime-event-types.js'
import type { LeaseResult, RuntimeLease } from './types.js'

const DEFAULT_RECLAIM_CRON = '*/1 * * * *'

interface RuntimeLeaseSchedulerOptions {
  cadenceCron?: string
  onReclaimed?: (agentId: string) => void | Promise<void>
}

export class RuntimeLeaseManager {
  constructor(private readonly pool: Pool) {}

  async acquire(agentId: string): Promise<LeaseResult> {
    const client = await this.pool.connect()
    let lease: RuntimeLease
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), 1)', [agentId])

      const existing = await this.getLatestLeaseForUpdate(client, agentId)
      if (existing) {
        const { rows } = await client.query<RuntimeLease>(
          `UPDATE runtime_leases
             SET status = 'active',
                 acquired_at = CASE WHEN status = 'reclaimed' THEN now() ELSE acquired_at END,
                 last_activity_at = now(),
                 released_at = NULL
           WHERE id = $1
           RETURNING id, agent_id, status, sandbox_id, acquired_at, last_activity_at, released_at`,
          [existing.id]
        )
        lease = this.normalizeLease(rows[0])
      } else {
        const { rows } = await client.query<RuntimeLease>(
          `INSERT INTO runtime_leases (agent_id, status, acquired_at, last_activity_at)
           VALUES ($1, 'active', now(), now())
           RETURNING id, agent_id, status, sandbox_id, acquired_at, last_activity_at, released_at`,
          [agentId]
        )
        lease = this.normalizeLease(rows[0])
      }

      await this.setAgentState(client, agentId, 'busy')
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }

    await insertRuntimeEvent(this.pool, {
      event_type: RuntimeEventTypes.RUNTIME_LEASED,
      actor: 'runtime-lease',
      payload: { agent_id: agentId, lease_id: lease.id, status: lease.status },
    })

    return {
      leaseId: lease.id,
      harness: null,
      lease,
    }
  }

  async touch(leaseId: string): Promise<void> {
    await this.pool.query(
      `UPDATE runtime_leases SET last_activity_at = now() WHERE id = $1`,
      [leaseId]
    )
  }

  async release(leaseId: string): Promise<void> {
    const { rows } = await this.pool.query<{ agent_id: string }>(
      `UPDATE runtime_leases
          SET status = 'idle',
              last_activity_at = now(),
              released_at = now()
        WHERE id = $1
        RETURNING agent_id`,
      [leaseId]
    )
    const agentId = rows[0]?.agent_id
    if (agentId) {
      await this.pool.query(
        `UPDATE agents
            SET state = 'idle'
          WHERE id = $1
            AND COALESCE(is_prime, false) = false`,
        [agentId]
      )
    }
  }

  async reclaimIdle(): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string; agent_id: string; status: RuntimeLease['status'] }>(
      `WITH reclaimed AS (
         UPDATE runtime_leases
            SET status = 'reclaimed',
                released_at = now()
          WHERE status = 'idle'
            AND last_activity_at < now() - INTERVAL '10 minutes'
          RETURNING id, agent_id, status
       )
       SELECT id, agent_id, status FROM reclaimed`
    )

    if (rows.length === 0) return []

    for (const row of rows) {
      await this.pool.query(
        `UPDATE agents
            SET state = 'idle'
          WHERE id = $1
            AND COALESCE(is_prime, false) = false`,
        [row.agent_id]
      )
      await insertRuntimeEvent(this.pool, {
        event_type: RuntimeEventTypes.RUNTIME_RECLAIMED,
        actor: 'runtime-lease',
        payload: { agent_id: row.agent_id, lease_id: row.id, status: row.status },
      })
    }

    return rows.map((row) => row.agent_id)
  }

  private async getLatestLeaseForUpdate(client: PoolClient, agentId: string): Promise<RuntimeLease | null> {
    const { rows } = await client.query<RuntimeLease>(
      `SELECT id, agent_id, status, sandbox_id, acquired_at, last_activity_at, released_at
         FROM runtime_leases
        WHERE agent_id = $1
        ORDER BY acquired_at DESC, last_activity_at DESC
        LIMIT 1
        FOR UPDATE`,
      [agentId]
    )
    return rows[0] ? this.normalizeLease(rows[0]) : null
  }

  private async setAgentState(client: PoolClient, agentId: string, state: AgentState): Promise<void> {
    await client.query(
      `UPDATE agents
          SET state = $2
        WHERE id = $1
          AND COALESCE(is_prime, false) = false`,
      [agentId, state]
    )
  }

  private normalizeLease(row: RuntimeLease): RuntimeLease {
    return {
      ...row,
      acquired_at: this.toIsoString(row.acquired_at),
      last_activity_at: this.toIsoString(row.last_activity_at),
      released_at: row.released_at ? this.toIsoString(row.released_at) : undefined,
      sandbox_id: row.sandbox_id ?? undefined,
    }
  }

  private toIsoString(value: string | Date): string {
    return value instanceof Date ? value.toISOString() : String(value)
  }
}

export function startRuntimeLeaseReclaimScheduler(
  pool: Pool,
  options: RuntimeLeaseSchedulerOptions = {},
): ScheduledTask | null {
  const cadenceCron = options.cadenceCron ?? DEFAULT_RECLAIM_CRON
  if (!cron.validate(cadenceCron)) return null

  const manager = new RuntimeLeaseManager(pool)
  return cron.schedule(cadenceCron, async () => {
    try {
      const reclaimed = await manager.reclaimIdle()
      if (options.onReclaimed) {
        for (const agentId of reclaimed) {
          await options.onReclaimed(agentId)
        }
      }
    } catch (error) {
      console.error('[runtime-lease] reclaim sweep failed', error)
    }
  })
}
