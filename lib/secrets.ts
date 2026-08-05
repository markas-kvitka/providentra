import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const PREFIX = 'enc:v1:'
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const KEY_LENGTH = 32

function getEncryptionKey(): Buffer {
  const raw = process.env.ENV_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'ENV_ENCRYPTION_KEY is required. Generate with: openssl rand -base64 32',
    )
  }

  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `ENV_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length}). `
      + 'Generate with: openssl rand -base64 32',
    )
  }

  return key
}

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(PREFIX)
}

/**
 * Encrypt a secret for at-rest storage.
 * Wire format: enc:v1:<iv_b64>:<ciphertext_b64>:<tag_b64>
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${PREFIX}${iv.toString('base64')}:${encrypted.toString('base64')}:${tag.toString('base64')}`
}

/**
 * Decrypt a stored secret. Plaintext (legacy) values without the enc:v1: prefix
 * are returned as-is. Encrypted values that fail to decrypt throw.
 */
export function decryptSecret(stored: string): string {
  if (!isEncryptedSecret(stored)) {
    return stored
  }

  const parts = stored.split(':')
  // enc : v1 : iv : ciphertext : tag  => 5 parts
  if (parts.length !== 5 || parts[0] !== 'enc' || parts[1] !== 'v1') {
    throw new Error('Invalid encrypted secret format')
  }

  const [, , ivB64, ciphertextB64, tagB64] = parts
  if (!ivB64 || !ciphertextB64 || !tagB64) {
    throw new Error('Invalid encrypted secret format')
  }

  const key = getEncryptionKey()
  const iv = Buffer.from(ivB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  } catch {
    throw new Error(
      'Failed to decrypt environment variable. Check ENV_ENCRYPTION_KEY matches the key used to encrypt.',
    )
  }
}

export function encryptEnvValue(value: string): string {
  return encryptSecret(value)
}

export function decryptEnvValue(value: string): string {
  return decryptSecret(value)
}
