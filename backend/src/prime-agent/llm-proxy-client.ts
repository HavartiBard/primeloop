// LLM Proxy Client for Prime Agent
// Routes all LLM calls through the control-plane proxy using broker-issued tokens.
// The raw provider API keys are never exposed to Prime; only the proxy holds them.

import type pg from 'pg'
import { CredentialBroker } from '../credentials/broker.js'

export interface LlmProxyRequest {
  provider: string
  path: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

export interface LlmProxyResponse {
  success: boolean
  statusCode: number
  headers?: Record<string, string>
  body?: unknown
  error?: string
}

/**
 * Prime's LLM proxy client that routes calls through the control-plane proxy.
 * Uses a broker-issued provider_proxy_token for authentication.
 */
export class LlmProxyClient {
  private broker: CredentialBroker

  constructor(private readonly pool: pg.Pool, private readonly controlPlaneUrl: string = process.env.CONTROL_PLANE_URL ?? 'http://127.0.0.1:3000') {
    this.broker = new CredentialBroker(pool)
  }

  private async resolvePrimeAgentId(): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id
         FROM agents
        WHERE enabled = true
          AND (
            capabilities @> $1::jsonb
            OR lower(type) = 'prime'
            OR COALESCE(is_prime, false) = true
          )
        ORDER BY
          CASE WHEN capabilities @> $1::jsonb THEN 0 ELSE 1 END,
          created_at ASC
        LIMIT 1`,
      [JSON.stringify(['prime'])]
    )

    if (!rows[0]?.id) {
      throw new Error('no prime agent available for llm proxy token issuance')
    }

    return rows[0].id
  }

  /**
   * Issue a fresh provider_proxy_token for the Prime service.
   * The token is scoped to allow calling the LLM proxy on behalf of Prime.
   */
  async getProxyToken(): Promise<string> {
    const primeAgentId = await this.resolvePrimeAgentId()

    // Brokered credentials only retain a hash, so plaintext cannot be recovered from an
    // existing row. Revoke prior Prime proxy tokens and mint a fresh one for this call.
    await this.broker.revokeAllForAgent(primeAgentId)
    const issued = await this.broker.issueForAgent(primeAgentId, {})
    const proxyCred = issued.find(c => c.kind === 'provider_proxy_token')

    if (!proxyCred) {
      throw new Error('Failed to issue provider_proxy_token for Prime')
    }

    return proxyCred.envVars.LLM_PROXY_TOKEN
  }

  /**
   * Forward an LLM request through the control-plane proxy.
   * The proxy validates the token, retrieves the raw API key from the database,
   * and makes the upstream call. Prime never sees the raw key.
   */
  async forward(request: LlmProxyRequest): Promise<LlmProxyResponse> {
    const token = await this.getProxyToken()
    
    const url = `${this.controlPlaneUrl.replace(/\/+$/, '')}/internal/llm/${request.provider}${request.path.startsWith('/') ? '' : '/'}${request.path}`
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...request.headers,
    }

    // Remove authorization from headers if it was passed in (we use our own token)
    Object.keys(headers).forEach(key => {
      if (key.toLowerCase() === 'authorization') {
        delete headers[key]
      }
    })
    headers['Authorization'] = `Bearer ${token}`

    const response = await fetch(url, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method.toUpperCase()) ? undefined : JSON.stringify(request.body ?? {}),
    })

    let body: unknown
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      body = await response.json()
    } else {
      const buffer = await response.arrayBuffer()
      body = new Uint8Array(buffer)
    }

    return {
      success: response.ok,
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
      error: response.ok ? undefined : `upstream returned ${response.status}`,
    }
  }

  /**
   * Call Anthropic via the LLM proxy.
   */
  async callAnthropic(
    model: string,
    systemPrompt: string,
    userMessage: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const request: LlmProxyRequest = {
      provider: 'anthropic',
      path: '/messages',
      method: 'POST',
      headers: {},
      body: {
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      },
    }

    const response = await this.forward(request)
    
    if (!response.success) {
      throw new Error(`LLM proxy: ${response.error ?? 'unknown error'}`)
    }

    return response.body
  }

  /**
   * Call OpenAI-compatible API via the LLM proxy.
   */
  async callOpenAI(
    model: string,
    systemPrompt: string,
    userMessage: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<unknown> {
    const request: LlmProxyRequest = {
      provider: 'openai',
      path: '/chat/completions',
      method: 'POST',
      headers: {},
      body: {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 8192,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'prime_decision',
            schema: {
              type: 'object',
              properties: {
                reasoning: { type: 'string' },
                response: { type: 'string' },
                actions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', enum: ['delegate', 'update_work_item', 'request_approval', 'update_profile', 'no_op'] },
                      payload: { type: 'object' },
                      reason: { type: 'string' },
                    },
                    required: ['type', 'payload', 'reason'],
                  },
                },
              },
              required: ['reasoning', 'response', 'actions'],
            },
          },
        },
      },
    }

    const response = await this.forward(request)
    
    if (!response.success) {
      throw new Error(`LLM proxy: ${response.error ?? 'unknown error'}`)
    }

    return response.body
  }
}
