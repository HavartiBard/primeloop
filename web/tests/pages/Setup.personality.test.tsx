import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepPersonality, INITIAL_PROFILE_STATE, profileSubmitPayload } from '../../src/pages/Setup'
import type { ProfileDraft } from '../../src/pages/Setup'

const DEFAULTS: ProfileDraft = {
  name: 'Prime',
  view_mode: 'sections',
  soul: {
    identity: 'shipped identity',
    voice_tone: 'shipped voice',
    decision_style: 'shipped decision',
  },
  operating: {
    default_behaviors: 'shipped behaviors',
    approval_thresholds: 'shipped approval',
  },
  shipped_defaults: {
    identity: 'shipped identity',
    voice_tone: 'shipped voice',
    decision_style: 'shipped decision',
    default_behaviors: 'shipped behaviors',
    approval_thresholds: 'shipped approval',
  },
}

describe('StepPersonality — sections mode', () => {
  it('pre-fills every section with the shipped default', () => {
    render(<StepPersonality profile={DEFAULTS} onChange={vi.fn()} />)
    expect(screen.getByLabelText(/identity/i)).toHaveValue('shipped identity')
    expect(screen.getByLabelText(/voice & tone/i)).toHaveValue('shipped voice')
    expect(screen.getByLabelText(/default behaviors/i)).toHaveValue('shipped behaviors')
  })

  it('does not show Reset link when section matches the default', () => {
    render(<StepPersonality profile={DEFAULTS} onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /reset identity/i })).toBeNull()
  })

  it('shows Reset link only on diverging sections', () => {
    const modified: ProfileDraft = {
      ...DEFAULTS,
      soul: { ...DEFAULTS.soul, identity: 'custom identity' },
    }
    render(<StepPersonality profile={modified} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /reset identity/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reset voice/i })).toBeNull()
  })

  it('Clear all blanks every section', () => {
    const onChange = vi.fn()
    render(<StepPersonality profile={DEFAULTS} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /clear all/i }))
    const arg = onChange.mock.calls[0][0] as ProfileDraft
    expect(arg.soul.identity).toBe('')
    expect(arg.operating.approval_thresholds).toBe('')
  })

  it('Reset all to defaults restores every section', () => {
    const onChange = vi.fn()
    const modified: ProfileDraft = {
      ...DEFAULTS,
      soul: { identity: 'X', voice_tone: 'Y', decision_style: 'Z' },
      operating: { default_behaviors: '', approval_thresholds: '' },
    }
    render(<StepPersonality profile={modified} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /reset all/i }))
    const arg = onChange.mock.calls[0][0] as ProfileDraft
    expect(arg.soul.identity).toBe('shipped identity')
    expect(arg.operating.default_behaviors).toBe('shipped behaviors')
  })
})

describe('StepPersonality — markdown mode toggle', () => {
  it('switches to markdown view and back, preserving content', () => {
    const onChange = vi.fn()
    const { rerender } = render(<StepPersonality profile={DEFAULTS} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /markdown/i }))
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as ProfileDraft
    expect(lastCall.view_mode).toBe('markdown')

    rerender(<StepPersonality profile={lastCall} onChange={onChange} />)
    expect(screen.getByText(/## Identity/)).toBeInTheDocument()
  })
})

describe('profileSubmitPayload', () => {
  it('produces the documented wire format', () => {
    const payload = profileSubmitPayload(DEFAULTS)
    expect(payload).toEqual({
      name: 'Prime',
      soul: {
        identity: 'shipped identity',
        voice_tone: 'shipped voice',
        decision_style: 'shipped decision',
      },
      operating: {
        default_behaviors: 'shipped behaviors',
        approval_thresholds: 'shipped approval',
      },
    })
  })
})
