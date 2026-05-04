import type pg from 'pg'

export interface Provider {
  id: string
  name: string
  type: string
  base_url: string
  api_key?: string
  created_at: string
}

export interface RegistryAgent {
  id: string
  name: string
  type: string
  provider_id?: string
  host?: string
  container_name?: string
  ssh_user?: string
  config: Record<string, unknown>
  enabled: boolean
  created_at: string
}

export async function listProviders(pool: pg.Pool): Promise<Provider[]> {
  const { rows } = await pool.query('SELECT * FROM providers ORDER BY created_at')
  return rows
}

export async function insertProvider(
  pool: pg.Pool,
  data: Omit<Provider, 'id' | 'created_at'>
): Promise<Provider> {
  const { rows } = await pool.query(
    'INSERT INTO providers (name, type, base_url, api_key) VALUES ($1, $2, $3, $4) RETURNING *',
    [data.name, data.type, data.base_url, data.api_key ?? null]
  )
  return rows[0]
}

export async function updateProvider(
  pool: pg.Pool,
  id: string,
  data: Partial<Omit<Provider, 'id' | 'created_at'>>
): Promise<Provider> {
  const { rows } = await pool.query(
    `UPDATE providers SET
      name     = COALESCE($2, name),
      type     = COALESCE($3, type),
      base_url = COALESCE($4, base_url),
      api_key  = CASE WHEN $5::boolean THEN $6 ELSE api_key END
    WHERE id = $1 RETURNING *`,
    [id, data.name ?? null, data.type ?? null, data.base_url ?? null, 'api_key' in data, data.api_key ?? null]
  )
  return rows[0]
}

export async function deleteProvider(pool: pg.Pool, id: string): Promise<void> {
  await pool.query('DELETE FROM providers WHERE id = $1', [id])
}

export async function listAgents(pool: pg.Pool): Promise<RegistryAgent[]> {
  const { rows } = await pool.query('SELECT * FROM agents ORDER BY created_at')
  return rows
}

export async function getAgent(pool: pg.Pool, id: string): Promise<RegistryAgent | null> {
  const { rows } = await pool.query('SELECT * FROM agents WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function insertAgent(
  pool: pg.Pool,
  data: Omit<RegistryAgent, 'id' | 'created_at'>
): Promise<RegistryAgent> {
  const { rows } = await pool.query(
    `INSERT INTO agents (name, type, provider_id, host, container_name, ssh_user, config, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      data.name,
      data.type,
      data.provider_id ?? null,
      data.host ?? null,
      data.container_name ?? null,
      data.ssh_user ?? null,
      JSON.stringify(data.config ?? {}),
      data.enabled ?? true,
    ]
  )
  return rows[0]
}

export async function updateAgent(
  pool: pg.Pool,
  id: string,
  data: Partial<Omit<RegistryAgent, 'id' | 'created_at'>>
): Promise<RegistryAgent> {
  const sets: string[] = []
  const vals: unknown[] = [id]

  const scalarFields: Array<[keyof typeof data, string]> = [
    ['name', 'name'],
    ['type', 'type'],
    ['provider_id', 'provider_id'],
    ['host', 'host'],
    ['container_name', 'container_name'],
    ['ssh_user', 'ssh_user'],
    ['enabled', 'enabled'],
  ]

  for (const [key, col] of scalarFields) {
    if (key in data) {
      vals.push(data[key] ?? null)
      sets.push(`${col} = $${vals.length}`)
    }
  }

  if ('config' in data) {
    vals.push(JSON.stringify(data.config))
    sets.push(`config = $${vals.length}`)
  }

  if (sets.length === 0) return getAgent(pool, id) as Promise<RegistryAgent>

  const { rows } = await pool.query(
    `UPDATE agents SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    vals
  )
  return rows[0]
}

export async function deleteAgent(pool: pg.Pool, id: string): Promise<void> {
  await pool.query('DELETE FROM agents WHERE id = $1', [id])
}
