// Control-plane LLM proxy (FR-008, FR-020, FR-026)
// Sole holder of raw provider keys; agents/Prime call here with a broker-issued
// scoped token and never receive the raw key.

import type pg from 'pg'
import { CredentialBroker } from '../credentials/broker.js'
import { getProviderApiKey } from '../registry.js'
import { insertRuntimeEvent } from '../runtime.js'
import type { LlmProxyRequest, LlmProxyResponse } from './types.js'

type ProviderRow = {
  id: string
  type: string
  base_url: string
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function buildTargetUrl(provider: ProviderRow, path: string): string {
  const base = normalizeBaseUrl(provider.base_url)
  const cleanPath = path.startsWith('/') ? path : `/${path}`

  if (provider.type === 'anthropic') {
    return `${base}/v1${cleanPath}`
  }

  if (provider.type === 'openai' || provider.type === 'codex') {
    return /\/v1$/.test(base) ? `${base}${cleanPath}` : `${base}/v1${cleanPath}`
  }

  return `${base}${cleanPath}`
}

function buildUpstreamHeaders(
  provider: ProviderRow,
  apiKey: string | null,
  requestHeaders: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = {}

  for (const [key, value] of Object.entries(requestHeaders)) {
    const lower = key.toLowerCase()
    if (['host', 'content-length', 'authorization'].includes(lower)) continue
    headers[key] = value
  }

  if (!headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/json'
  }

  if (provider.type === 'anthropic' && apiKey) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = headers['anthropic-version'] ?? '2023-06-01'
  } else if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  return headers
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return await response.json()
  }
  const buffer = await response.arrayBuffer()
  return new Uint8Array(buffer)
}

export class LlmProxy {
  private broker: CredentialBroker

  constructor(private readonly pool: pg.Pool) {
    this.broker = new CredentialBroker(pool)
  }

  private async resolveProvider(providerType: string): Promise<ProviderRow | null> {
    const { rows } = await this.pool.query<ProviderRow>(
      `SELECT id, type, base_url
         FROM providers
        WHERE type = $1
        ORDER BY created_at ASC
        LIMIT 1`,
      [providerType]
    )
    return rows[0] ?? null
  }

  private tokenAllowsProvider(scope: Record<string, unknown> | null | undefined, provider: ProviderRow): boolean {
    const allowedProviderIds = Array.isArray(scope?.['provider_ids']) ? scope?.['provider_ids'] : null
    const allowedProviderTypes = Array.isArray(scope?.['provider_types']) ? scope?.['provider_types'] : null

    if (allowedProviderIds && allowedProviderIds.length > 0) {
      return allowedProviderIds.includes(provider.id)
    }
    if (allowedProviderTypes && allowedProviderTypes.length > 0) {
      return allowedProviderTypes.includes(provider.type)
    }
    return true
  }

  // Validate the broker-issued provider_proxy_token via the broker (hash-matched,
  // active, unexpired). Agents/Prime present this token; they never hold the raw key.
  async authorize(token: string, providerType: string): Promise<{ ok: true; agentId: string; provider: ProviderRow } | { ok: false }> {
    const cred = await this.broker.validate(token)
    if (!cred || cred.kind !== 'provider_proxy_token') {
      return { ok: false }
    }

    const provider = await this.resolveProvider(providerType)
    if (!provider) {
      return { ok: false }
    }

    if (!this.tokenAllowsProvider(cred.scope, provider)) {
      return { ok: false }
    }

    return { ok: true, agentId: cred.agent_id, provider }
  }

  // Forward a provider call with the real key attached server-side. The raw key never
  // returns to the caller.
  async forward(token: string, req: LlmProxyRequest): Promise<LlmProxyResponse> {
    const auth = await this.authorize(token, req.provider)
    if (!auth.ok) {
      await insertRuntimeEvent(this.pool, {
        event_type: 'egress.denied',
        actor: 'llm-proxy',
        payload: { provider: req.provider, path: req.path, reason: 'unauthorized' },
      })
      return { success: false, statusCode: 401, body: { error: 'unauthorized' }, error: 'unauthorized' }
    }

    const apiKey = await getProviderApiKey(this.pool, auth.provider.id)
    if (!apiKey && (auth.provider.type === 'anthropic' || auth.provider.type === 'openai' || auth.provider.type === 'codex')) {
      return { success: false, statusCode: 500, body: { error: 'provider API key not configured' }, error: 'provider API key not configured' }
    }

    const response = await fetch(buildTargetUrl(auth.provider, req.path), {
      method: req.method,
      headers: buildUpstreamHeaders(auth.provider, apiKey, req.headers),
      body: ['GET', 'HEAD'].includes(req.method.toUpperCase()) ? undefined : JSON.stringify(req.body ?? {}),
    })

    const body = await readResponseBody(response)
    await insertRuntimeEvent(this.pool, {
      event_type: 'llm.proxied',
      actor: 'llm-proxy',
      payload: {
        agent_id: auth.agentId,
        provider_id: auth.provider.id,
        provider_type: auth.provider.type,
        method: req.method,
        path: req.path,
        status_code: response.status,
      },
    })

    return {
      success: response.ok,
      statusCode: response.status,
      headers: {
        'content-type': response.headers.get('content-type') ?? 'application/json',
      },
      body,
      error: response.ok ? undefined : `upstream returned ${response.status}`,
    }
  }
}
