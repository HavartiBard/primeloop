import { describe, it, expect, vi, beforeEach } from 'vitest'
import type pg from 'pg'

// hoisted so vi.mock factories can reference them
const mockAnthropicCreate = vi.hoisted(() => vi.fn())
const mockOpenAICreate = vi.hoisted(() => vi.fn())
const mockGetPrimeConfig = vi.hoisted(() => vi.fn())
const mockGetProviderApiKey = vi.hoisted(() => vi.fn())
const mockGetProvider = vi.hoisted(() => vi.fn())
const workspaceMocks = vi.hoisted(() => ({
  loadPrimeWorkspaceTemplates: vi.fn(),
  renderTemplate: vi.fn(),
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockAnthropicCreate },
  })),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: mockOpenAICreate } },
  })),
}))

vi.mock('../../src/prime-agent/config.js', () => ({
  getPrimeConfig: mockGetPrimeConfig,
}))

vi.mock('../../src/registry.js', () => ({
  getProviderApiKey: mockGetProviderApiKey,
}))

vi.mock('../../src/workspace.js', () => ({
  loadPrimeWorkspaceTemplates: workspaceMocks.loadPrimeWorkspaceTemplates,
  renderTemplate: workspaceMocks.renderTemplate,
}))

import { createConfiguredLlmRouter } from '../../src/prime-agent/llm-router.js'
import type { PrimeContext } from '../../src/prime-agent/context.js'

const pool = { query: mockGetProvider } as unknown as pg.Pool

const anthropicProvider = {
  id: 'prov-1', type: 'anthropic', base_url: '', model: 'claude-opus-4-7', api_key: undefined,
}
const openaiProvider = {
  id: 'prov-2', type: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o', api_key: undefined,
}
const llmProvider = {
  id: 'prov-3', type: 'llm', base_url: 'http://litellm:4000', model: 'my-model', api_key: undefined,
}

const validDecision = {
  reasoning: 'nothing to do',
  actions: [{ type: 'no_op', payload: {}, reason: 'quiet fleet' }],
}

const minimalContext: PrimeContext = {
  trigger: {
    type: 'cron.fast',
    payload: { triggered_at: '2026-01-01T00:00:00Z', source: 'cron' },
  },
  fleet: { agents: [], workItems: [], delegations: [] },
  recentEvents: [],
  recentLessons: [],
  threadMessages: [],
}

describe('createConfiguredLlmRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProvider.mockImplementation((sql: string) => {
      if ((sql as string).includes('chief_profiles')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [anthropicProvider] })
    })
    mockGetProviderApiKey.mockResolvedValue('sk-test')
    mockGetPrimeConfig.mockResolvedValue({
      provider_routing: { planning: [{ provider_id: 'prov-1', model: 'claude-opus-4-7' }] },
    })
    workspaceMocks.loadPrimeWorkspaceTemplates.mockResolvedValue({
      effectiveRoot: '/workspace/prime',
      revision: 'abc123',
      templates: {
        primeSoul: 'Soul block.',
        primeProfile: 'You are Prime.',
        standingRules: 'Keep work moving.',
        system: 'SYSTEM {{prime_soul}} {{prime_profile}} {{standing_rules}}',
        request: 'REQUEST {{user_message}}',
        llamacpp: '',
        defaultAgentInstructions: '',
        defaultAgentSoul: '',
        delegationTask: '',
      },
      templatePaths: {},
    })
    workspaceMocks.renderTemplate.mockImplementation((template: string) => template)
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(validDecision) }],
      usage: { input_tokens: 100, output_tokens: 50 },
      model: 'claude-opus-4-7-20251101',
    })
  })

  it('calls Anthropic SDK for anthropic provider and returns validated decision', async () => {
    const router = createConfiguredLlmRouter(pool)
    const decision = await router.decide(minimalContext)
    expect(mockAnthropicCreate).toHaveBeenCalledOnce()
    expect(decision.reasoning).toBe('nothing to do')
    expect(decision.actions).toHaveLength(1)
    expect(decision.provider_used).toBe('anthropic')
    expect(decision.token_count).toBe(150)
  })

  it('calls OpenAI SDK for openai provider', async () => {
    mockGetPrimeConfig.mockResolvedValue({
      provider_routing: { planning: [{ provider_id: 'prov-2', model: 'gpt-4o' }] },
    })
    mockGetProvider.mockImplementation((sql: string) => {
      if ((sql as string).includes('chief_profiles')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [openaiProvider] })
    })
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validDecision) } }],
      usage: { total_tokens: 200 },
      model: 'gpt-4o',
    })
    const router = createConfiguredLlmRouter(pool)
    const decision = await router.decide(minimalContext)
    expect(mockOpenAICreate).toHaveBeenCalledOnce()
    expect(decision.provider_used).toBe('openai')
    expect(decision.token_count).toBe(200)
  })

  it('uses base_url for llm provider type', async () => {
    mockGetPrimeConfig.mockResolvedValue({
      provider_routing: { planning: [{ provider_id: 'prov-3', model: 'my-model' }] },
    })
    mockGetProvider.mockImplementation((sql: string) => {
      if ((sql as string).includes('chief_profiles')) return Promise.resolve({ rows: [] })
      return Promise.resolve({ rows: [llmProvider] })
    })
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validDecision) } }],
      usage: { total_tokens: 80 },
      model: 'my-model',
    })
    const router = createConfiguredLlmRouter(pool)
    await router.decide(minimalContext)
    expect(mockOpenAICreate).toHaveBeenCalledOnce()
  })

  it('falls back to second provider when first throws', async () => {
    mockGetPrimeConfig.mockResolvedValue({
      provider_routing: {
        planning: [
          { provider_id: 'prov-1', model: 'claude-opus-4-7' },
          { provider_id: 'prov-2', model: 'gpt-4o' },
        ],
      },
    })
    mockGetProvider.mockImplementation((sql: string, params?: unknown[]) => {
      if ((sql as string).includes('chief_profiles')) return Promise.resolve({ rows: [] })
      const providerId = params?.[0]
      if (providerId === 'prov-1') return Promise.resolve({ rows: [anthropicProvider] })
      return Promise.resolve({ rows: [openaiProvider] })
    })
    mockGetProviderApiKey.mockResolvedValue('sk-test')
    mockAnthropicCreate.mockRejectedValue(new Error('rate limited'))
    mockOpenAICreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(validDecision) } }],
      usage: { total_tokens: 80 },
      model: 'gpt-4o',
    })
    const router = createConfiguredLlmRouter(pool)
    const decision = await router.decide(minimalContext)
    expect(mockAnthropicCreate).toHaveBeenCalledOnce()
    expect(mockOpenAICreate).toHaveBeenCalledOnce()
    expect(decision.provider_used).toBe('openai')
  })

  it('throws when all providers fail', async () => {
    mockAnthropicCreate.mockRejectedValue(new Error('unavailable'))
    const router = createConfiguredLlmRouter(pool)
    await expect(router.decide(minimalContext)).rejects.toThrow('unavailable')
  })

  it('falls back to routing key when planning key absent', async () => {
    mockGetPrimeConfig.mockResolvedValue({
      provider_routing: { routing: [{ provider_id: 'prov-1', model: 'claude-opus-4-7' }] },
    })
    const router = createConfiguredLlmRouter(pool)
    const decision = await router.decide(minimalContext)
    expect(decision.reasoning).toBe('nothing to do')
  })
})
