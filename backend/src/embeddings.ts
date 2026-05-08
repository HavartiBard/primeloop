import { createHash } from 'node:crypto'

export const EMBEDDING_DIMENSION = 384

export interface EmbeddingProvider {
  name: string
  embed(text: string): Promise<number[] | null>
}

export interface EmbeddingDeps {
  provider?: EmbeddingProvider | null
}

function hashToUnitInterval(input: string, index: number): number {
  const hash = createHash('sha256').update(`${index}:${input}`).digest()
  const value = hash.readUInt32BE(0)
  return value / 0xffffffff
}

function normalizeVector(values: number[]): number[] {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  if (magnitude === 0) return values
  return values.map((value) => value / magnitude)
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'deterministic-hash'

  async embed(text: string): Promise<number[] | null> {
    const trimmed = text.trim()
    if (!trimmed) return null
    const values = Array.from({ length: EMBEDDING_DIMENSION }, (_, index) => hashToUnitInterval(trimmed, index))
    return normalizeVector(values)
  }
}

export function getEmbeddingProvider(): EmbeddingProvider | null {
  const mode = (process.env.MEMORY_EMBEDDINGS_PROVIDER ?? '').trim().toLowerCase()
  if (!mode || mode === 'disabled' || mode === 'off' || mode === 'none') return null
  if (mode === 'deterministic') return new DeterministicEmbeddingProvider()
  return null
}

export function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number.isFinite(value) ? value.toFixed(8) : '0.00000000').join(',')}]`
}
