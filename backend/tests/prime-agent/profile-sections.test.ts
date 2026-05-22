import { describe, it, expect } from 'vitest'
import {
  parseProfileSections,
  renderProfileSections,
  SOUL_SECTION_KEYS,
  OPERATING_SECTION_KEYS,
  type ProfileSections,
} from '../../src/prime-agent/profile-sections.js'

describe('parseProfileSections — soul', () => {
  it('parses all three soul sections', () => {
    const md = [
      '# Prime — Soul',
      '',
      '## Identity',
      'I am Prime.',
      '',
      '## Voice & Tone',
      '- Direct.',
      '- Concise.',
      '',
      '## Decision Style',
      'Smallest useful step first.',
      '',
    ].join('\n')

    const parsed = parseProfileSections(md, 'soul')
    expect(parsed.sections.identity).toBe('I am Prime.')
    expect(parsed.sections.voice_tone).toBe('- Direct.\n- Concise.')
    expect(parsed.sections.decision_style).toBe('Smallest useful step first.')
    expect(parsed.unknown).toEqual([])
  })

  it('returns empty string for missing sections', () => {
    const md = '# Prime — Soul\n\n## Identity\nI am Prime.\n'
    const parsed = parseProfileSections(md, 'soul')
    expect(parsed.sections.identity).toBe('I am Prime.')
    expect(parsed.sections.voice_tone).toBe('')
    expect(parsed.sections.decision_style).toBe('')
  })

  it('matches section headings case-insensitively', () => {
    const md = '## identity\nlower\n## VOICE & TONE\nupper'
    const parsed = parseProfileSections(md, 'soul')
    expect(parsed.sections.identity).toBe('lower')
    expect(parsed.sections.voice_tone).toBe('upper')
  })

  it('preserves unknown headings verbatim', () => {
    const md = '## Identity\nI am Prime.\n\n## Custom Section\nCustom body.\n'
    const parsed = parseProfileSections(md, 'soul')
    expect(parsed.sections.identity).toBe('I am Prime.')
    expect(parsed.unknown).toEqual([
      { heading: 'Custom Section', body: 'Custom body.' },
    ])
  })

  it('tolerates CRLF and extra blank lines', () => {
    const md = '## Identity\r\n\r\n\r\nI am Prime.\r\n\r\n## Voice & Tone\r\nBrief.\r\n'
    const parsed = parseProfileSections(md, 'soul')
    expect(parsed.sections.identity).toBe('I am Prime.')
    expect(parsed.sections.voice_tone).toBe('Brief.')
  })
})

describe('parseProfileSections — operating', () => {
  it('parses both operating sections', () => {
    const md = [
      '## Default Behaviors',
      '- I report outcomes.',
      '',
      '## Approval Thresholds',
      '**Always escalate:** destructive ops.',
      '',
    ].join('\n')
    const parsed = parseProfileSections(md, 'operating')
    expect(parsed.sections.default_behaviors).toBe('- I report outcomes.')
    expect(parsed.sections.approval_thresholds).toBe('**Always escalate:** destructive ops.')
  })

  it('ignores soul headings when parsing operating', () => {
    const md = '## Identity\nignored\n\n## Default Behaviors\nkept'
    const parsed = parseProfileSections(md, 'operating')
    expect(parsed.sections.default_behaviors).toBe('kept')
    expect(parsed.unknown).toEqual([{ heading: 'Identity', body: 'ignored' }])
  })
})

describe('renderProfileSections', () => {
  it('renders sections in canonical order', () => {
    const sections: ProfileSections = {
      voice_tone: 'Direct.',
      identity: 'I am Prime.',
      decision_style: 'Small steps.',
    }
    const md = renderProfileSections('soul', { sections, unknown: [] })
    expect(md).toBe(
      '## Identity\nI am Prime.\n\n## Voice & Tone\nDirect.\n\n## Decision Style\nSmall steps.\n'
    )
  })

  it('skips empty sections', () => {
    const sections: ProfileSections = { identity: 'I am Prime.', voice_tone: '', decision_style: '' }
    const md = renderProfileSections('soul', { sections, unknown: [] })
    expect(md).toBe('## Identity\nI am Prime.\n')
  })

  it('appends unknown sections at the end', () => {
    const md = renderProfileSections('soul', {
      sections: { identity: 'core' },
      unknown: [{ heading: 'Custom', body: 'extra' }],
    })
    expect(md).toBe('## Identity\ncore\n\n## Custom\nextra\n')
  })

  it('round-trips parse → render → parse', () => {
    const original = '## Identity\nI am Prime.\n\n## Voice & Tone\nDirect.\n\n## Custom\nExtra.\n'
    const parsed = parseProfileSections(original, 'soul')
    const rendered = renderProfileSections('soul', parsed)
    const reparsed = parseProfileSections(rendered, 'soul')
    expect(reparsed.sections).toEqual(parsed.sections)
    expect(reparsed.unknown).toEqual(parsed.unknown)
  })
})

describe('section key constants', () => {
  it('exposes the soul keys in canonical order', () => {
    expect(SOUL_SECTION_KEYS).toEqual(['identity', 'voice_tone', 'decision_style'])
  })

  it('exposes the operating keys in canonical order', () => {
    expect(OPERATING_SECTION_KEYS).toEqual(['default_behaviors', 'approval_thresholds'])
  })
})
