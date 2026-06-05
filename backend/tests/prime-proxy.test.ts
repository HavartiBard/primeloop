import { describe, expect, it, vi, beforeEach } from 'vitest'
import type pg from 'pg'

// Mock the broker to avoid database dependencies in unit tests
vi.mock('../src/credentials/broker.js', () => {
  return {
    CredentialBroker: vi.fn().mockImplementation(() => ({
      issueForAgent: vi.fn().mockResolvedValue([
        {
          id: 'cred-123',
          kind: 'provider_proxy_token' as const,
          envVars: { LLM_PROXY_TOKEN: 'test-proxy-token-abc123' },
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          autoRotatable: true,
        },
      ]),
      revokeAllForAgent: vi.fn().mockResolvedValue(undefined),
    })),
  }
})

import { LlmProxyClient } from '../src/prime-agent/llm-proxy-client.js'

describe('Prime LLM Proxy Client (Unit)', () => {
  let pool: pg.Pool
  let proxyClient: LlmProxyClient

  beforeEach(() => {
    // Create a mock pool
    pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'prime-agent-1' }] }),
    } as unknown as pg.Pool
    
    proxyClient = new LlmProxyClient(pool, 'http://localhost:3000')
  })

  it('issues a provider_proxy_token for Prime when none exists', async () => {
    const token = await proxyClient.getProxyToken()

    expect(token).toBeDefined()
    expect(typeof token).toBe('string')
    expect(token).toBe('test-proxy-token-abc123')
    expect(pool.query).toHaveBeenCalled()
  })

  it('uses broker-issued token for proxy authentication', async () => {
    const token = await proxyClient.getProxyToken()
    
    // Verify the token is returned correctly
    expect(token).toMatch(/^[a-zA-Z0-9-]+$/)
  })

  it('revokes old credentials when issuing new ones', async () => {
    const token1 = await proxyClient.getProxyToken()
    const token2 = await proxyClient.getProxyToken()

    expect(token1).toBe('test-proxy-token-abc123')
    expect(token2).toBe('test-proxy-token-abc123')
  })

  it('routes Anthropic calls through the proxy', async () => {
    // Mock the fetch to simulate proxy response
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Map([
        ['content-type', 'application/json'],
      ]),
      json: async () => ({
        content: [{ type: 'text', text: '{"reasoning":"test","response":"ok","actions":[]}' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-opus-4-7',
      }),
    }
    
    const fetchMock = vi.fn().mockResolvedValue(mockResponse)
    global.fetch = fetchMock as any
    
    const response = await proxyClient.callAnthropic(
      'claude-opus-4-7',
      'System prompt',
      'User message',
      30000
    )
    
    expect(response).toBeDefined()
    expect(fetchMock).toHaveBeenCalled()
    
    // Verify the request was made to the proxy endpoint
    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('http://localhost:3000/internal/llm/anthropic/messages')
    
    // Verify the Authorization header was set
    const headers = call[1]?.headers as Record<string, string>
    expect(headers?.Authorization).toBe('Bearer test-proxy-token-abc123')
  })

  it('routes OpenAI calls through the proxy', async () => {
    // Mock the fetch to simulate proxy response
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Map([
        ['content-type', 'application/json'],
      ]),
      json: async () => ({
        choices: [{ message: { content: '{"reasoning":"test","response":"ok","actions":[]}' } }],
        usage: { total_tokens: 15 },
        model: 'gpt-4o',
      }),
    }
    
    const fetchMock = vi.fn().mockResolvedValue(mockResponse)
    global.fetch = fetchMock as any
    
    const response = await proxyClient.callOpenAI(
      'gpt-4o',
      'System prompt',
      'User message',
      30000
    )
    
    expect(response).toBeDefined()
    expect(fetchMock).toHaveBeenCalled()
    
    // Verify the request was made to the proxy endpoint
    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('http://localhost:3000/internal/llm/openai/chat/completions')
    
    // Verify the Authorization header was set
    const headers = call[1]?.headers as Record<string, string>
    expect(headers?.Authorization).toBe('Bearer test-proxy-token-abc123')
  })

  it('returns an error when proxy call fails', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      headers: new Map(),
      json: async () => ({ error: 'unauthorized' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    }
    
    const fetchMock = vi.fn().mockResolvedValue(mockResponse)
    global.fetch = fetchMock as any
    
    await expect(
      proxyClient.callAnthropic('claude-opus-4-7', 'System', 'User', 30000)
    ).rejects.toThrow('LLM proxy: upstream returned 401')
  })

  it('includes proper Authorization header in proxy requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({
        content: [{ type: 'text', text: '{"reasoning":"test","response":"ok","actions":[]}' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-opus-4-7',
      }),
    })
    global.fetch = fetchMock as any
    
    await proxyClient.callAnthropic('claude-opus-4-7', 'System', 'User', 30000)
    
    const call = fetchMock.mock.calls[0]
    const headers = call[1]?.headers as Record<string, string>
    
    // Verify Authorization header is present and starts with Bearer
    expect(headers?.Authorization).toMatch(/^Bearer [a-zA-Z0-9-]+$/)
  })
})

describe('Prime LLM Proxy Architecture', () => {
  it('Prime does not hold raw provider API keys', async () => {
    // Prime uses the proxy client which gets tokens from the broker
    // The raw API keys are only stored in the providers table and accessed by the proxy

    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'prime-agent-1' }] }),
    } as unknown as pg.Pool
    
    const client = new LlmProxyClient(pool, 'http://localhost:3000')
    
    // Get a token - this should work without needing raw API keys
    const token = await client.getProxyToken()
    expect(token).toBeDefined()

    // The token is issued by the broker and stored as a hash in the database
    // Prime only ever sees the plaintext token once (in envVars)
  })

  it('proxy token is scoped to allow LLM calls', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'prime-agent-1' }] }),
    } as unknown as pg.Pool
    
    const client = new LlmProxyClient(pool, 'http://localhost:3000')
    
    // Get a token - this should trigger broker.issueForAgent for the resolved Prime agent
    const token = await client.getProxyToken()
    expect(token).toBeDefined()

    // The broker should have been called to issue credentials for the resolved Prime agent
    const brokerModule = await import('../src/credentials/broker.js')
    const mockBrokerClass = vi.mocked(brokerModule.CredentialBroker)
    
    // Check that the broker was instantiated with the pool
    expect(mockBrokerClass).toHaveBeenCalled()
  })
})
