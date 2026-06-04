// Proxy types for LLM proxy and egress enforcement (FR-008, FR-019, FR-020, FR-021)

export interface EgressGuard {
  isAllowed(agentId: string, host: string): Promise<boolean>  // default-deny
}

export interface LlmProxyRequest {
  provider: string
  path: string
  method: string
  headers: Record<string, string>
  body: unknown
}

export interface LlmProxyResponse {
  success: boolean
  statusCode: number
  headers?: Record<string, string>
  body?: unknown
  error?: string
}
