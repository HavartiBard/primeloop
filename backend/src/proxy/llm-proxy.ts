// Control-plane LLM proxy (FR-008, FR-020, FR-026)
// Sole holder of raw provider keys; agents/Prime call here with a broker-issued
// scoped token and never receive the raw key.

import { Pool } from 'pg'
import { LlmProxyRequest, LlmProxyResponse } from './types.js'

export class LlmProxy {
  private pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  // Validate the broker-issued provider_proxy_token: active, unexpired, and (if scoped)
  // permitted for this provider.
  async authorize(token: string, provider: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1
         FROM brokered_credentials
        WHERE kind = 'provider_proxy_token'
          AND status = 'active'
          AND secret_ref = $1
          AND (expires_at IS NULL OR expires_at > now())
          AND (scope->>'provider' IS NULL OR scope->>'provider' = $2)
        LIMIT 1`,
      [token, provider]
    )
    return rows.length > 0
  }

  // Forward a provider call with the real key attached server-side. The raw key never
  // returns to the caller. Upstream HTTP forwarding is wired in a later task (T037).
  async forward(token: string, req: LlmProxyRequest): Promise<LlmProxyResponse> {
    if (!(await this.authorize(token, req.provider))) {
      return { success: false, statusCode: 401, error: 'unauthorized' }
    }
    // TODO(T037): resolve the server-side provider key and forward to the upstream
    // provider, streaming the response back. The key MUST NOT appear in the response.
    return { success: false, statusCode: 501, error: 'forward not yet implemented' }
  }
}
