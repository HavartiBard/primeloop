import type pg from 'pg'
import { decrypt, encrypt, isEncrypted } from './crypto.js'

export interface Provider {
  id: string
  name: string
  type: string
  base_url: string
  api_key?: string
  model?: string
  timeout_ms?: number
  created_at: string
}

export interface RegistryAgent {
  id: string
  name: string
  type: string
  provider_id?: string
  runtime_family: string
  execution_mode: string
  endpoint?: string
  capabilities: string[]
  host?: string
  container_name?: string
  ssh_user?: string
  config: Record<string, unknown>
  enabled: boolean
  created_at: string
  local_port?: number
  worktree_path?: string
  workspace_root?: string
  system_prompt?: string
  soul?: string
  tier?: string
  role?: string
  state?: string
  persona_file?: string
}

export interface CapabilityProfile {
  id: string
  name: string
  description?: string
  platform_primitives: string[]
  capability_bundles: string[]
  deny_rules: Array<Record<string, unknown>>
  approval_rules: Record<string, unknown>
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CapabilityBundleAdapter {
  id: string
  capability_bundle: string
  provider_adapter_kind: string
  provider_adapter_ref: string
  priority: number
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ToolGrant {
  id: string
  agent_id: string
  delegation_id?: string
  work_item_id?: string
  capability_profile_id?: string
  routing_capability?: string
  granted_primitives: string[]
  granted_capability_bundles: string[]
  selected_provider_adapters: Array<Record<string, unknown>>
  exclusion_reasons: Array<Record<string, unknown>>
  task_scope: Record<string, unknown>
  approval_state: Record<string, unknown>
  environment_context: Record<string, unknown>
  revocation_state: string
  revoked_at?: string
  created_at: string
  updated_at: string
}

export async function listProviders(pool: pg.Pool): Promise<Provider[]> {
  const { rows } = await pool.query('SELECT * FROM providers ORDER BY created_at')
  return rows.map((row) => ({
    ...row,
    api_key: row.api_key ? '••••••••' : undefined,
  }))
}

export async function insertProvider(
  pool: pg.Pool,
  data: Omit<Provider, 'id' | 'created_at'>
): Promise<Provider> {
  const encryptedKey = data.api_key ? encrypt(data.api_key) : null
  const { rows } = await pool.query(
    'INSERT INTO providers (name, type, base_url, api_key, model, timeout_ms) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [data.name, data.type, data.base_url, encryptedKey, data.model ?? null, data.timeout_ms ?? 120000]
  )
  return {
    ...rows[0],
    api_key: rows[0].api_key ? '••••••••' : undefined,
  }
}

export async function updateProvider(
  pool: pg.Pool,
  id: string,
  data: Partial<Omit<Provider, 'id' | 'created_at'>>
): Promise<Provider> {
  const encryptedKey = data.api_key ? encrypt(data.api_key) : undefined
  const { rows } = await pool.query(
    `UPDATE providers SET
      name     = COALESCE($2, name),
      type     = COALESCE($3, type),
      base_url = COALESCE($4, base_url),
      model    = COALESCE($5, model),
      timeout_ms = COALESCE($6, timeout_ms),
      api_key  = CASE WHEN $7::boolean THEN $8 ELSE api_key END
    WHERE id = $1 RETURNING *`,
    [
      id,
      data.name ?? null,
      data.type ?? null,
      data.base_url ?? null,
      data.model ?? null,
      data.timeout_ms ?? null,
      'api_key' in data,
      encryptedKey ?? null,
    ]
  )
  return {
    ...rows[0],
    api_key: rows[0].api_key ? '••••••••' : undefined,
  }
}

export async function deleteProvider(pool: pg.Pool, id: string): Promise<void> {
  await pool.query('DELETE FROM providers WHERE id = $1', [id])
}

export async function getProviderApiKey(pool: pg.Pool, id: string): Promise<string | null> {
  const { rows } = await pool.query('SELECT api_key FROM providers WHERE id = $1', [id])
  if (!rows[0]?.api_key) return null
  return isEncrypted(rows[0].api_key) ? decrypt(rows[0].api_key) : rows[0].api_key
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
    `INSERT INTO agents (
      name, type, provider_id, runtime_family, execution_mode, endpoint, capabilities,
      host, container_name, ssh_user, config, enabled, local_port, worktree_path,
      workspace_root, system_prompt, soul, tier, role, state, persona_file
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21) RETURNING *`,
    [
      data.name,
      data.type,
      data.provider_id ?? null,
      data.runtime_family,
      data.execution_mode,
      data.endpoint ?? null,
      JSON.stringify(data.capabilities ?? []),
      data.host ?? null,
      data.container_name ?? null,
      data.ssh_user ?? null,
      JSON.stringify(data.config ?? {}),
      data.enabled ?? true,
      data.local_port ?? null,
      data.worktree_path ?? null,
      data.workspace_root ?? null,
      data.system_prompt ?? null,
      data.soul ?? null,
      data.tier ?? null,
      data.role ?? null,
      data.state ?? null,
      data.persona_file ?? null,
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
    ['runtime_family', 'runtime_family'],
    ['execution_mode', 'execution_mode'],
    ['endpoint', 'endpoint'],
    ['host', 'host'],
    ['container_name', 'container_name'],
    ['ssh_user', 'ssh_user'],
    ['enabled', 'enabled'],
    ['local_port', 'local_port'],
    ['worktree_path', 'worktree_path'],
    ['workspace_root', 'workspace_root'],
    ['system_prompt', 'system_prompt'],
    ['soul', 'soul'],
    ['tier', 'tier'],
    ['role', 'role'],
    ['state', 'state'],
    ['persona_file', 'persona_file'],
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

  if ('capabilities' in data) {
    vals.push(JSON.stringify(data.capabilities ?? []))
    sets.push(`capabilities = $${vals.length}`)
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

export async function insertCapabilityProfile(
  pool: pg.Pool,
  data: Omit<CapabilityProfile, 'id' | 'created_at' | 'updated_at'>
): Promise<CapabilityProfile> {
  const { rows } = await pool.query(
    `INSERT INTO capability_profiles (
      name, description, platform_primitives, capability_bundles,
      deny_rules, approval_rules, config
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [
      data.name,
      data.description ?? null,
      JSON.stringify(data.platform_primitives ?? []),
      JSON.stringify(data.capability_bundles ?? []),
      JSON.stringify(data.deny_rules ?? []),
      JSON.stringify(data.approval_rules ?? {}),
      JSON.stringify(data.config ?? {}),
    ],
  )
  return rows[0]
}

export async function getCapabilityProfile(pool: pg.Pool, id: string): Promise<CapabilityProfile | null> {
  const { rows } = await pool.query('SELECT * FROM capability_profiles WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function insertCapabilityBundleAdapter(
  pool: pg.Pool,
  data: Omit<CapabilityBundleAdapter, 'id' | 'created_at' | 'updated_at'>
): Promise<CapabilityBundleAdapter> {
  const { rows } = await pool.query(
    `INSERT INTO capability_bundle_adapters (
      capability_bundle, provider_adapter_kind, provider_adapter_ref, priority, config
    )
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [
      data.capability_bundle,
      data.provider_adapter_kind,
      data.provider_adapter_ref,
      data.priority ?? 100,
      JSON.stringify(data.config ?? {}),
    ],
  )
  return rows[0]
}

export async function listCapabilityBundleAdapters(
  pool: pg.Pool,
  capabilityBundle: string,
): Promise<CapabilityBundleAdapter[]> {
  const { rows } = await pool.query(
    `SELECT * FROM capability_bundle_adapters
     WHERE capability_bundle = $1
     ORDER BY priority ASC, created_at ASC`,
    [capabilityBundle],
  )
  return rows
}

export async function insertToolGrant(
  pool: pg.Pool,
  data: Omit<ToolGrant, 'id' | 'created_at' | 'updated_at'>
): Promise<ToolGrant> {
  const { rows } = await pool.query(
    `INSERT INTO tool_grants (
      agent_id, delegation_id, work_item_id, capability_profile_id, routing_capability,
      granted_primitives, granted_capability_bundles, selected_provider_adapters,
      exclusion_reasons, task_scope, approval_state, environment_context,
      revocation_state, revoked_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *`,
    [
      data.agent_id,
      data.delegation_id ?? null,
      data.work_item_id ?? null,
      data.capability_profile_id ?? null,
      data.routing_capability ?? null,
      JSON.stringify(data.granted_primitives ?? []),
      JSON.stringify(data.granted_capability_bundles ?? []),
      JSON.stringify(data.selected_provider_adapters ?? []),
      JSON.stringify(data.exclusion_reasons ?? []),
      JSON.stringify(data.task_scope ?? {}),
      JSON.stringify(data.approval_state ?? {}),
      JSON.stringify(data.environment_context ?? {}),
      data.revocation_state,
      data.revoked_at ?? null,
    ],
  )
  return rows[0]
}

export async function getToolGrant(pool: pg.Pool, id: string): Promise<ToolGrant | null> {
  const { rows } = await pool.query('SELECT * FROM tool_grants WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function upsertLocalCodexProvider(pool: pg.Pool): Promise<void> {
  // Fix any existing codex providers pointing at non-localhost URLs (stale container refs)
  await pool.query(`
    UPDATE providers
    SET base_url = 'ws://localhost:10101'
    WHERE type = 'codex' AND base_url <> 'ws://localhost:10101'
  `)
  // Ensure the local provider record exists
  await pool.query(`
    INSERT INTO providers (name, type, base_url)
    VALUES ('Codex (local)', 'codex', 'ws://localhost:10101')
    ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type, base_url = EXCLUDED.base_url
  `)
}
