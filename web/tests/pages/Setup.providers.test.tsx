import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StepProviders } from '../../src/pages/Setup'
import type { ProviderDisplay } from '../../src/pages/Setup'

// ─── Test fixtures matching contract ───────────────────────────────────────────

const MOCK_PROVIDERS: ProviderDisplay[] = [
  {
    id: 'prov-cloud',
    name: 'cloud-anthropic',
    type: 'anthropic' as const,
    base_url: 'https://api.anthropic.com',
    masked_credential_state: 'present' as const,
    connection_status: 'idle' as const,
    available_models: ['claude-sonnet-4-6'],
    verification_error: undefined,
    active: true,
  },
  {
    id: 'prov-local',
    name: 'local-ollama',
    type: 'ollama' as const,
    base_url: 'http://localhost:11434',
    masked_credential_state: 'not_required' as const,
    connection_status: 'idle' as const,
    available_models: ['qwen3-coder-next'],
    verification_error: undefined,
    active: true,
  },
]

// ─── Mock API helpers ────────────────────────────────────────────────────────

vi.mock('../../src/api', () => ({
  fetchSetupProviderModels: vi.fn(),
}))

const { fetchSetupProviderModels } = await import('../../src/api')

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StepProviders — contract-compliant provider states', () => {
  it('shows idle status badge for unverified providers', () => {
    render(<StepProviders state={{ providers: MOCK_PROVIDERS, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getByText('anthropic')).toBeInTheDocument()
    expect(screen.getByText('ollama')).toBeInTheDocument()
  })

  it('shows verified badge when connection_status is verified', () => {
    const verifiedProviders = MOCK_PROVIDERS.map((p) => ({
      ...p,
      connection_status: 'verified' as const,
    }))
    render(<StepProviders state={{ providers: verifiedProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getAllByText('Verified').length).toBeGreaterThanOrEqual(2)
  })

  it('shows failed badge when connection_status is failed with error copy', () => {
    const failedProviders = MOCK_PROVIDERS.map((p) => ({
      ...p,
      connection_status: 'failed' as const,
      verification_error: 'Connection timeout',
    }))
    render(<StepProviders state={{ providers: failedProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Connection timeout').length).toBeGreaterThanOrEqual(2)
  })

  it('shows skipped badge when connection_status is skipped', () => {
    const skippedProviders = MOCK_PROVIDERS.map((p) => ({
      ...p,
      connection_status: 'skipped' as const,
    }))
    render(<StepProviders state={{ providers: skippedProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getAllByText('Skipped').length).toBeGreaterThanOrEqual(2)
  })

  it('shows unavailable badge when connection_status is unavailable', () => {
    const unavailableProviders = MOCK_PROVIDERS.map((p) => ({
      ...p,
      connection_status: 'unavailable' as const,
    }))
    render(<StepProviders state={{ providers: unavailableProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(2)
  })

  it('shows masked credential state text for existing providers', () => {
    const maskedProviders = MOCK_PROVIDERS.map((p) => ({
      ...p,
      masked_credential_state: 'present' as const,
    }))
    render(<StepProviders state={{ providers: maskedProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getAllByText('Credentials configured').length).toBeGreaterThanOrEqual(2)
  })

  it('shows retry affordance when discovery fails', () => {
    const failedProviders = MOCK_PROVIDERS.map((p) => ({
      ...p,
      connection_status: 'failed' as const,
      verification_error: 'Model discovery failed',
    }))
    render(<StepProviders state={{ providers: failedProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    const retryButtons = screen.getAllByRole('button', { name: /retry/i })
    expect(retryButtons.length).toBeGreaterThanOrEqual(2)
  })

  it('shows skip affordance for failed providers', () => {
    const failedProviders = MOCK_PROVIDERS.map((p) => ({
      ...p,
      connection_status: 'failed' as const,
      verification_error: 'Model discovery failed',
    }))
    render(<StepProviders state={{ providers: failedProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    const skipButtons = screen.getAllByRole('button', { name: /skip/i })
    expect(skipButtons.length).toBeGreaterThanOrEqual(2)
  })

  it('shows loading state during model discovery', async () => {
    vi.mocked(fetchSetupProviderModels).mockResolvedValue({ models: [], error: undefined })

    const localProvider: ProviderDisplay = {
      id: 'prov-local',
      name: 'local-ollama',
      type: 'ollama' as const,
      base_url: 'http://localhost:11434',
      masked_credential_state: 'not_required' as const,
      connection_status: 'verifying' as const,
      available_models: ['qwen3-coder-next'],
      verification_error: undefined,
      active: true,
    }
    render(<StepProviders state={{ providers: [localProvider], routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getByText('Verifying')).toBeInTheDocument()
    expect(screen.getByText('Discovering models…')).toBeInTheDocument()
  })

  it('shows success state when provider is verified', () => {
    const verifiedProviders = MOCK_PROVIDERS.map((p) => ({
      ...p,
      connection_status: 'verified' as const,
      available_models: ['model-1', 'model-2'],
    }))
    render(<StepProviders state={{ providers: verifiedProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getAllByText('Verified').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('2 models found').length).toBeGreaterThanOrEqual(1)
  })
})

describe('StepProviders — empty and recovery states', () => {
  it('shows empty state when no providers are active', () => {
    render(<StepProviders state={{ providers: [], routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getByText('At least one provider must be active')).toBeInTheDocument()
  })

  it('shows recoverable failure guidance with retry and skip options', () => {
    const failedProviders: ProviderDisplay[] = [
      {
        id: 'prov-cloud',
        name: 'cloud-anthropic',
        type: 'anthropic' as const,
        base_url: 'https://api.anthropic.com',
        masked_credential_state: 'present' as const,
        connection_status: 'failed' as const,
        verification_error: 'API key rejected — check credentials',
        available_models: [],
        active: true,
      },
    ]
    render(<StepProviders state={{ providers: failedProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getAllByText('API key rejected — check credentials').length).toBeGreaterThanOrEqual(1)
    const retryButtons = screen.getAllByRole('button', { name: /retry/i })
    const skipButtons = screen.getAllByRole('button', { name: /skip/i })
    expect(retryButtons.length).toBeGreaterThanOrEqual(1)
    expect(skipButtons.length).toBeGreaterThanOrEqual(1)
  })
})

describe('StepProviders — masked credentials and local-only/cloud-only continuation', () => {
  it('does not expose raw API keys in UI', () => {
    const providersWithKeys = MOCK_PROVIDERS.map((p) => ({
      ...p,
      masked_credential_state: 'present' as const,
    }))
    render(<StepProviders state={{ providers: providersWithKeys, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(document.body.textContent).not.toMatch(/sk-[a-zA-Z0-9]+/)
  })

  it('allows local-only continuation when at least one usable provider exists', () => {
    const localOnly: ProviderDisplay[] = [
      {
        id: 'prov-local',
        name: 'local-ollama',
        type: 'ollama' as const,
        base_url: 'http://localhost:11434',
        masked_credential_state: 'not_required' as const,
        connection_status: 'verified' as const,
        available_models: ['qwen3-coder-next'],
        verification_error: undefined,
        active: true,
      },
    ]
    render(<StepProviders state={{ providers: localOnly, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getAllByText('1 models found').length).toBeGreaterThanOrEqual(1)
  })

  it('allows cloud-only continuation when at least one usable provider exists', () => {
    const cloudOnly: ProviderDisplay[] = [
      {
        id: 'prov-cloud',
        name: 'cloud-anthropic',
        type: 'anthropic' as const,
        base_url: 'https://api.anthropic.com',
        masked_credential_state: 'present' as const,
        connection_status: 'verified' as const,
        available_models: ['claude-sonnet-4-6'],
        verification_error: undefined,
        active: true,
      },
    ]
    render(<StepProviders state={{ providers: cloudOnly, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
  })

  it('allows mixed cloud+local continuation when at least one usable provider exists', () => {
    const mixedProviders = MOCK_PROVIDERS.map((p) => ({
      ...p,
      connection_status: 'verified' as const,
      available_models: ['model'],
      masked_credential_state: p.masked_credential_state,
    }))
    render(<StepProviders state={{ providers: mixedProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getAllByText('Verified').length).toBeGreaterThanOrEqual(2)
  })
})

describe('StepProviders — provider setup copy aligned to UI contract', () => {
  it('shows loading copy during verification', () => {
    const verifyingProviders = MOCK_PROVIDERS.map((p) => ({
      ...p,
      connection_status: 'verifying' as const,
    }))
    render(<StepProviders state={{ providers: verifyingProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getAllByText('Verifying').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Discovering models…').length).toBeGreaterThanOrEqual(1)
  })

  it('shows success copy when verified with model count', () => {
    const verifiedProviders = MOCK_PROVIDERS.map((p) => ({
      ...p,
      connection_status: 'verified' as const,
      available_models: ['model-1', 'model-2', 'model-3'],
    }))
    render(<StepProviders state={{ providers: verifiedProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getAllByText('Verified').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('3 models found').length).toBeGreaterThanOrEqual(1)
  })

  it('shows error copy with recoverable guidance on failure', () => {
    const failedProviders = MOCK_PROVIDERS.map((p) => ({
      ...p,
      connection_status: 'failed' as const,
      verification_error: 'Network unreachable — check connectivity',
    }))
    render(<StepProviders state={{ providers: failedProviders, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Network unreachable — check connectivity').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByRole('button', { name: /skip/i }).length).toBeGreaterThanOrEqual(2)
  })

  it('shows masked credential status without exposing secrets', () => {
    const providers = [
      {
        ...MOCK_PROVIDERS[0],
        masked_credential_state: 'present' as const,
      },
      {
        ...MOCK_PROVIDERS[1],
        masked_credential_state: 'not_required' as const,
      },
    ]
    render(<StepProviders state={{ providers, routing: { planning: [], dispatching: [], discussion: [] }, profile: { name: 'Prime', view_mode: 'sections', soul: { identity: '', voice_tone: '', decision_style: '' }, operating: { default_behaviors: '', approval_thresholds: '' }, shipped_defaults: { identity: '', voice_tone: '', decision_style: '', default_behaviors: '', approval_thresholds: '' } }, rules: { presets: [], custom: '' }, costControls: { monthlyTokenBudget: 0 }, workspace: { mode: 'local', root_path: '../.agent-workspace', remote_url: '', branch: 'main' } }} onChange={() => {}} />)
    expect(screen.getByText('Credentials configured')).toBeInTheDocument()
    expect(screen.getByText('No credentials required')).toBeInTheDocument()
  })
})
