// Control-plane LLM proxy (FR-008, FR-020, FR-026)
// Sole holder of raw provider keys; agents/Prime call here with a broker-issued
// scoped token and never receive the raw key.

import { Pool } from 'pg'
import { CredentialBroker } from '../credentials/broker.js'
import { LlmProxyRequest, LlmProxyResponse } from './types.js'

export class LlmProxy {
  private broker: CredentialBroker

  constructor(pool: Pool) {
    this.broker = new CredentialBroker(pool)
  }

  // Validate the broker-issued provider_proxy_token via the broker (hash-matched,
  // active, unexpired). Agents/Prime present this token; they never hold the raw key.
  async authorize(token: string, _provider: string): Promise<boolean> {
    const cred = await this.broker.validate(token)
    return cred?.kind === 'provider_proxy_token'
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
