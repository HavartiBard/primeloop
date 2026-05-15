import { describe, expect, it } from 'vitest'
import {
  createMockLlmRouter,
  createUnavailableLlmRouter,
  validatePrimeDecision,
} from '../../src/prime-agent/llm-router.js'

describe('prime-agent llm router', () => {
  it('rejects invalid action types', () => {
    expect(() =>
      validatePrimeDecision({
        reasoning: 'Route the request.',
        actions: [
          {
            type: 'publish_pattern',
            payload: {},
            reason: 'not allowed in phase a',
          },
        ],
      })
    ).toThrow('Unsupported Prime action type: publish_pattern')
  })

  it('rejects malformed decisions', () => {
    expect(() =>
      validatePrimeDecision({
        reasoning: '',
        actions: 'not-an-array',
      })
    ).toThrow('Prime decision reasoning must be a non-empty string')

    expect(() =>
      validatePrimeDecision({
        reasoning: 'Valid reasoning',
        actions: [
          {
            type: 'delegate',
            payload: null,
            reason: 'bad payload',
          },
        ],
      })
    ).toThrow('Prime action payload must be an object')
  })

  it('returns a valid decision from the mock router', async () => {
    const router = createMockLlmRouter({
      reasoning: 'Delegate the work to a capable agent.',
      actions: [
        {
          type: 'delegate',
          payload: {
            capability: 'implementation',
            title: 'Implement A5',
          },
          reason: 'This is implementation work.',
        },
        {
          type: 'no_op',
          payload: {},
          reason: 'No second step is needed.',
        },
      ],
      token_count: 123,
      provider_used: 'provider-1',
      model_used: 'mock-model',
    })

    const decision = await router.decide({
      trigger: {
        type: 'chief.message',
        payload: {
          thread_id: 'thread-1',
          message_id: 'message-1',
          content: 'Implement A5',
          sender: 'james',
        },
      },
      fleet: {
        agents: [],
        workItems: [],
        delegations: [],
      },
      recentEvents: [],
      recentLessons: [],
    })

    expect(decision.reasoning).toBe('Delegate the work to a capable agent.')
    expect(decision.actions).toHaveLength(2)
    expect(decision.actions[0]?.type).toBe('delegate')
    expect(decision.token_count).toBe(123)
    expect(decision.provider_used).toBe('provider-1')
    expect(decision.model_used).toBe('mock-model')
  })

  it('returns a clear error from the Phase A placeholder router', async () => {
    const router = createUnavailableLlmRouter()

    await expect(
      router.decide({
        trigger: {
          type: 'chief.message',
          payload: {
            thread_id: 'thread-1',
            message_id: 'message-1',
            content: 'Break routing',
            sender: 'james',
          },
        },
        fleet: { agents: [], workItems: [], delegations: [] },
        recentEvents: [],
        recentLessons: [],
      })
    ).rejects.toThrow('Prime LLM router is not configured in Phase A')
  })
})
