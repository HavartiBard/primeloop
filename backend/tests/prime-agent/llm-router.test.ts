import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import {
  buildPrimeSystemPrompt,
  buildPrimeTriggerMessage,
  createMockLlmRouter,
  createUnavailableLlmRouter,
  validatePrimeDecision,
} from '../../src/prime-agent/llm-router.js'
import type { PrimeContext } from '../../src/prime-agent/context.js'

const mockPool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as pg.Pool

const minimalContext: PrimeContext = {
  trigger: {
    type: 'cron.fast',
    payload: { triggered_at: '2026-01-01T00:00:00Z', source: 'cron' },
  },
  fleet: {
    agents: [{ id: 'a1', name: 'Coder', capabilities: ['code'], enabled: true } as never],
    workItems: [],
    delegations: [],
  },
  recentEvents: [],
  recentLessons: [],
}

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
        type: 'prime.message',
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
          type: 'prime.message',
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

describe('buildPrimeSystemPrompt', () => {
  it('includes the agent name and capabilities', async () => {
    const prompt = await buildPrimeSystemPrompt(minimalContext, mockPool)
    expect(prompt).toContain('Coder')
    expect(prompt).toContain('code')
  })

  it('includes instruction to return JSON with reasoning and actions', async () => {
    const prompt = await buildPrimeSystemPrompt(minimalContext, mockPool)
    expect(prompt).toContain('"reasoning"')
    expect(prompt).toContain('"actions"')
  })

  it('mentions all four allowed action types', async () => {
    const prompt = await buildPrimeSystemPrompt(minimalContext, mockPool)
    expect(prompt).toContain('delegate')
    expect(prompt).toContain('update_work_item')
    expect(prompt).toContain('request_approval')
    expect(prompt).toContain('no_op')
  })
})

describe('buildPrimeTriggerMessage', () => {
  it('includes the event type', () => {
    const msg = buildPrimeTriggerMessage(minimalContext)
    expect(msg).toContain('cron.fast')
  })

  it('ends with the survey instruction', () => {
    const msg = buildPrimeTriggerMessage(minimalContext)
    expect(msg).toContain('Survey the fleet')
  })
})
