import type pg from 'pg'

export type PrimeSessionTriggerType = 'event' | 'cron_fast' | 'cron_slow' | 'chief_message'
export type PrimeSessionStatus = 'running' | 'completed' | 'failed' | 'escalated'

export interface PrimeSession {
  id: string
  trigger_type: PrimeSessionTriggerType
  trigger_payload: Record<string, unknown>
  module_name?: string
  workspace_root?: string
  workspace_revision?: string
  prompt_templates: Record<string, string>
  reasoning_summary?: string
  actions_taken: unknown[]
  token_count: number
  provider_used?: string
  model_used?: string
  status: PrimeSessionStatus
  error?: string
  started_at: string
  completed_at?: string
}

export interface StartPrimeSessionInput {
  trigger_type: PrimeSessionTriggerType
  trigger_payload: Record<string, unknown>
  module_name?: string
  workspace_root?: string
  workspace_revision?: string
  prompt_templates?: Record<string, string>
}

export interface CompletePrimeSessionPatch {
  reasoning_summary?: string | null
  actions_taken?: unknown[]
  token_count?: number
  provider_used?: string | null
  model_used?: string | null
  status?: Extract<PrimeSessionStatus, 'completed' | 'escalated'>
}

export async function startPrimeSession(
  pool: pg.Pool,
  input: StartPrimeSessionInput
): Promise<PrimeSession> {
  const { rows } = await pool.query(
    `INSERT INTO prime_agent_sessions (
       trigger_type,
       trigger_payload,
       module_name,
       workspace_root,
       workspace_revision,
       prompt_templates,
       status
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'running')
     RETURNING *`,
    [
      input.trigger_type,
      JSON.stringify(input.trigger_payload),
      input.module_name ?? null,
      input.workspace_root ?? null,
      input.workspace_revision ?? null,
      JSON.stringify(input.prompt_templates ?? {}),
    ]
  )

  return rows[0]
}

export async function completePrimeSession(
  pool: pg.Pool,
  id: string,
  patch: CompletePrimeSessionPatch
): Promise<PrimeSession | null> {
  const values: unknown[] = [id]
  const sets: string[] = []

  const fields: Array<[keyof CompletePrimeSessionPatch, string, (value: unknown) => unknown]> = [
    ['reasoning_summary', 'reasoning_summary', (value) => value ?? null],
    ['actions_taken', 'actions_taken', (value) => JSON.stringify(value ?? [])],
    ['token_count', 'token_count', (value) => value],
    ['provider_used', 'provider_used', (value) => value ?? null],
    ['model_used', 'model_used', (value) => value ?? null],
    ['status', 'status', (value) => value ?? 'completed'],
  ]

  for (const [key, column, encode] of fields) {
    if (key in patch) {
      values.push(encode(patch[key]))
      sets.push(`${column} = $${values.length}`)
    }
  }

  if (!('status' in patch)) {
    values.push('completed')
    sets.push(`status = $${values.length}`)
  }

  const { rows } = await pool.query(
    `UPDATE prime_agent_sessions
     SET ${sets.join(', ')}, completed_at = now()
     WHERE id = $1
     RETURNING *`,
    values
  )

  return rows[0] ?? null
}

export async function failPrimeSession(pool: pg.Pool, id: string, error: string): Promise<PrimeSession | null> {
  const { rows } = await pool.query(
    `UPDATE prime_agent_sessions
     SET status = 'failed', error = $2, completed_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, error]
  )

  return rows[0] ?? null
}

export async function listPrimeSessions(pool: pg.Pool, limit = 50): Promise<PrimeSession[]> {
  const { rows } = await pool.query(
    `SELECT * FROM prime_agent_sessions ORDER BY started_at DESC LIMIT $1`,
    [Math.max(1, Math.min(limit, 500))]
  )

  return rows
}
