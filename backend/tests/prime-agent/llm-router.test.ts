import { describe, expect, it, vi } from 'vitest'
import type pg from 'pg'

const workspaceMocks = vi.hoisted(() => ({
  loadPrimeWorkspaceTemplates: vi.fn(),
  renderTemplate: vi.fn(),
}))

vi.mock('../../src/workspace.js', () => ({
  loadPrimeWorkspaceTemplates: workspaceMocks.loadPrimeWorkspaceTemplates,
  renderTemplate: workspaceMocks.renderTemplate,
}))

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
  threadMessages: [],
}

workspaceMocks.loadPrimeWorkspaceTemplates.mockResolvedValue({
  effectiveRoot: '/workspace/prime',
  revision: 'abc123',
  templates: {
    primeProfile: '## Default Behaviors\n- I report outcomes.',
    primeSoul: '## Identity\nI am Prime, the coordination layer.',
    standingRules: 'Keep work moving.',
    system: '{{prime_soul}}\n\n{{prime_profile}}\n\nReturn JSON with "reasoning" and "actions". Allowed: delegate update_work_item request_approval no_op. {{agents}}',
    request: 'Trigger from {{sender}}: {{user_message}}',
    llamacpp: '',
    defaultAgentInstructions: '',
    defaultAgentSoul: '',
    delegationTask: '',
  },
  templatePaths: {},
})
workspaceMocks.renderTemplate.mockImplementation((template: string, values: Record<string, string>) =>
  template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => values[key] ?? '')
)

