import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadProjectWithServices: vi.fn(),
  gitCloneOrPull: vi.fn(),
  deploy: vi.fn(),
  down: vi.fn(),
  logs: vi.fn(),
  updateProxyConfig: vi.fn(),
  removeProxyConfig: vi.fn(),
  prismaDeploymentFindUnique: vi.fn(),
  prismaDeploymentUpdate: vi.fn(),
  prismaServiceUpdate: vi.fn(),
}))

vi.mock('~~/lib/db', () => ({
  prisma: {
    deployment: {
      findUnique: mocks.prismaDeploymentFindUnique,
      update: mocks.prismaDeploymentUpdate,
    },
    service: {
      update: mocks.prismaServiceUpdate,
    },
  },
}))

vi.mock('~~/lib/adapters/git', () => ({
  GitAdapter: class {
    cloneOrPull = mocks.gitCloneOrPull
  },
}))

vi.mock('~~/lib/adapters/docker-executor', () => ({
  DeploymentAdapter: class {
    deploy = mocks.deploy
    down = mocks.down
    logs = mocks.logs
  },
}))

vi.mock('~~/lib/adapters/caddy', () => ({
  CaddyAdapter: class {
    updateProxyConfig = mocks.updateProxyConfig
    removeProxyConfig = mocks.removeProxyConfig
  },
}))

vi.mock('~~/lib/adapters/docker-executor-client', () => ({
  DockerExecutorClient: class {},
}))

vi.mock('~~/lib/project-facade', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/project-facade')>()
  return {
    ...actual,
    loadProjectWithServices: mocks.loadProjectWithServices,
  }
})

import { processDeployment } from '../../worker/deployment/processor'

function makeProject() {
  return {
    id: 'proj-1',
    slug: 'demo',
    services: [
      {
        id: 'svc-web',
        name: 'web',
        type: 'app' as const,
        gitRepositoryUrl: 'https://github.com/acme/app.git',
        branch: 'main',
        port: 3000,
        domain: 'demo.localhost',
        environmentVariables: [],
      },
    ],
  }
}

describe('processDeployment failure path', () => {
  beforeEach(() => {
    mocks.loadProjectWithServices.mockResolvedValue(makeProject())
    mocks.gitCloneOrPull.mockResolvedValue({ commitSha: 'abc123', commitMessage: 'init' })
    mocks.deploy.mockResolvedValue({ stdout: 'built', stderr: '' })
    mocks.updateProxyConfig.mockResolvedValue(undefined)
    mocks.logs.mockResolvedValue('')
    mocks.prismaDeploymentFindUnique.mockResolvedValue({ logs: '' })
    mocks.prismaDeploymentUpdate.mockResolvedValue({})
    mocks.prismaServiceUpdate.mockResolvedValue({})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  function failedStatusCalls() {
    return mocks.prismaDeploymentUpdate.mock.calls.filter((call) => {
      const data = call[0]?.data as { status?: string } | undefined
      return data?.status === 'failed'
    })
  }

  it('marks the deployment failed and does not teardown when clone fails', async () => {
    mocks.gitCloneOrPull.mockRejectedValue(new Error('clone failed'))

    await processDeployment({ deploymentId: 'dep-1', projectId: 'proj-1' })

    expect(mocks.down).not.toHaveBeenCalled()
    expect(mocks.removeProxyConfig).not.toHaveBeenCalled()
    expect(mocks.prismaServiceUpdate).not.toHaveBeenCalled()
    expect(failedStatusCalls()).toEqual([
      [
        expect.objectContaining({
          where: { id: 'dep-1' },
          data: expect.objectContaining({
            status: 'failed',
            errorMessage: 'clone failed',
          }),
        }),
      ],
    ])
  })

  it('marks the deployment failed and does not teardown when deploy fails', async () => {
    mocks.deploy.mockRejectedValue(new Error('build failed'))

    await processDeployment({ deploymentId: 'dep-1', projectId: 'proj-1' })

    expect(mocks.down).not.toHaveBeenCalled()
    expect(mocks.removeProxyConfig).not.toHaveBeenCalled()
    expect(mocks.prismaServiceUpdate).not.toHaveBeenCalled()
    expect(failedStatusCalls()[0]?.[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          errorMessage: 'build failed',
        }),
      }),
    )
  })

  it('leaves containers and Caddy in place when Caddy reload fails after deploy', async () => {
    mocks.updateProxyConfig.mockRejectedValue(new Error('caddy reload failed'))

    await processDeployment({ deploymentId: 'dep-1', projectId: 'proj-1' })

    expect(mocks.deploy).toHaveBeenCalledOnce()
    expect(mocks.down).not.toHaveBeenCalled()
    expect(mocks.removeProxyConfig).not.toHaveBeenCalled()
    expect(mocks.prismaServiceUpdate).not.toHaveBeenCalled()
    expect(failedStatusCalls()[0]?.[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'failed',
          errorMessage: 'caddy reload failed',
        }),
      }),
    )
  })

  it('deploys, updates Caddy, and marks services running on success', async () => {
    await processDeployment({ deploymentId: 'dep-1', projectId: 'proj-1' })

    expect(mocks.deploy).toHaveBeenCalledOnce()
    expect(mocks.updateProxyConfig).toHaveBeenCalledWith('demo', 'demo.localhost', 3000)
    expect(mocks.down).not.toHaveBeenCalled()
    expect(mocks.removeProxyConfig).not.toHaveBeenCalled()
    expect(mocks.prismaServiceUpdate).toHaveBeenCalledWith({
      where: { id: 'svc-web' },
      data: {
        deploymentId: 'dep-1',
        containerName: 'providentra-demo-app',
        status: 'running',
      },
    })
    expect(mocks.prismaDeploymentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'running' }),
      }),
    )
  })
})
