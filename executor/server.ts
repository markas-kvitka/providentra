import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { deployProject, getProjectLogs, teardownProject } from './deploy'
import { reloadCaddy } from './caddy'
import { port } from './config'
import type { ManagedServiceKey } from '../lib/managed-services'

interface JsonResponse {
  ok: boolean
  messages?: string[]
  logs?: string
  error?: string
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return {} as T
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T
}

async function readTextBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf-8')
}

function sendJson(response: ServerResponse, statusCode: number, body: JsonResponse): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}

function getSlugFromPath(pathname: string): string | null {
  const match = /^\/deploy\/([^/]+)/.exec(pathname)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

export function startExecutorServer(): void {
  const server = createServer(async (request, response) => {
    const method = request.method ?? 'GET'
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    const pathname = url.pathname

    try {
      if (method === 'GET' && pathname === '/health') {
        sendJson(response, 200, { ok: true })
        return
      }

      if (method === 'POST' && pathname === '/caddy/reload') {
        const caddyfile = await readTextBody(request)
        if (!caddyfile.trim()) {
          sendJson(response, 400, { ok: false, error: 'Missing Caddyfile body' })
          return
        }

        const result = await reloadCaddy(caddyfile)
        sendJson(response, 200, { ok: true, messages: result.messages })
        return
      }

      if (method === 'POST' && pathname === '/deploy') {
        const body = await readJsonBody<{
          slug: string
          services: Array<
            | {
                type: 'app'
                name: string
                port: number
                environmentVariables: Array<{ key: string; value: string }>
              }
            | {
                type: ManagedServiceKey
                name: string
              }
          >
        }>(request)

        if (!body.slug || !Array.isArray(body.services) || body.services.length === 0) {
          sendJson(response, 400, { ok: false, error: 'Deploy requires slug and services' })
          return
        }

        const result = await deployProject(body)
        sendJson(response, 200, { ok: true, messages: result.messages })
        return
      }

      if (method === 'DELETE' && pathname.startsWith('/deploy/')) {
        const slug = getSlugFromPath(pathname)
        if (!slug) {
          sendJson(response, 400, { ok: false, error: 'Missing slug' })
          return
        }

        const removeVolumes = url.searchParams.get('removeVolumes') === 'true'
        const purgeFiles = url.searchParams.get('purgeFiles') === 'true'
        const result = await teardownProject(slug, { removeVolumes, purgeFiles })
        sendJson(response, 200, { ok: true, messages: result.messages })
        return
      }

      if (method === 'GET' && /^\/deploy\/[^/]+\/logs$/.test(pathname)) {
        const slug = /^\/deploy\/([^/]+)\/logs$/.exec(pathname)?.[1]
        if (!slug) {
          sendJson(response, 400, { ok: false, error: 'Missing slug' })
          return
        }

        const logs = await getProjectLogs(slug)
        sendJson(response, 200, { ok: true, logs })
        return
      }

      sendJson(response, 404, { ok: false, error: 'Not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      sendJson(response, 500, { ok: false, error: message })
    }
  })

  server.listen(port, () => {
    console.log(`Providentra docker executor listening on :${port}`)
  })
}
