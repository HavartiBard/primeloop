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
        `SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM runtime_events WHERE session_id::text = $1`,
        [sessionId]
      )
      const seq = Number(rows[0].next_seq)
      const created_at = new Date().toISOString()
      await client.query(
        `INSERT INTO runtime_events (session_id, seq, event_type, actor, payload, created_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
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

  private timelineSql(whereClause = '', orderClause = 'ORDER BY seq ASC') {
    return `WITH merged AS (
      SELECT
        re.session_id::text AS session_id,
        re.created_at,
        0 AS source_order,
        COALESCE(re.seq, 0) AS native_seq,
        re.id::text AS stable_id,
        re.event_type,
        re.actor,
        re.payload
      FROM runtime_events re
      WHERE re.session_id::text = $1

      UNION ALL

      SELECT
        tm.thread_id::text AS session_id,
        tm.created_at,
        1 AS source_order,
        NULL::bigint AS native_seq,
        tm.id::text AS stable_id,
        'thread.message' AS event_type,
        tm.sender AS actor,
        jsonb_build_object(
          'message_id', tm.id,
          'role', tm.role,
          'content', tm.content,
          'metadata', tm.metadata
        ) AS payload
      FROM thread_messages tm
      WHERE tm.thread_id::text = $1

      UNION ALL

      SELECT
        d.id::text AS session_id,
        COALESCE((entry->>'at')::timestamptz, d.updated_at, d.created_at) AS created_at,
        2 AS source_order,
        NULL::bigint AS native_seq,
        md5(entry::text) AS stable_id,
        'delegation.trace' AS event_type,
        COALESCE(entry->>'actor_agent_id', 'delegation') AS actor,
        jsonb_build_object(
          'delegation_id', d.id,
          'step', entry->>'step',
          'detail', COALESCE(entry->'detail', '{}'::jsonb),
          'tokens', entry->'tokens',
          'completed_at', entry->'completed_at',
          'at', entry->'at'
        ) AS payload
      FROM delegations d
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d.trace, '[]'::jsonb)) entry
      WHERE d.id::text = $1

      UNION ALL

      SELECT
        cc.owner_id::text AS session_id,
        COALESCE(cc.resumed_at, cc.created_at) AS created_at,
        3 AS source_order,
        NULL::bigint AS native_seq,
        cc.id::text AS stable_id,
        'checkpoint.continuation' AS event_type,
        COALESCE(cc.actor_agent_id::text, 'checkpoint-store') AS actor,
        jsonb_build_object(
          'checkpoint_id', cc.id,
          'owner_type', cc.owner_type,
          'step', cc.step,
          'status', cc.status,
          'context_hash', cc.context_hash,
          'context_snapshot', cc.context_snapshot,
          'continuation', cc.continuation,
          'expires_at', cc.expires_at,
          'resumed_at', cc.resumed_at
        ) AS payload
      FROM checkpoint_continuations cc
      WHERE cc.owner_id::text = $1
    ), numbered AS (
      SELECT
        session_id,
        ROW_NUMBER() OVER (
          ORDER BY
            COALESCE(native_seq, 9223372036854775807) ASC,
            created_at ASC,
            source_order ASC,
            stable_id ASC
        ) AS seq,
        event_type,
        actor,
        payload,
        created_at
      FROM merged
    )
    SELECT session_id, seq, event_type, actor, payload, created_at
    FROM numbered
    ${whereClause}
    ${orderClause}`
  }

  async getSession(sessionId: SessionId): Promise<SessionHeader | null> {
    const headerQuery = await this.pool.query(
      `WITH timeline AS (
         ${this.timelineSql()}
       )
       SELECT MIN(seq) AS first_seq, MAX(seq) AS last_seq FROM timeline`,
      [sessionId]
    )
    const header = headerQuery.rows[0]
    if (!header || header.first_seq == null || header.last_seq == null) return null

    const ownerQuery = await this.pool.query(
      `SELECT
         EXISTS(SELECT 1 FROM delegations WHERE id::text = $1) AS is_delegation,
         EXISTS(SELECT 1 FROM threads WHERE id::text = $1) AS is_thread`,
      [sessionId]
    )
    const owner = ownerQuery.rows[0] ?? {}
    const ownerType: SessionHeader['owner_type'] = owner.is_delegation ? 'delegation' : 'prime_session'

    return {
      session_id: sessionId,
      owner_type: ownerType,
      owner_id: sessionId,
      agent_id: undefined,
      first_seq: Number(header.first_seq),
      last_seq: Number(header.last_seq),
      status: 'active',
    }
  }

  async getEvents(sessionId: SessionId, range?: EventRange): Promise<SessionEvent[]> {
    let sql = this.timelineSql()
    const params: unknown[] = [sessionId]

    if (range?.last != null) {
      params.push(range.last)
      sql = this.timelineSql('', `ORDER BY seq DESC LIMIT $${params.length}`)
      sql = `SELECT * FROM (${sql}) suffix ORDER BY seq ASC`
    } else if (range?.from != null || range?.to != null) {
      const predicates: string[] = []
      if (range.from != null) {
        params.push(range.from)
        predicates.push(`seq >= $${params.length}`)
      }
      if (range.to != null) {
        params.push(range.to)
        predicates.push(`seq <= $${params.length}`)
      }
      sql = this.timelineSql(predicates.length ? `WHERE ${predicates.join(' AND ')}` : '')
    }

    const { rows } = await this.pool.query(sql, params)
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
