import { describe, it, expect } from 'vitest'
import { buildProfileSynopsis } from '../../src/prime-agent/profile-synopsis.js'

describe('buildProfileSynopsis', () => {
  it('returns the shipped synopsis when every section is at default', () => {
    const synopsis = buildProfileSynopsis({ allDefault: true, divergingSectionTitles: [] })
    expect(synopsis).toContain('direct')
    expect(synopsis).toContain('escalate')
    expect(synopsis).toMatch(/adjust|tweak/i)
  })

  it('names diverging sections when the profile is customized', () => {
    const synopsis = buildProfileSynopsis({
      allDefault: false,
      divergingSectionTitles: ['Voice & Tone', 'Approval Thresholds'],
    })
    expect(synopsis).toContain('Voice & Tone')
    expect(synopsis).toContain('Approval Thresholds')
    expect(synopsis).toMatch(/adjust|tweak/i)
  })
})
