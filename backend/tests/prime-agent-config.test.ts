import { describe, expect, it } from 'vitest'
import { convertAssignmentsToModelPreferences, resolveModelRoutes, type PrimeConfig } from '../src/prime-agent/config.js'

describe('Prime onboarding assignment model_preferences translation', () => {
  it('translates onboarding function assignments into Prime runtime model_preferences', () => {
    const preferences = convertAssignmentsToModelPreferences([
      { function_key: 'orchestration', display_name: 'Orchestration', purpose: 'route', required: true, provider_id: 'provider-a', model: 'claude-sonnet-4-6' },
      { function_key: 'planning', display_name: 'Planning', purpose: 'plan', required: true, provider_id: 'provider-b', model: 'gpt-4o' },
      { function_key: 'coding_execution', display_name: 'Coding/Execution', purpose: 'code', required: true, provider_id: 'provider-c', model: 'qwen2.5-coder-14b' },
      { function_key: 'review_validation', display_name: 'Review/Validation', purpose: 'review', required: true, provider_id: 'provider-d', model: 'claude-haiku-3-5' },
      { function_key: 'platform_maintenance', display_name: 'Platform Maintenance', purpose: 'maintain', required: true, provider_id: 'provider-e', model: 'llama3.1-8b' },
    ])

    expect(preferences.routing.primary).toEqual({ provider_id: 'provider-a', model: 'claude-sonnet-4-6' })
    expect(preferences.planning.primary).toEqual({ provider_id: 'provider-b', model: 'gpt-4o' })
    expect(preferences.context.primary).toEqual({ provider_id: 'provider-c', model: 'qwen2.5-coder-14b' })
    expect(preferences.policy.primary).toEqual({ provider_id: 'provider-d', model: 'claude-haiku-3-5' })
    expect(preferences.policy.fallbacks).toEqual([{ provider_id: 'provider-e', model: 'llama3.1-8b' }])
  })

  it('resolveModelRoutes reads new default function keys through model_preferences', () => {
    const config = {
      provider_routing: {},
      model_preferences: {
        routing: { primary: { provider_id: 'provider-a', model: 'claude-sonnet-4-6' }, fallbacks: [] },
      },
    } as PrimeConfig

    expect(resolveModelRoutes(config, 'routing')).toEqual([{ provider_id: 'provider-a', model: 'claude-sonnet-4-6' }])
  })
})
