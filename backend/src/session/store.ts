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
    // Header derived from the session's events. A session_id equals either a
    // delegation_id or a thread_id; owner_type follows from which one is present.
    const { rows } = await this.pool.query(
      `SELECT
         session_id,
         MIN(seq) AS first_seq,
         MAX(seq) AS last_seq,
         MAX(delegation_id::text) AS delegation_id,
         MAX(thread_id::text) AS thread_id
       FROM runtime_events
       WHERE session_id = $1
       GROUP BY session_id`,
      [sessionId]
    )
    if (rows.length === 0) return null

    const row = rows[0]
    const ownerType: SessionHeader['owner_type'] = row.delegation_id ? 'delegation' : 'prime_session'
    return {
      session_id: row.session_id,
      owner_type: ownerType,
      owner_id: row.delegation_id ?? row.thread_id ?? row.session_id,
      agent_id: undefined,
      first_seq: Number(row.first_seq),
      last_seq: Number(row.last_seq),
      status: 'active',
    }
  }

  async getEvents(sessionId: SessionId, range?: EventRange): Promise<SessionEvent[]> {
    const params: unknown[] = [sessionId]
    let rows: Array<Record<string, unknown>>

    if (range?.last) {
      // Most-recent N, returned in ascending (replay) order. Bounded by LIMIT.
      params.push(range.last)
      const res = await this.pool.query(
        `SELECT session_id, seq, event_type, actor, payload, created_at
           FROM (
             SELECT session_id, seq, event_type, actor, payload, created_at
               FROM runtime_events
              WHERE session_id = $1
              ORDER BY seq DESC
              LIMIT $2
           ) sub
          ORDER BY seq ASC`,
        params
      )
      rows = res.rows
    } else {
      // Optional inclusive [from, to] slice; bounded by the seq predicates.
      let sql = `SELECT session_id, seq, event_type, actor, payload, created_at
                   FROM runtime_events
                  WHERE session_id = $1`
      if (range?.from !== undefined) {
        params.push(range.from)
        sql += ` AND seq >= $${params.length}`
      }
      if (range?.to !== undefined) {
        params.push(range.to)
        sql += ` AND seq <= $${params.length}`
      }
      sql += ' ORDER BY seq ASC'
      const res = await this.pool.query(sql, params)
      rows = res.rows
    }

    return rows.map((row) => ({
      session_id: row.session_id as string,
      seq: Number(row.seq),
      event_type: row.event_type as string,
      actor: row.actor as string,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload as Record<string, unknown>),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }))
  }
}
