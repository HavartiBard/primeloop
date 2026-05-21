import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseProfileSections,
  SOUL_SECTION_KEYS,
  OPERATING_SECTION_KEYS,
} from '../../src/prime-agent/profile-sections.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROMPTS = path.resolve(HERE, '../../prompts/agents')

describe('shipped prime soul default', () => {
  it('parses cleanly with all soul sections populated and no unknown headings', async () => {
    const md = await fs.readFile(path.join(PROMPTS, 'prime-soul.md'), 'utf8')
    const parsed = parseProfileSections(md, 'soul')
    expect(parsed.unknown).toEqual([])
    for (const key of SOUL_SECTION_KEYS) {
      expect(parsed.sections[key], `section ${key} is empty`).toBeTruthy()
      expect((parsed.sections[key] ?? '').length).toBeGreaterThan(50)
    }
  })
})

describe('shipped prime operating default', () => {
  it('parses cleanly with all operating sections populated and no unknown headings', async () => {
    const md = await fs.readFile(path.join(PROMPTS, 'prime.md'), 'utf8')
    const parsed = parseProfileSections(md, 'operating')
    expect(parsed.unknown).toEqual([])
    for (const key of OPERATING_SECTION_KEYS) {
      expect(parsed.sections[key], `section ${key} is empty`).toBeTruthy()
      expect((parsed.sections[key] ?? '').length).toBeGreaterThan(50)
    }
  })
})
