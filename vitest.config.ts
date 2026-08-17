import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '~~': root,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL
        ?? 'postgres://providentra:providentra@localhost:5432/providentra',
      // 32-byte key, base64 — matches CI
      ENV_ENCRYPTION_KEY:
        process.env.ENV_ENCRYPTION_KEY
        ?? 'dGVzdC1lbnYtZW5jcnlwdGlvbi1rZXktMzJieXRlcSE=',
      EXECUTOR_TOKEN: process.env.EXECUTOR_TOKEN ?? 'ci-executor-token-for-tests',
    },
  },
})
