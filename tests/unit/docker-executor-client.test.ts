import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockerExecutorClient } from '../../lib/adapters/docker-executor-client'

describe('DockerExecutorClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mockFetch(response: Partial<Response> & { jsonBody?: unknown }) {
    const { jsonBody, ...rest } = response
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => jsonBody ?? { ok: true, messages: ['done'] },
      ...rest,
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('sends Authorization bearer on deploy', async () => {
    const fetchMock = mockFetch({ jsonBody: { ok: true, messages: ['built'] } })
    const client = new DockerExecutorClient('http://executor.test', 'secret-token')

    const result = await client.deploy({
      slug: 'demo',
      services: [{ type: 'app', name: 'web', port: 3000, environmentVariables: [] }],
    })

    expect(result.stdout).toBe('built')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://executor.test/deploy',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('throws when EXECUTOR_TOKEN is missing', async () => {
    const client = new DockerExecutorClient('http://executor.test', '')
    await expect(
      client.deploy({
        slug: 'demo',
        services: [{ type: 'app', name: 'web', port: 3000, environmentVariables: [] }],
      }),
    ).rejects.toThrow(/EXECUTOR_TOKEN is required/)
  })

  it('throws on non-ok deploy response', async () => {
    mockFetch({
      ok: false,
      status: 500,
      jsonBody: { ok: false, error: 'boom' },
    })
    const client = new DockerExecutorClient('http://executor.test', 'token')
    await expect(
      client.deploy({
        slug: 'demo',
        services: [{ type: 'app', name: 'web', port: 3000, environmentVariables: [] }],
      }),
    ).rejects.toThrow('boom')
  })

  it('returns null on teardown 404', async () => {
    mockFetch({ ok: false, status: 404, jsonBody: { ok: false } })
    const client = new DockerExecutorClient('http://executor.test', 'token')
    await expect(client.teardown('missing')).resolves.toBeNull()
  })

  it('fetches logs with auth header', async () => {
    const fetchMock = mockFetch({ jsonBody: { ok: true, logs: 'hello' } })
    const client = new DockerExecutorClient('http://executor.test', 'token')
    await expect(client.logs('demo')).resolves.toBe('hello')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://executor.test/deploy/demo/logs',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    )
  })
})
