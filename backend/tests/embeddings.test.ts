import { describe, expect, it } from 'vitest'
import {
  DeterministicEmbeddingProvider,
  EMBEDDING_DIMENSION,
  vectorLiteral,
} from '../src/embeddings.js'

describe('embeddings', () => {
  it('produces deterministic normalized vectors', async () => {
    const provider = new DeterministicEmbeddingProvider()
    const a = await provider.embed('provider model names use slash format')
    const b = await provider.embed('provider model names use slash format')
    expect(a).toHaveLength(EMBEDDING_DIMENSION)
    expect(a).toEqual(b)
    const magnitude = Math.sqrt((a ?? []).reduce((sum, value) => sum + value * value, 0))
    expect(magnitude).toBeGreaterThan(0.99)
    expect(magnitude).toBeLessThan(1.01)
  })

  it('formats vectors for pgvector SQL parameters', () => {
    expect(vectorLiteral([0.1, 0.2, 0.3])).toBe('[0.10000000,0.20000000,0.30000000]')
  })
})
