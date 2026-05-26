import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { StepPrimeFunctionAssignments, validateAssignments } from '../../src/pages/Setup'
import type { FunctionAssignment } from '../../src/types'

vi.mock('../../src/api', () => ({
  createProvider: vi.fn(),
  fetchModelCapability: vi.fn(),
  fetchProviders: vi.fn(),
  fetchSetupProviderModels: vi.fn(),
  getApiOrigin: vi.fn(() => ''),
  pollCodexDeviceAuth: vi.fn(),
  readResponseBody: vi.fn(),
  saveSetupDraft: vi.fn(),
  startCodexDeviceAuth: vi.fn(),
}))

const providers = [
  {
    id: 'prov-cloud',
    name: 'cloud-anthropic',
    type: 'anthropic',
    base_url: 'https://api.anthropic.com',
    masked_credential_state: 'present' as const,
    connection_status: 'verified' as const,
    available_models: ['claude-sonnet-4-6', 'phi-3-mini', 'tiny-2b'],
    active: true,
  },
]

const baseAssignments: FunctionAssignment[] = [
  { function_key: 'orchestration', display_name: 'Orchestration', purpose: 'Coordinate', required: true, provider_id: null, model: null, validation_status: 'missing', warnings: [], is_default_choice: true },
  { function_key: 'planning', display_name: 'Planning', purpose: 'Plan', required: true, provider_id: null, model: null, validation_status: 'missing', warnings: [], is_default_choice: true },
  { function_key: 'coding_execution', display_name: 'Coding/Execution', purpose: 'Code', required: true, provider_id: null, model: null, validation_status: 'missing', warnings: [], is_default_choice: true },
  { function_key: 'review_validation', display_name: 'Review/Validation', purpose: 'Review', required: true, provider_id: null, model: null, validation_status: 'missing', warnings: [], is_default_choice: true },
  { function_key: 'platform_maintenance', display_name: 'Platform Maintenance', purpose: 'Maintain', required: true, provider_id: null, model: null, validation_status: 'missing', warnings: [], is_default_choice: true },
]

const state = {
  providers,
  routing: { planning: [], dispatching: [], discussion: [] },
  functionAssignments: baseAssignments,
  launchReadiness: null,
  profile: { name: 'Prime', view_mode: 'sections' as const, soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } },
  rules: { presets: [], custom: '' },
  costControls: { monthlyTokenBudget: 0 },
  workspace: { mode: 'local' as const, root_path: '../.agent-workspace', remote_url: '', branch: 'main' },
}

describe('StepPrimeFunctionAssignments', () => {
  it('renders the assignment matrix with provider and model selectors', () => {
    render(<StepPrimeFunctionAssignments state={state} onChange={vi.fn()} />)
    expect(screen.getByText('Orchestration')).toBeInTheDocument()
    expect(screen.getByLabelText('Orchestration provider')).toBeInTheDocument()
    expect(screen.getByLabelText('Orchestration model')).toBeInTheDocument()
  })

  it('updates assignments from selector changes', () => {
    const onChange = vi.fn()
    render(<StepPrimeFunctionAssignments state={state} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Orchestration provider'), { target: { value: 'prov-cloud' } })
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls[0][0].functionAssignments[0].provider_id).toBe('prov-cloud')
  })

  it('reports warning-tier and blocked model capability states', () => {
    const warned = validateAssignments(baseAssignments.map((assignment) => ({ ...assignment, provider_id: 'prov-cloud', model: 'phi-3-mini' })))
    expect(warned.readiness.ready).toBe(true)
    expect(warned.readiness.warnings?.join(' ')).toContain('recommended 7B')

    const blocked = validateAssignments(baseAssignments.map((assignment) => ({ ...assignment, provider_id: 'prov-cloud', model: 'tiny-2b' })))
    expect(blocked.readiness.ready).toBe(false)
    expect(blocked.readiness.blocking_reasons.join(' ')).toContain('blocked')
  })

  it('allows assignment reuse and marks reuse indicators as warnings', () => {
    const result = validateAssignments(baseAssignments.map((assignment) => ({ ...assignment, provider_id: 'prov-cloud', model: 'claude-sonnet-4-6' })))
    expect(result.readiness.ready).toBe(true)
    expect(result.readiness.warnings?.join(' ')).toContain('Reuses this provider/model')
  })
})
