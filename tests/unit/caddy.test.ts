import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CaddyAdapter } from '../../lib/adapters/caddy'

describe('CaddyAdapter', () => {
  const dirs: string[] = []

  afterEach(async () => {
    // temp dirs are under os.tmpdir; leave for OS cleanup
    dirs.length = 0
  })

  async function makeAdapter() {
    const caddyConfigDir = await mkdtemp(join(tmpdir(), 'providentra-caddy-'))
    dirs.push(caddyConfigDir)
    const caddyfilePath = join(caddyConfigDir, 'Caddyfile')
    await writeFile(caddyfilePath, '{\n\tauto_https off\n}\nimport sites/*.caddy\n', 'utf-8')
    const reloadCaddy = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    const adapter = new CaddyAdapter(caddyConfigDir, {
      reloader: { reloadCaddy },
      caddyfilePath,
    })
    return { adapter, caddyConfigDir, reloadCaddy }
  }

  it('writes a slug-keyed snippet and reloads', async () => {
    const { adapter, caddyConfigDir, reloadCaddy } = await makeAdapter()

    await adapter.updateProxyConfig('my-app', 'myapp.localhost', 3000)

    const content = await readFile(join(caddyConfigDir, 'my-app.caddy'), 'utf-8')
    expect(content).toContain('http://myapp.localhost')
    expect(content).toContain('host.docker.internal:3000')
    expect(reloadCaddy).toHaveBeenCalledOnce()
  })

  it('removes a legacy domain-keyed snippet when updating', async () => {
    const { adapter, caddyConfigDir, reloadCaddy } = await makeAdapter()
    const legacyPath = join(caddyConfigDir, 'old.localhost.caddy')
    await writeFile(legacyPath, 'http://old.localhost {\n\treverse_proxy host.docker.internal:3000\n}\n', 'utf-8')
    await writeFile(
      join(caddyConfigDir, 'my-app.caddy'),
      'http://old.localhost {\n\treverse_proxy host.docker.internal:3000\n}\n',
      'utf-8',
    )

    await adapter.updateProxyConfig('my-app', 'new.localhost', 3001)

    await expect(readFile(legacyPath, 'utf-8')).rejects.toThrow()
    const content = await readFile(join(caddyConfigDir, 'my-app.caddy'), 'utf-8')
    expect(content).toContain('http://new.localhost')
    expect(reloadCaddy).toHaveBeenCalled()
  })

  it('removes slug and optional domain snippets', async () => {
    const { adapter, caddyConfigDir, reloadCaddy } = await makeAdapter()
    await writeFile(join(caddyConfigDir, 'my-app.caddy'), 'http://myapp.localhost {\n}\n', 'utf-8')
    await writeFile(join(caddyConfigDir, 'myapp.localhost.caddy'), 'http://myapp.localhost {\n}\n', 'utf-8')

    await adapter.removeProxyConfig('my-app', 'myapp.localhost')

    await expect(readFile(join(caddyConfigDir, 'my-app.caddy'), 'utf-8')).rejects.toThrow()
    await expect(readFile(join(caddyConfigDir, 'myapp.localhost.caddy'), 'utf-8')).rejects.toThrow()
    expect(reloadCaddy).toHaveBeenCalledOnce()
  })

  it('does not reload when nothing was removed', async () => {
    const { adapter, reloadCaddy } = await makeAdapter()
    await adapter.removeProxyConfig('missing')
    expect(reloadCaddy).not.toHaveBeenCalled()
  })
})
