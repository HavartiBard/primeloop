import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StepPrimeConfigReview } from '../../src/pages/Setup'
import type { WizardState } from '../../src/pages/Setup'

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

const baseProviders = [
  {
    id: 'prov-cloud',
    name: 'cloud-anthropic',
    type: 'anthropic',
    base_url: 'https://api.anthropic.com',
    masked_credential_state: 'present' as const,
    connection_status: 'verified' as const,
    available_models: ['claude-sonnet-4-6'],
    active: true,
  },
]

const baseAssignments = [
  { function_key: 'orchestration', display_name: 'Orchestration', purpose: 'Coordinate', required: true, provider_id: 'prov-cloud', model: 'claude-sonnet-4-6', validation_status: 'valid' as const, warnings: [], is_default_choice: true },
  { function_key: 'planning', display_name: 'Planning', purpose: 'Plan', required: true, provider_id: 'prov-cloud', model: 'claude-sonnet-4-6', validation_status: 'valid' as const, warnings: [], is_default_choice: true },
  { function_key: 'coding_execution', display_name: 'Coding/Execution', purpose: 'Code', required: true, provider_id: 'prov-cloud', model: 'claude-sonnet-4-6', validation_status: 'valid' as const, warnings: [], is_default_choice: true },
  { function_key: 'review_validation', display_name: 'Review/Validation', purpose: 'Review', required: true, provider_id: 'prov-cloud', model: 'claude-sonnet-4-6', validation_status: 'valid' as const, warnings: [], is_default_choice: true },
  { function_key: 'platform_maintenance', display_name: 'Platform Maintenance', purpose: 'Maintain', required: true, provider_id: 'prov-cloud', model: 'claude-sonnet-4-6', validation_status: 'valid' as const, warnings: [], is_default_choice: true },
]

const baseState: WizardState = {
  providers: baseProviders,
  routing: { planning: [], dispatching: [], discussion: [] },
  functionAssignments: baseAssignments,
  profile: { name: 'Prime', view_mode: 'sections' as const, soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } },
  rules: { presets: [], custom: '' },
  costControls: { monthlyTokenBudget: 0 },
  workspace: { mode: 'local' as const, root_path: '../.agent-workspace', remote_url: '', branch: 'main' },
}

describe('StepPrimeConfigReview', () => {
  it('renders with default config values (cron_fast_interval_seconds=300, debounce_window_ms=10000, monthly_token_budget=0)', () => {
    render(<StepPrimeConfigReview state={baseState} onChange={vi.fn()} />)
    
    // Check default cron_fast_interval_seconds
    const cronInput = screen.getByLabelText('Fast cron interval (seconds)')
    expect(cronInput).toHaveValue(300)
    
    // Check default debounce_window_ms
    const debounceInput = screen.getByLabelText('Debounce window (ms)')
    expect(debounceInput).toHaveValue(10000)
    
    // Check default monthly_token_budget
    const budgetInput = screen.getByPlaceholderText('0 (unlimited)')
    expect(budgetInput).toHaveValue(0)
  })

  it('user can edit cron interval field', () => {
    const onChange = vi.fn()
    render(<StepPrimeConfigReview state={baseState} onChange={onChange} />)
    
    const cronInput = screen.getByLabelText('Fast cron interval (seconds)')
    fireEvent.change(cronInput, { target: { value: '60' } })
    
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls[0][0].primeConfigDraft.cron_fast_interval_seconds).toBe(60)
  })

  it('user can edit debounce field', () => {
    const onChange = vi.fn()
    render(<StepPrimeConfigReview state={baseState} onChange={onChange} />)
    
    const debounceInput = screen.getByLabelText('Debounce window (ms)')
    fireEvent.change(debounceInput, { target: { value: '5000' } })
    
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls[0][0].primeConfigDraft.debounce_window_ms).toBe(5000)
  })

  it('shows validation error for negative values', () => {
    const invalidState = {
      ...baseState,
      primeConfigDraft: { enabled: false, cron_fast_interval_seconds: -10, debounce_window_ms: 10000 },
    }
    
    render(<StepPrimeConfigReview state={invalidState} onChange={vi.fn()} />)
    
    // Should show validation error for negative cron_fast_interval_seconds
    const validationErrors = screen.getByText(/Configuration validation errors/)
    expect(validationErrors).toBeInTheDocument()
    
    // Check the inline field error message
    const fieldError = screen.getAllByText(/cron_fast_interval_seconds must be a positive integer/)[0]
    expect(fieldError).toBeInTheDocument()
  })

  it('accepting defaults without changes allows proceeding', () => {
    render(<StepPrimeConfigReview state={baseState} onChange={vi.fn()} />)
    
    // With valid defaults, there should be no validation errors
    const validationErrors = screen.queryByText(/Configuration validation errors/)
    expect(validationErrors).not.toBeInTheDocument()
    
    // Check that cron_fast_interval_seconds is valid (positive integer)
    const cronInput = screen.getByLabelText('Fast cron interval (seconds)')
    expect(cronInput).toHaveValue(300)
    
    // Check that debounce_window_ms is valid (positive integer)
    const debounceInput = screen.getByLabelText('Debounce window (ms)')
    expect(debounceInput).toHaveValue(10000)
  })
})
