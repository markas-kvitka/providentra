import { existsSync } from 'node:fs'
import { writeFile, mkdir, unlink, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DockerExecutorClient } from './docker-executor-client'

type CaddyReloader = Pick<DockerExecutorClient, 'reloadCaddy'>

export interface CaddyAdapterOptions {
  /** Relays the reload to Caddy's admin API (typically the docker executor) */
  reloader?: CaddyReloader
  /** Path to the base Caddyfile that is sent to the reloader */
  caddyfilePath?: string
}

function snippetPath(caddyConfigDir: string, key: string): string {
  return join(caddyConfigDir, `${key}.caddy`)
}

function domainFromSnippet(content: string): string | null {
  const match = content.match(/^http:\/\/(\S+)/m)
  return match?.[1] ?? null
}

export class CaddyAdapter {
  private readonly reloader?: CaddyReloader
  private readonly caddyfilePath: string

  constructor(
    private readonly caddyConfigDir: string,
    options: CaddyAdapterOptions = {},
  ) {
    this.reloader = options.reloader
    this.caddyfilePath = options.caddyfilePath ?? './Caddyfile'
  }

  /**
   * Writes (or replaces) the per-project Caddy snippet.
   * Snippets are keyed by project slug so a domain change overwrites the same
   * file instead of leaving the previous hostname configured.
   */
  async updateProxyConfig(projectSlug: string, domain: string, upstreamPort: number): Promise<void> {
    await mkdir(this.caddyConfigDir, { recursive: true })
    const configPath = snippetPath(this.caddyConfigDir, projectSlug)

    const legacyDomains = new Set<string>([domain])
    if (existsSync(configPath)) {
      const previousDomain = domainFromSnippet(await readFile(configPath, 'utf-8'))
      if (previousDomain) {
        legacyDomains.add(previousDomain)
      }
    }

    const content = `http://${domain} {
\treverse_proxy host.docker.internal:${upstreamPort}
}
`
    await writeFile(configPath, content, 'utf-8')

    for (const legacyDomain of legacyDomains) {
      const legacyPath = snippetPath(this.caddyConfigDir, legacyDomain)
      if (legacyPath === configPath) {
        continue
      }
      await this.unlinkIfPresent(legacyPath)
    }

    await this.reload()
  }

  /**
   * Removes the project's Caddy snippet. When `domain` is provided, also
   * deletes a legacy domain-keyed file from older deploys.
   */
  async removeProxyConfig(projectSlug: string, domain?: string): Promise<void> {
    const removedSlug = await this.unlinkIfPresent(snippetPath(this.caddyConfigDir, projectSlug))
    const removedDomain = domain
      ? await this.unlinkIfPresent(snippetPath(this.caddyConfigDir, domain))
      : false

    if (!removedSlug && !removedDomain) {
      return
    }

    await this.reload()
  }

  /**
   * Sends the base Caddyfile to the reloader (the docker executor), which
   * forwards it to Caddy's admin API `/load`. The `import` directive makes
   * Caddy re-read the per-project snippets we just wrote, applying config
   * without a restart and without exposing the admin port to the host.
   */
  private async reload(): Promise<void> {
    if (!this.reloader) {
      return
    }

    const caddyfile = await readFile(this.caddyfilePath, 'utf-8')
    await this.reloader.reloadCaddy(caddyfile)
  }

  private async unlinkIfPresent(configPath: string): Promise<boolean> {
    if (!existsSync(configPath)) {
      return false
    }
    await unlink(configPath)
    return true
  }
}