describe('prime-agent llm router', () => {
  it('filters invalid action types from otherwise valid decisions', () => {
    const decision = validatePrimeDecision({
      reasoning: 'Route the request.',
      response: 'I will take a look.',
      actions: [
        {
          type: 'publish_pattern',
          payload: {},
          reason: 'not allowed in phase a',
        },
      ],
    })

    expect(decision.actions).toEqual([])
    expect(decision.response).toBe('I will take a look.')
  })

  it('rejects malformed decisions', () => {
    expect(() =>
      validatePrimeDecision({
        reasoning: '',
        actions: 'not-an-array',
      })
    ).toThrow('Prime decision reasoning must be a non-empty string')

    const decision = validatePrimeDecision({
      reasoning: 'Valid reasoning',
      actions: [
        {
          type: 'delegate',
          payload: null,
          reason: 'bad payload',
        },
      ],
    })
    expect(decision.actions).toEqual([])
  })

  it('returns a valid decision from the mock router', async () => {
    const router = createMockLlmRouter({
      reasoning: 'Delegate the work to a capable agent.',
      response: 'I’m delegating that to the right agent now.',
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
      threadMessages: [],
    })

    expect(decision.reasoning).toBe('Delegate the work to a capable agent.')
    expect(decision.response).toBe('I’m delegating that to the right agent now.')
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
        threadMessages: [],
      })
    ).rejects.toThrow('Prime LLM router is not configured in Phase A')
  })

  it('parses mislabeled reasoning and response text into separate fields', () => {
    const decision = validatePrimeDecision({
      reasoning: `The user asked a casual greeting question.

reasoning: The user asked a casual greeting question. No backend action is required.
response: What's up? I'm here and ready for the next task.`,
      actions: [],
    })

    expect(decision.reasoning).toBe('The user asked a casual greeting question. No backend action is required.')
    expect(decision.response).toBe("What's up? I'm here and ready for the next task.")
  })

  it('falls back to reasoning when response is missing on user-facing events', () => {
    const decision = validatePrimeDecision({
      reasoning: 'Internal note about the request.',
      actions: [],
    }, { isUserFacing: true })
    expect(decision.response).toBe('Internal note about the request.')
  })

  it('falls back to reasoning when response is empty string on user-facing events', () => {
    const decision = validatePrimeDecision({
      reasoning: 'Valid reasoning here.',
      response: '',
      actions: [],
    }, { isUserFacing: true })
    expect(decision.response).toBe('Valid reasoning here.')
  })

  it('accepts short response when no substantive actions (conversational)', () => {
    const decision = validatePrimeDecision({
      reasoning: 'Simple greeting — no action needed.',
      response: 'Hi!',
      actions: [],
    }, { isUserFacing: true })
    expect(decision.response).toBe('Hi!')
  })

  it('accepts short response with only no_op actions (conversational)', () => {
    const decision = validatePrimeDecision({
      reasoning: 'Acknowledgment.',
      response: 'Got it.',
      actions: [{ type: 'no_op', payload: {}, reason: 'No action needed' }],
    }, { isUserFacing: true })
    expect(decision.response).toBe('Got it.')
  })

  it('rejects short response when substantive actions exist', () => {
    expect(() =>
      validatePrimeDecision({
        reasoning: 'Internal note about the request.',
        response: 'Ok.',
        actions: [{ type: 'delegate', payload: { title: 'Fix bug' }, reason: 'Need to fix this' }],
      }, { isUserFacing: true })
    ).toThrow('Prime decision response must be at least 10 characters')
  })

  it('rejects response containing internal schema labels on user-facing events', () => {
    expect(() =>
      validatePrimeDecision({
        reasoning: 'Internal note.',
        response: 'reasoning: I think about this. response: Here is the answer to your question.',
        actions: [],
      }, { isUserFacing: true })
    ).toThrow('must not contain internal schema labels')
  })

  it('accepts valid response on user-facing events', () => {
    const decision = validatePrimeDecision({
      reasoning: 'Internal note about the request.',
      response: "I've looked into this and here's what I found for you.",
      actions: [],
    }, { isUserFacing: true })

    expect(decision.reasoning).toBe('Internal note about the request.')
    expect(decision.response).toBe("I've looked into this and here's what I found for you.")
  })

  it('does not enforce response on non-user-facing events', () => {
    const decision = validatePrimeDecision({
      reasoning: 'Cron check complete. No action needed.',
      actions: [],
    }, { isUserFacing: false })

    expect(decision.reasoning).toBe('Cron check complete. No action needed.')
    // response falls back to reasoning when not explicitly provided
    expect(decision.response).toBe('Cron check complete. No action needed.')
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

  it('system prompt includes both soul and operating profile blocks', async () => {
    const prompt = await buildPrimeSystemPrompt(minimalContext, mockPool)
    expect(prompt).toContain('## Identity')
    expect(prompt).toContain('## Default Behaviors')
    expect(prompt.indexOf('## Identity')).toBeLessThan(prompt.indexOf('## Default Behaviors'))
  })

  // spec 001 (US1/US3): empty fleet renders an explicit, actionable instruction, not "- none"
  it('renders an explicit empty-fleet instruction when no agents are available', async () => {
    const emptyFleetContext: PrimeContext = {
      ...minimalContext,
      fleet: { agents: [], workItems: [], delegations: [] },
    }
    const prompt = await buildPrimeSystemPrompt(emptyFleetContext, mockPool)
    expect(prompt).toContain('NO AGENTS AVAILABLE')
    // It must steer the LLM away from emitting a delegate it cannot route.
    expect(prompt).toMatch(/Do NOT emit a delegate/i)
    expect(prompt).toMatch(/respond directly/i)
    // And it must not fall back to the generic empty-list placeholder for agents.
    expect(prompt).not.toContain('- none')
  })
})

describe('buildPrimeTriggerMessage', () => {
  it('includes the event type', async () => {
    const msg = await buildPrimeTriggerMessage(minimalContext, mockPool)
    expect(msg).toContain('cron.fast')
  })

  it('ends with the survey instruction', async () => {
    const msg = await buildPrimeTriggerMessage(minimalContext, mockPool)
    expect(msg).toContain('Survey the fleet')
  })
})
