// CredentialBroker implementation (FR-007 – FR-011)
// Issues short-lived, per-agent, scoped credentials. The recoverable value is never
// persisted: only a sha256 of the issued token is stored (secret_ref); the plaintext
// is returned once via env vars and injected into process env only — never to disk.

import type pg from 'pg'
import { createHash, randomBytes } from 'node:crypto'
import { insertRuntimeEvent } from '../runtime.js'
import type { AgentScope, CredentialKind, CredentialRecord, IssuedCredential } from './types.js'

// Durable credentials rotate within this TTL (FR-010); ephemerals are revoked at teardown.
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

const ENV_NAME: Record<CredentialKind, string> = {
  provider_proxy_token: 'LLM_PROXY_TOKEN',
  gitea_token: 'GITEA_TOKEN',
  launcher_token: 'LAUNCHER_TOKEN',
  named_secret: 'NAMED_SECRET',
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function mintToken(): string {
  return randomBytes(32).toString('hex')
}

export class CredentialBroker {
  constructor(private readonly pool: pg.Pool) {}

  async issueForAgent(agentId: string, scope: AgentScope): Promise<IssuedCredential[]> {
    const issued: IssuedCredential[] = []
    // Every agent reaches providers via the control-plane proxy, never the raw key (FR-008).
    issued.push(await this.issue(agentId, {
      kind: 'provider_proxy_token',
      autoRotatable: true,
      scope: {
        provider_ids: scope.providerIds ?? [],
        provider_types: scope.providerTypes ?? [],
      },
    }))

    if (scope.controlPlaneTokenEnvName) {
      issued.push(await this.issue(agentId, {
        kind: 'launcher_token',
        envName: scope.controlPlaneTokenEnvName,
        autoRotatable: true,
      }))
    }

    for (const gitea of scope.giteaTokens ?? []) {
      issued.push(await this.issue(agentId, {
        kind: 'gitea_token',
        envName: gitea.envName,
        autoRotatable: true,
        scope: {
          repos: gitea.repos ?? [],
          capabilities: gitea.capabilities ?? [],
        },
      }))
    }

    // Operator-defined named secrets are injected as-is; they cannot be auto-rotated.
    for (const ns of scope.namedSecrets ?? []) {
      issued.push(
        await this.issue(agentId, { kind: 'named_secret', envName: ns.envName, value: ns.value, autoRotatable: false })
      )
    }
    return issued
  }

  private async issue(
    agentId: string,
    opts: { kind: CredentialKind; envName?: string; value?: string; autoRotatable: boolean; scope?: Record<string, unknown> }
  ): Promise<IssuedCredential> {
    const value = opts.value ?? mintToken()
    const envName = opts.envName ?? ENV_NAME[opts.kind]
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString()
    const scope = { ...(opts.scope ?? {}), envName }
    const { rows } = await this.pool.query(
      `INSERT INTO brokered_credentials (agent_id, kind, scope, secret_ref, status, auto_rotatable, expires_at)
       VALUES ($1, $2, $3::jsonb, $4, 'active', $5, $6)
       RETURNING id, expires_at::text`,
      [agentId, opts.kind, JSON.stringify(scope), hashToken(value), opts.autoRotatable, expiresAt]
    )
    const id = rows[0].id as string
    await this.emit('credential.issued', { agent_id: agentId, credential_id: id, kind: opts.kind })
    return { id, kind: opts.kind, envVars: { [envName]: value }, expiresAt: rows[0].expires_at, autoRotatable: opts.autoRotatable }
  }

  async rotate(credentialId: string): Promise<IssuedCredential> {
    const { rows: cur } = await this.pool.query(
      `SELECT agent_id, kind, scope, auto_rotatable FROM brokered_credentials WHERE id = $1`,
      [credentialId]
    )
    if (cur.length === 0) throw new Error(`credential ${credentialId} not found`)
    if (!cur[0].auto_rotatable) throw new Error(`credential ${credentialId} is not auto-rotatable`)

    const kind = cur[0].kind as CredentialKind
    const envName = (cur[0].scope?.envName as string) ?? ENV_NAME[kind]
    const value = mintToken()
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString()
    const { rows } = await this.pool.query(
      `UPDATE brokered_credentials
          SET secret_ref = $2, status = 'active', rotated_at = now(), expires_at = $3
        WHERE id = $1
      RETURNING expires_at::text`,
      [credentialId, hashToken(value), expiresAt]
    )
    await this.emit('credential.rotated', { agent_id: cur[0].agent_id, credential_id: credentialId, kind })
    return { id: credentialId, kind, envVars: { [envName]: value }, expiresAt: rows[0].expires_at, autoRotatable: true }
  }

  async revoke(credentialId: string): Promise<void> {
    const { rows } = await this.pool.query(
      `UPDATE brokered_credentials SET status = 'revoked', revoked_at = now()
        WHERE id = $1 AND status <> 'revoked'
      RETURNING agent_id, kind`,
      [credentialId]
    )
    if (rows[0]) await this.emit('credential.revoked', { agent_id: rows[0].agent_id, credential_id: credentialId, kind: rows[0].kind })
  }

  async revokeAllForAgent(agentId: string): Promise<void> {
    const { rows } = await this.pool.query(
      `UPDATE brokered_credentials SET status = 'revoked', revoked_at = now()
        WHERE agent_id = $1 AND status <> 'revoked'
      RETURNING id, kind`,
      [agentId]
    )
    for (const r of rows) await this.emit('credential.revoked', { agent_id: agentId, credential_id: r.id, kind: r.kind })
  }

  // Lookup for the proxy/auth path: returns the credential iff active and unexpired.
  async validate(token: string): Promise<CredentialRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT id, agent_id, kind, scope, secret_ref, status, auto_rotatable,
              issued_at::text, expires_at::text, rotated_at::text, revoked_at::text
         FROM brokered_credentials
        WHERE secret_ref = $1 AND status = 'active' AND (expires_at IS NULL OR expires_at > now())
        LIMIT 1`,
      [hashToken(token)]
    )
    return (rows[0] as CredentialRecord) ?? null
  }

  // Rotation/risk sweep (FR-010), run on a schedule. Rotates expired rotatable
  // credentials; flags expired non-rotatable ones as risky rather than tolerating them.
  async sweep(): Promise<{ rotated: string[]; flagged: string[] }> {
    const { rows } = await this.pool.query(
      `SELECT id, auto_rotatable FROM brokered_credentials
        WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()`
    )
    const result = { rotated: [] as string[], flagged: [] as string[] }
    for (const r of rows) {
      if (r.auto_rotatable) {
        await this.rotate(r.id)
        result.rotated.push(r.id)
      } else {
        await this.flagRisky(r.id)
        result.flagged.push(r.id)
      }
    }
    return result
  }

  private async flagRisky(credentialId: string): Promise<void> {
    const { rows } = await this.pool.query(
      `UPDATE brokered_credentials SET status = 'risky' WHERE id = $1 RETURNING agent_id, kind`,
      [credentialId]
    )
    if (rows[0]) {
      await this.emit('credential.risk_flagged', {
        agent_id: rows[0].agent_id,
        credential_id: credentialId,
        kind: rows[0].kind,
        reason: 'expired_and_not_auto_rotatable',
      })
    }
  }

  private async emit(event_type: string, payload: Record<string, unknown>): Promise<void> {
    await insertRuntimeEvent(this.pool, { event_type, actor: 'credential-broker', payload })
  }
}
