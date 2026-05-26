import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepPlugins } from '../../src/pages/Setup'

// ─── Mock the API module ───────────────────────────────────────────────────────

vi.mock('../../src/api', () => ({
  createProvider: vi.fn(),
  fetchModelCapability: vi.fn(),
  fetchProviders: vi.fn(),
  fetchSetupPlugins: vi.fn(),
  fetchSetupProviderModels: vi.fn(),
  getApiOrigin: vi.fn(() => ''),
  pollCodexDeviceAuth: vi.fn(),
  readResponseBody: vi.fn(),
  saveSetupDraft: vi.fn(),
  startCodexDeviceAuth: vi.fn(),
}))

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const MOCK_PLUGINS = [
  {
    id: 'context-mode',
    name: 'context-mode',
    description: 'Large-output processing and searchable context support',
    optional: true,
    status: 'available' as const,
  },
  {
    id: 'spec-kit',
    name: 'Spec Kit',
    description: 'Schema and specification validation toolkit',
    optional: true,
    status: 'available' as const,
  },
]

const MOCK_PLUGIN_CHOICES: Array<{
  plugin_id: string
  name: string
  description: string
  selected: boolean
  configuration_state: 'not_required' | 'deferred_post_launch' | 'configured' | 'unavailable'
}> = []

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('StepPlugins', () => {
  it('renders available plugins with select buttons', async () => {
    const { fetchSetupPlugins } = await import('../../src/api')
    vi.mocked(fetchSetupPlugins).mockResolvedValue(MOCK_PLUGINS)

    render(<StepPlugins pluginChoices={MOCK_PLUGIN_CHOICES} onChange={vi.fn()} />)

    // Wait for plugins to load
    await screen.findByText(/select optional pi plugins/i)
    
    // Check for plugin names and descriptions
    expect(await screen.findByText('context-mode')).toBeInTheDocument()
    expect(screen.getByText('Large-output processing and searchable context support')).toBeInTheDocument()
    expect(screen.getByText('Spec Kit')).toBeInTheDocument()
    expect(screen.getByText('Schema and specification validation toolkit')).toBeInTheDocument()

    // Check that Select buttons exist for each plugin
    const selectButtons = screen.getAllByRole('button', { name: /select/i })
    expect(selectButtons).toHaveLength(2)
  })

  it('renders empty state when no plugins available', async () => {
    const { fetchSetupPlugins } = await import('../../src/api')
    vi.mocked(fetchSetupPlugins).mockResolvedValue([])

    render(<StepPlugins pluginChoices={MOCK_PLUGIN_CHOICES} onChange={vi.fn()} />)

    // Wait for plugins to load
    await screen.findByText(/select optional pi plugins/i)
    
    expect(await screen.findByText(/no plugins available/i)).toBeInTheDocument()
  })

  it('selecting a plugin updates state', async () => {
    const { fetchSetupPlugins } = await import('../../src/api')
    vi.mocked(fetchSetupPlugins).mockResolvedValue(MOCK_PLUGINS)

    const onChange = vi.fn()
    render(<StepPlugins pluginChoices={MOCK_PLUGIN_CHOICES} onChange={onChange} />)

    // Wait for plugins to load
    await screen.findByText(/select optional pi plugins/i)
    
    // Click first Select button
    const selectButtons = await screen.findAllByRole('button', { name: /select/i })
    fireEvent.click(selectButtons[0])

    expect(onChange).toHaveBeenCalled()
    const args = onChange.mock.calls[0][0]
    expect(args.plugin_choices).toHaveLength(1)
    expect(args.plugin_choices[0].plugin_id).toBe('context-mode')
    expect(args.plugin_choices[0].selected).toBe(true)
  })

  it('skipping a plugin updates state', async () => {
    const { fetchSetupPlugins } = await import('../../src/api')
    vi.mocked(fetchSetupPlugins).mockResolvedValue(MOCK_PLUGINS)

    const onChange = vi.fn()
    
    // Pre-populate with one selected plugin
    const initialChoices = [
      {
        plugin_id: 'context-mode',
        name: 'context-mode',
        description: 'Large-output processing and searchable context support',
        selected: true,
        configuration_state: 'deferred_post_launch' as const,
      },
    ]

    render(<StepPlugins pluginChoices={initialChoices} onChange={onChange} />)

    // Wait for plugins to load
    await screen.findByText(/select optional pi plugins/i)
    
    // Click Skip button for context-mode
    const skipButton = await screen.findByRole('button', { name: /skip/i })
    fireEvent.click(skipButton)

    expect(onChange).toHaveBeenCalled()
    const args = onChange.mock.calls[0][0]
    expect(args.plugin_choices).toHaveLength(1)
    expect(args.plugin_choices[0].plugin_id).toBe('context-mode')
    expect(args.plugin_choices[0].selected).toBe(false)
  })

  it('shows post-launch configuration message for selected plugins', async () => {
    const { fetchSetupPlugins } = await import('../../src/api')
    vi.mocked(fetchSetupPlugins).mockResolvedValue(MOCK_PLUGINS)

    let pluginChoices = [...MOCK_PLUGIN_CHOICES]
    const onChange = vi.fn((update) => {
      pluginChoices = update.plugin_choices
    })
    const { rerender } = render(<StepPlugins pluginChoices={pluginChoices} onChange={onChange} />)

    // Wait for plugins to load
    await screen.findByText(/select optional pi plugins/i)
    
    // Click first Select button
    const selectButtons = await screen.findAllByRole('button', { name: /select/i })
    fireEvent.click(selectButtons[0])

    // Verify onChange was called
    expect(onChange).toHaveBeenCalled()
    
    // Get the updated choices from onChange
    const args = onChange.mock.calls[0][0]
    
    // Re-render with updated choices to show the post-launch message
    rerender(<StepPlugins pluginChoices={args.plugin_choices} onChange={onChange} />)

    // Now check for the Skip button and post-launch message
    expect(await screen.findByRole('button', { name: /skip/i })).toBeInTheDocument()
    expect(await screen.findByText(/Post-launch configuration required/i)).toBeInTheDocument()
  })

  it('displays plugin description for each available plugin', async () => {
    const { fetchSetupPlugins } = await import('../../src/api')
    vi.mocked(fetchSetupPlugins).mockResolvedValue(MOCK_PLUGINS)

    render(<StepPlugins pluginChoices={MOCK_PLUGIN_CHOICES} onChange={vi.fn()} />)

    // Wait for plugins to load
    await screen.findByText(/select optional pi plugins/i)
    
    expect(await screen.findByText('Large-output processing and searchable context support')).toBeInTheDocument()
    expect(screen.getByText('Schema and specification validation toolkit')).toBeInTheDocument()
  })
})
