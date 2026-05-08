import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decrypt, encrypt, isEncrypted } from '../src/crypto.js'

const TEST_KEY = 'a'.repeat(64)

describe('crypto', () => {
  beforeEach(() => {
    vi.stubEnv('SECRET_ENCRYPTION_KEY', TEST_KEY)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('encrypt/decrypt roundtrip preserves plaintext', () => {
    const plain = 'sk-ant-api03-super-secret'
    expect(decrypt(encrypt(plain))).toBe(plain)
  })

  it('produces different ciphertext each call due to random IV', () => {
    const a = encrypt('same')
    const b = encrypt('same')
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe('same')
    expect(decrypt(b)).toBe('same')
  })

  it('ciphertext has three colon-separated hex segments', () => {
    const parts = encrypt('test').split(':')
    expect(parts).toHaveLength(3)
    expect(parts.every((part) => /^[0-9a-f]+$/.test(part))).toBe(true)
  })

  it('isEncrypted returns true for encrypted values', () => {
    expect(isEncrypted(encrypt('hello'))).toBe(true)
  })

  it('isEncrypted returns false for plaintext API keys', () => {
    expect(isEncrypted('sk-ant-api03-plaintext')).toBe(false)
    expect(isEncrypted('')).toBe(false)
  })

  it('throws when SECRET_ENCRYPTION_KEY is missing', () => {
    vi.stubEnv('SECRET_ENCRYPTION_KEY', '')
    expect(() => encrypt('test')).toThrow('SECRET_ENCRYPTION_KEY')
  })

  it('throws when SECRET_ENCRYPTION_KEY is wrong length', () => {
    vi.stubEnv('SECRET_ENCRYPTION_KEY', 'tooshort')
    expect(() => encrypt('test')).toThrow('SECRET_ENCRYPTION_KEY')
  })

  it('throws on tampered ciphertext', () => {
    const parts = encrypt('test').split(':')
    parts[2] = 'deadbeef'
    expect(() => decrypt(parts.join(':'))).toThrow()
  })

  it('throws on malformed ciphertext', () => {
    expect(() => decrypt('notvalid')).toThrow('invalid ciphertext format')
  })
})
