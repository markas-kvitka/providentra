import { getComposeProjectName } from '../slug'
import type { ManagedServiceKey } from '../managed-services'

export type DeployServiceSpec =
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

export interface DeploymentConfig {
  slug: string
  services: DeployServiceSpec[]
}

export interface DeploymentRunResult {
  stdout: string
  stderr: string
}

interface ExecutorResponse {
  ok: boolean
  messages?: string[]
  logs?: string
  error?: string
}

async function executorFetch(url: string, init?: RequestInit): Promise<Response> {
  const maxAttempts = 5
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(url, init)
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts) {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000))
    }
  }

  const cause = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(
    `Could not reach docker executor at ${url} (${cause}). `
    + 'Ensure it is running: sudo docker compose up -d --build docker-executor',
  )
}

export class DockerExecutorClient {
  constructor(private readonly baseUrl: string) {}

  getProjectName(slug: string): string {
    return getComposeProjectName(slug)
  }

  async deploy(config: DeploymentConfig): Promise<DeploymentRunResult> {
    const response = await executorFetch(`${this.baseUrl}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })

    const body = await response.json() as ExecutorResponse
    if (!response.ok || !body.ok) {
      throw new Error(body.error ?? `Docker executor deploy failed (${response.status})`)
    }

    const stdout = (body.messages ?? []).join('\n')
    return { stdout, stderr: '' }
  }

  async teardown(
    slug: string,
    options?: { removeVolumes?: boolean; purgeFiles?: boolean },
  ): Promise<DeploymentRunResult | null> {
    const params = new URLSearchParams()
    if (options?.removeVolumes) {
      params.set('removeVolumes', 'true')
    }
    if (options?.purgeFiles) {
      params.set('purgeFiles', 'true')
    }

    const query = params.toString()
    const response = await executorFetch(
      `${this.baseUrl}/deploy/${encodeURIComponent(slug)}${query ? `?${query}` : ''}`,
      { method: 'DELETE' },
    )

    if (response.status === 404) {
      return null
    }

    const body = await response.json() as ExecutorResponse
    if (!response.ok || !body.ok) {
      throw new Error(body.error ?? `Docker executor teardown failed (${response.status})`)
    }

    const stdout = (body.messages ?? []).join('\n')
    return { stdout, stderr: '' }
  }

  async reloadCaddy(caddyfile: string): Promise<DeploymentRunResult> {
    const response = await executorFetch(`${this.baseUrl}/caddy/reload`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/caddyfile' },
      body: caddyfile,
    })

    const body = await response.json() as ExecutorResponse
    if (!response.ok || !body.ok) {
      throw new Error(body.error ?? `Docker executor caddy reload failed (${response.status})`)
    }

    const stdout = (body.messages ?? []).join('\n')
    return { stdout, stderr: '' }
  }

  async logs(slug: string): Promise<string> {
    const response = await executorFetch(`${this.baseUrl}/deploy/${encodeURIComponent(slug)}/logs`)
    const body = await response.json() as ExecutorResponse

    if (!response.ok || !body.ok) {
      throw new Error(body.error ?? `Docker executor logs failed (${response.status})`)
    }

    return body.logs ?? ''
  }
}
