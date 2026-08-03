import { resolve } from 'node:path'

export const port = Number(process.env.EXECUTOR_PORT || 3100)
export const runtimeDir = resolve(process.env.RUNTIME_DIR || './runtime')
export const runtimeHostDir = resolve(process.env.RUNTIME_HOST_DIR || runtimeDir)
export const dockerSocket = process.env.DOCKER_SOCKET || '/var/run/docker.sock'
export const caddyAdminUrl = process.env.CADDY_ADMIN_URL || 'http://caddy:2019'
