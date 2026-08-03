export default defineNuxtConfig({
  compatibilityDate: '2025-07-09',
  future: {
    compatibilityVersion: 4,
  },
  devtools: { enabled: true },
  css: ['~/assets/main.css'],
  build: {
    transpile: ['@prisma/client'],
  },
  nitro: {
    externals: {
      inline: ['@prisma/client', '@prisma/adapter-pg'],
    },
  },
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL || 'postgres://providentra:providentra@localhost:5432/providentra',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    runtimeDir: process.env.RUNTIME_DIR || './runtime',
    caddyConfigDir: process.env.CADDY_CONFIG_DIR || './runtime/caddy',
  },
})
