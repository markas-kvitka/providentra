import { defineConfig } from 'vitest/config'

export default defineConfig({
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
