// SessionStore implementation (FR-001, FR-005, FR-006)
// Read model over runtime_events merged with thread_messages, delegations.trace, checkpoint_continuations

import { Pool } from 'pg'
import { SessionId, SessionEvent, SessionHeader, EventRange } from './types.js'

export class SessionStore {
  private pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  async appendEvent(sessionId: SessionId, e: Omit<SessionEvent, 'seq' | 'created_at'>): Promise<SessionEvent> {
    // Atomic per-session seq: hold a per-session advisory lock for the transaction so
    // the MAX(seq)+1 read and the INSERT cannot interleave (UNIQUE(session_id, seq)).
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), 0)', [sessionId])
      const { rows } = await client.query(
        `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM runtime_events WHERE session_id = $1`,
        [sessionId]
      )
      const seq = Number(rows[0].next_seq)
      const created_at = new Date().toISOString()
      await client.query(
        `INSERT INTO runtime_events (session_id, seq, event_type, actor, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sessionId, seq, e.event_type, e.actor, JSON.stringify(e.payload), created_at]
      )
      await client.query('COMMIT')
      return { ...e, session_id: sessionId, seq, created_at }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async getSession(sessionId: SessionId): Promise<SessionHeader | null> {
    const { rows } = await this.pool.query(
      `SELECT 
        session_id,
        owner_type,
        owner_id,
        agent_id,
        MIN(seq) AS first_seq,
        MAX(seq) AS last_seq,
        MAX(status) AS status
      FROM (
        SELECT 
          session_id,
          'delegation' AS owner_type,
          delegation_id::text AS owner_id,
          NULL::text AS agent_id,
          seq,
          'active' AS status
        FROM runtime_events
        WHERE session_id = $1
        UNION ALL
        SELECT 
          thread_id::text AS session_id,
          'prime_session' AS owner_type,
          thread_id::text AS owner_id,
          NULL::text AS agent_id,
          0 AS seq,
          'active' AS status
        FROM thread_messages
        WHERE thread_id = $1::uuid
      ) combined
      GROUP BY session_id, owner_type, owner_id, agent_id`,
      [sessionId]
    )
    if (rows.length === 0) return null

    const row = rows[0]
    return {
      session_id: row.session_id,
      owner_type: row.owner_type,
      owner_id: row.owner_id,
      agent_id: row.agent_id || undefined,
      first_seq: Number(row.first_seq),
      last_seq: Number(row.last_seq),
      status: row.status
    }
  }

  async getEvents(sessionId: SessionId, range?: EventRange): Promise<SessionEvent[]> {
    // Bounded query - never full-history unless explicitly unbounded
    let sql = `
      SELECT session_id, seq, event_type, actor, payload, created_at
      FROM runtime_events
      WHERE session_id = $1
    `
    const params: any[] = [sessionId]
    let paramIndex = 2

    if (range?.last) {
      // Last N events
      sql += ` ORDER BY seq DESC LIMIT $${paramIndex}`
      params.push(range.last)
    } else if (range?.from !== undefined && range?.to !== undefined) {
      // Range query
      sql += ` AND seq >= $${paramIndex} AND seq <= $${paramIndex + 1}`
      params.push(range.from, range.to)
    } else if (range?.from !== undefined) {
      // From onwards
      sql += ` AND seq >= $${paramIndex}`
      params.push(range.from)
    } else if (range?.to !== undefined) {
      // To backwards
      sql += ` AND seq <= $${paramIndex}`
      params.push(range.to)
    }

    if (!range?.last) {
      sql += ' ORDER BY seq ASC'
    }

    const { rows } = await this.pool.query(sql, params)

    return rows.map(row => ({
      session_id: row.session_id,
      seq: Number(row.seq),
      event_type: row.event_type,
      actor: row.actor,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      created_at: row.created_at.toISOString()
    }))
  }
}
