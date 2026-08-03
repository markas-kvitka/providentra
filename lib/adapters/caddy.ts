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

  async updateProxyConfig(domain: string, upstreamPort: number): Promise<void> {
    await mkdir(this.caddyConfigDir, { recursive: true })
    const configPath = join(this.caddyConfigDir, `${domain}.caddy`)
    const content = `http://${domain} {
\treverse_proxy host.docker.internal:${upstreamPort}
}
`
    await writeFile(configPath, content, 'utf-8')
    await this.reload()
  }

  async removeProxyConfig(domain: string): Promise<void> {
    const configPath = join(this.caddyConfigDir, `${domain}.caddy`)
    if (!existsSync(configPath)) {
      return
    }

    await unlink(configPath)
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
}
