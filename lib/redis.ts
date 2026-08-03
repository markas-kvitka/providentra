import type { ConnectionOptions } from 'bullmq'

export function getRedisConnectionOptions(url?: string): ConnectionOptions {
  return {
    url: url ?? process.env.REDIS_URL ?? 'redis://localhost:6379',
    maxRetriesPerRequest: null,
  }
}
