import { getRedisConnectionOptions } from '~~/lib/redis'

export const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
export const runtimeDir = process.env.RUNTIME_DIR || './runtime'
export const caddyConfigDir = process.env.CADDY_CONFIG_DIR || './runtime/caddy'
export const caddyfilePath = process.env.CADDYFILE_PATH || './Caddyfile'
export const dockerExecutorUrl = process.env.DOCKER_EXECUTOR_URL || 'http://127.0.0.1:3100'
export const redisConnection = getRedisConnectionOptions(redisUrl)
