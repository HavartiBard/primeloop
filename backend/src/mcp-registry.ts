import type pg from 'pg'
import { decrypt, encrypt, isEncrypted } from './crypto.js'

export interface MCPServer {
  id: string
  name: string
  description?: string
  type: 'http' | 'stdio'
  url?: string
  command?: string
  args?: string[]
  env_vars?: Record<string, string>
  created_at: string
}

type StoredEnvVars = Record<string, unknown> | null | undefined

function mapMcpServer(row: Record<string, unknown>): MCPServer {
  return {
    id: String(row['id']),
    name: String(row['name']),
    description: typeof row['description'] === 'string' ? row['description'] : undefined,
    type: row['type'] as MCPServer['type'],
    url: typeof row['url'] === 'string' ? row['url'] : undefined,
    command: typeof row['command'] === 'string' ? row['command'] : undefined,
    args: Array.isArray(row['args']) ? row['args'].map((value) => String(value)) : undefined,
    env_vars: maskEnvVars(row['env_vars'] as StoredEnvVars),
    created_at: String(row['created_at']),
  }
}

export function maskEnvVars(envVars: StoredEnvVars): Record<string, string> | undefined {
  if (!envVars || typeof envVars !== 'object' || Array.isArray(envVars)) return undefined
  return Object.fromEntries(
    Object.keys(envVars).map((key) => [key, '••••••••']),
  )
}

export function encryptEnvVars(envVars: Record<string, unknown> | undefined): Record<string, string> | null {
  if (!envVars) return null
  const entries = Object.entries(envVars)
    .filter(([, value]) => value != null && String(value).trim().length > 0)
    .map(([key, value]) => [key, encrypt(String(value))])
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

export function decryptEnvVars(envVars: StoredEnvVars): Record<string, string> {
  if (!envVars || typeof envVars !== 'object' || Array.isArray(envVars)) return {}
  return Object.fromEntries(
    Object.entries(envVars)
      .filter(([, value]) => value != null)
      .map(([key, value]) => {
        const asString = String(value)
        return [key, isEncrypted(asString) ? decrypt(asString) : asString]
      }),
  )
}

export async function listMcpServers(pool: pg.Pool): Promise<MCPServer[]> {
  const { rows } = await pool.query('SELECT * FROM mcp_servers ORDER BY name')
  return rows.map((row) => mapMcpServer(row))
}

export async function insertMcpServer(
  pool: pg.Pool,
  data: Omit<MCPServer, 'id' | 'created_at'>
): Promise<MCPServer> {
  const envVars = encryptEnvVars(data.env_vars)
  const { rows } = await pool.query(
    `INSERT INTO mcp_servers (name, description, type, url, command, args, env_vars)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.name,
      data.description ?? null,
      data.type,
      data.url ?? null,
      data.command ?? null,
      data.args ?? null,
      envVars ? JSON.stringify(envVars) : null,
    ],
  )
  return mapMcpServer(rows[0])
}

export async function updateMcpServer(
  pool: pg.Pool,
  id: string,
  data: Partial<Omit<MCPServer, 'id' | 'created_at'>>
): Promise<MCPServer> {
  const encryptedEnvVars = 'env_vars' in data ? encryptEnvVars(data.env_vars) : undefined
  const { rows } = await pool.query(
    `UPDATE mcp_servers SET
      name = COALESCE($2, name),
      description = COALESCE($3, description),
      type = COALESCE($4, type),
      url = COALESCE($5, url),
      command = COALESCE($6, command),
      args = COALESCE($7, args),
      env_vars = CASE WHEN $8::boolean THEN $9 ELSE env_vars END
     WHERE id = $1
     RETURNING *`,
    [
      id,
      data.name ?? null,
      data.description ?? null,
      data.type ?? null,
      data.url ?? null,
      data.command ?? null,
      data.args ?? null,
      'env_vars' in data,
      encryptedEnvVars ? JSON.stringify(encryptedEnvVars) : null,
    ],
  )
  return mapMcpServer(rows[0])
}

export async function deleteMcpServer(pool: pg.Pool, id: string): Promise<void> {
  await pool.query('DELETE FROM mcp_servers WHERE id = $1', [id])
}

export async function listAgentMcpAssignments(
  pool: pg.Pool,
  agentIds: string[],
): Promise<Record<string, string[]>> {
  if (agentIds.length === 0) return {}
  const { rows } = await pool.query<{ agent_id: string; mcp_server_id: string }>(
    `SELECT agent_id, mcp_server_id
     FROM agent_mcp_assignments
     WHERE agent_id = ANY($1::uuid[])`,
    [agentIds],
  )

  const assignments: Record<string, string[]> = Object.fromEntries(agentIds.map((id) => [id, []]))
  for (const row of rows) {
    assignments[row.agent_id] ??= []
    assignments[row.agent_id].push(row.mcp_server_id)
  }
  return assignments
}

export async function setAgentMcpAssignments(
  pool: pg.Pool,
  agentId: string,
  mcpServerIds: string[],
): Promise<void> {
  await pool.query('DELETE FROM agent_mcp_assignments WHERE agent_id = $1', [agentId])
  for (const mcpServerId of mcpServerIds) {
    await pool.query(
      `INSERT INTO agent_mcp_assignments (agent_id, mcp_server_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [agentId, mcpServerId],
    )
  }
}
