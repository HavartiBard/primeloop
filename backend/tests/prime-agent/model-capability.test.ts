import { describe, expect, it } from 'vitest'
import { assessModelCapability } from '../../src/prime-agent/model-capability.js'

describe('assessModelCapability', () => {
  describe('known model matches', () => {
    it('classifies Claude Sonnet as recommended', () => {
      const result = assessModelCapability('claude-3.5-sonnet')
      expect(result.tier).toBe('recommended')
      expect(result.isBlocked).toBe(false)
      expect(result.jsonMode).toBe(true)
      expect(result.warning).toBe('')
    })

    it('classifies Claude 4 Sonnet as recommended', () => {
      const result = assessModelCapability('claude-4.sonnet')
      expect(result.tier).toBe('recommended')
      expect(result.isBlocked).toBe(false)
    })

    it('classifies GPT-4o as recommended', () => {
      const result = assessModelCapability('gpt-4o')
      expect(result.tier).toBe('recommended')
      expect(result.jsonMode).toBe(true)
    })

    it('classifies Llama 3.1 8B as recommended', () => {
      const result = assessModelCapability('llama-3.1-8b')
      expect(result.tier).toBe('recommended')
      expect(result.estimatedParams).toBe(8)
    })

    it('classifies Llama 3.2 3B as warned', () => {
      const result = assessModelCapability('llama-3.2-3b')
      expect(result.tier).toBe('warned')
      expect(result.isBlocked).toBe(false)
      expect(result.estimatedParams).toBe(3)
    })

    it('classifies Gemma 2B as blocked', () => {
      const result = assessModelCapability('gemma-2-2b')
      expect(result.tier).toBe('blocked')
      expect(result.isBlocked).toBe(true)
      expect(result.estimatedParams).toBe(2)
    })

    it('classifies Qwen 0.5B as blocked', () => {
      const result = assessModelCapability('qwen2.5-0.5b')
      expect(result.tier).toBe('blocked')
      expect(result.isBlocked).toBe(true)
    })

    it('classifies Qwen 7B as recommended (exactly at threshold)', () => {
      const result = assessModelCapability('qwen2.5-7b')
      expect(result.tier).toBe('recommended')
    })

    it('classifies Phi 3.5 mini as warned', () => {
      const result = assessModelCapability('phi-3.5-mini')
      expect(result.tier).toBe('warned')
      expect(result.estimatedParams).toBe(4.2)
    })

    it('classifies DeepSeek V3 as recommended', () => {
      const result = assessModelCapability('deepseek-v3')
      expect(result.tier).toBe('recommended')
    })

    it('classifies Mistral Large as recommended', () => {
      const result = assessModelCapability('mistral-large')
      expect(result.tier).toBe('recommended')
    })

    it('classifies Command-R+ as recommended', () => {
      const result = assessModelCapability('command-r+')
      expect(result.tier).toBe('recommended')
    })
  })

  describe('unknown model fallback', () => {
    it('returns warned tier for completely unknown model', () => {
      const result = assessModelCapability('some-unknown-model-v2')
      expect(result.tier).toBe('warned')
      expect(result.estimatedParams).toBeNull()
      expect(result.isBlocked).toBe(false)
    })

    it('returns warned tier for empty-ish unknown name', () => {
      const result = assessModelCapability('xyz-model')
      expect(result.tier).toBe('warned')
      expect(result.estimatedParams).toBeNull()
    })
  })

  describe('dynamic size extraction', () => {
    it('extracts size from custom model name with trailing b', () => {
      const result = assessModelCapability('my-custom-model-13b')
      expect(result.tier).toBe('recommended')
      expect(result.estimatedParams).toBe(13)
    })

    it('extracts decimal size from model name', () => {
      const result = assessModelCapability('custom-4.2b')
      expect(result.tier).toBe('warned')
      expect(result.estimatedParams).toBe(4.2)
    })

    it('extracts size with space before b', () => {
      const result = assessModelCapability('model-7 b')
      expect(result.tier).toBe('recommended')
      expect(result.estimatedParams).toBe(7)
    })

    it('blocks small dynamically extracted models', () => {
      const result = assessModelCapability('tiny-1b')
      expect(result.tier).toBe('blocked')
      expect(result.estimatedParams).toBe(1)
    })
  })

  describe('boundary cases', () => {
    it('exactly 3B is not blocked (warned)', () => {
      const result = assessModelCapability('llama-3.2-3b')
      expect(result.tier).toBe('warned')
      expect(result.isBlocked).toBe(false)
    })

    it('exactly 7B is recommended', () => {
      const result = assessModelCapability('qwen2.5-7b')
      expect(result.tier).toBe('recommended')
      expect(result.isBlocked).toBe(false)
    })

    it('just under 3B (2.9B) is blocked', () => {
      const result = assessModelCapability('model-2.9b')
      expect(result.tier).toBe('blocked')
      expect(result.estimatedParams).toBe(2.9)
    })

    it('just under 7B (6.9B) is warned', () => {
      const result = assessModelCapability('model-6.9b')
      expect(result.tier).toBe('warned')
      expect(result.isBlocked).toBe(false)
    })
  })

  describe('empty/null input handling', () => {
    it('returns warned for empty string', () => {
      const result = assessModelCapability('')
      expect(result.tier).toBe('warned')
      expect(result.isBlocked).toBe(false)
      expect(result.estimatedParams).toBeNull()
    })

    it('returns warned for null input', () => {
      const result = assessModelCapability(null as unknown as string)
      expect(result.tier).toBe('warned')
      expect(result.isBlocked).toBe(false)
    })

    it('returns warned for whitespace-only input', () => {
      const result = assessModelCapability('   ')
      expect(result.tier).toBe('warned')
      expect(result.isBlocked).toBe(false)
    })
  })

  describe('case insensitivity', () => {
    it('matches uppercase model names', () => {
      const result = assessModelCapability('GPT-4O')
      expect(result.tier).toBe('recommended')
    })

    it('matches mixed case model names', () => {
      const result = assessModelCapability('Llama-3.1-8B')
      expect(result.tier).toBe('recommended')
    })
  })

  describe('no duplicate patterns', () => {
    it('llama-3.1-70b matches only once (no duplicate entry)', () => {
      const result = assessModelCapability('llama-3.1-70b')
      expect(result.tier).toBe('recommended')
      expect(result.estimatedParams).toBe(70)
    })
  })

  describe('warning messages', () => {
    it('blocked warning mentions minimum threshold', () => {
      const result = assessModelCapability('gemma-2-2b')
      expect(result.warning).toContain('below the minimum threshold')
      expect(result.warning).toContain('blocked from Prime Agent')
    })

    it('warned message explains why', () => {
      const result = assessModelCapability('llama-3.2-3b')
      expect(result.warning).toContain('unreliable JSON')
      expect(result.warning).toContain('Recommended: 7B+')
    })

    it('recommended tier has empty warning', () => {
      const result = assessModelCapability('gpt-4o')
      expect(result.warning).toBe('')
    })
  })
})
