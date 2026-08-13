import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from '../../lib/secrets'

const VALID_KEY = 'dGVzdC1lbnYtZW5jcnlwdGlvbi1rZXktMzJieXRlcSE='

describe('secrets', () => {
  beforeEach(() => {
    process.env.ENV_ENCRYPTION_KEY = VALID_KEY
  })

  afterEach(() => {
    process.env.ENV_ENCRYPTION_KEY = VALID_KEY
  })

  it('round-trips encrypt and decrypt', () => {
    const encrypted = encryptSecret('super-secret')
    expect(isEncryptedSecret(encrypted)).toBe(true)
    expect(decryptSecret(encrypted)).toBe('super-secret')
  })

  it('returns legacy plaintext values as-is', () => {
    expect(decryptSecret('plain-legacy-value')).toBe('plain-legacy-value')
    expect(isEncryptedSecret('plain-legacy-value')).toBe(false)
  })

  it('throws when ENV_ENCRYPTION_KEY is missing', () => {
    delete process.env.ENV_ENCRYPTION_KEY
    expect(() => encryptSecret('x')).toThrow(/ENV_ENCRYPTION_KEY is required/)
  })

  it('throws when ENV_ENCRYPTION_KEY has wrong length', () => {
    process.env.ENV_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64')
    expect(() => encryptSecret('x')).toThrow(/must decode to 32 bytes/)
  })

  it('throws on tampered ciphertext', () => {
    const encrypted = encryptSecret('secret')
    const parts = encrypted.split(':')
    parts[3] = Buffer.from('tampered').toString('base64')
    expect(() => decryptSecret(parts.join(':'))).toThrow(/Failed to decrypt/)
  })

  it('throws on invalid encrypted format', () => {
    expect(() => decryptSecret('enc:v1:only-two')).toThrow(/Invalid encrypted secret format/)
  })
})
