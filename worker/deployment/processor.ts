import { prisma } from '~~/lib/db'
import { GitAdapter } from '~~/lib/adapters/git'
import { CaddyAdapter } from '~~/lib/adapters/caddy'
import { DeploymentAdapter } from '~~/lib/adapters/docker-executor'
import { DockerExecutorClient } from '~~/lib/adapters/docker-executor-client'
import type { DeployServiceSpec } from '~~/lib/adapters/docker-executor-client'
import { isManagedServiceKey } from '~~/lib/managed-services'
import {
  containerNameForService,
  getPrimaryAppService,
  loadProjectWithServices,
  projectHasManagedVolumes,
} from '~~/lib/project-facade'
import { decryptEnvValue } from '~~/lib/secrets'
import { getProjectDir } from '~~/lib/slug'
import type { DeploymentJobData } from '~~/lib/queue'
import type { DeploymentStatus } from '~~/shared/types'
import { caddyConfigDir, caddyfilePath, dockerExecutorUrl, runtimeDir } from '../config'

async function appendLog(deploymentId: string, message: string): Promise<void> {
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
  })
  if (!deployment) return

  const timestamp = new Date().toISOString()
  const newLogs = `${deployment.logs}[${timestamp}] ${message}\n`

  await prisma.deployment.update({
    where: { id: deploymentId },
    data: { logs: newLogs },
  })
}

async function updateStatus(
  deploymentId: string,
  status: DeploymentStatus,
  extra?: { commitSha?: string; errorMessage?: string; completed?: boolean },
): Promise<void> {
  const now = new Date()

  await prisma.deployment.update({
    where: { id: deploymentId },
    data: {
      status,
      ...(status !== 'queued' && !extra?.completed ? { startedAt: now } : {}),
      ...(extra?.commitSha ? { commitSha: extra.commitSha } : {}),
      ...(extra?.errorMessage ? { errorMessage: extra.errorMessage } : {}),
      ...(extra?.completed ? { completedAt: now } : {}),
    },
  })
}

function toDeployServices(
  services: NonNullable<Awaited<ReturnType<typeof loadProjectWithServices>>>['services'],
): DeployServiceSpec[] {
  const specs: DeployServiceSpec[] = []

  for (const service of services) {
    if (service.type === 'app') {
      if (service.port == null) {
        throw new Error(`App service "${service.name}" is missing a port`)
      }
      specs.push({
        type: 'app',
        name: service.name,
        port: service.port,
        environmentVariables: service.environmentVariables.map((e) => ({
          key: e.key,
          value: decryptEnvValue(e.value),
        })),
      })
      continue
    }

    if (isManagedServiceKey(service.type)) {
      specs.push({
        type: service.type,
        name: service.name,
      })
    }
  }

  return specs
}

export async function processDeployment(data: DeploymentJobData): Promise<void> {
  const { deploymentId, projectId } = data

  const project = await loadProjectWithServices(projectId)

  if (!project) {
    await updateStatus(deploymentId, 'failed', {
      errorMessage: 'Project not found',
      completed: true,
    })
    return
  }

  let app
  try {
    app = getPrimaryAppService(project.services)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await updateStatus(deploymentId, 'failed', {
      errorMessage: message,
      completed: true,
    })
    return
  }

  if (!app.gitRepositoryUrl || !app.branch || app.port == null || !app.domain) {
    await updateStatus(deploymentId, 'failed', {
      errorMessage: 'App service is missing required configuration',
      completed: true,
    })
    return
  }

  const projectDir = getProjectDir(runtimeDir, project.slug)
  const gitAdapter = new GitAdapter(`${projectDir}/repo`)
  const deploymentAdapter = new DeploymentAdapter(dockerExecutorUrl, project.slug)
  const caddyAdapter = new CaddyAdapter(caddyConfigDir, {
    reloader: new DockerExecutorClient(dockerExecutorUrl),
    caddyfilePath,
  })

  try {
    await updateStatus(deploymentId, 'cloning')
    await appendLog(deploymentId, `Cloning ${app.gitRepositoryUrl} (branch: ${app.branch})`)

    const gitResult = await gitAdapter.cloneOrPull(app.gitRepositoryUrl, app.branch)
    await appendLog(deploymentId, `Checked out commit ${gitResult.commitSha}: ${gitResult.commitMessage}`)
    await updateStatus(deploymentId, 'cloning', { commitSha: gitResult.commitSha })

    await updateStatus(deploymentId, 'building')
    await appendLog(deploymentId, 'Deploying services via Docker executor')
    await updateStatus(deploymentId, 'starting')

    const deployServices = toDeployServices(project.services)
    const upResult = await deploymentAdapter.deploy({
      services: deployServices,
    })
    if (upResult.stdout) await appendLog(deploymentId, upResult.stdout)
    if (upResult.stderr) await appendLog(deploymentId, upResult.stderr)

    await appendLog(deploymentId, `Configuring Caddy reverse proxy for ${app.domain}`)
    await caddyAdapter.updateProxyConfig(project.slug, app.domain, app.port)

    for (const service of project.services) {
      await prisma.service.update({
        where: { id: service.id },
        data: {
          deploymentId,
          containerName: containerNameForService(project.slug, service.type),
          status: 'running',
        },
      })
    }

    const containerLogs = await deploymentAdapter.logs()
    if (containerLogs) await appendLog(deploymentId, `Container logs:\n${containerLogs}`)

    await updateStatus(deploymentId, 'running', { completed: true })
    await appendLog(deploymentId, 'Deployment completed successfully')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendLog(deploymentId, `ERROR: ${message}`)

    try {
      await appendLog(deploymentId, 'Cleaning up failed deployment')
      await deploymentAdapter.down({
        removeVolumes: projectHasManagedVolumes(project.services),
      })
      await caddyAdapter.removeProxyConfig(project.slug, app.domain)

      for (const service of project.services) {
        await prisma.service.update({
          where: { id: service.id },
          data: {
            deploymentId: null,
            containerName: null,
            status: 'failed',
          },
        })
      }
    } catch (cleanupError) {
      const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      await appendLog(deploymentId, `Cleanup warning: ${cleanupMessage}`)
    }

    await updateStatus(deploymentId, 'failed', {
      errorMessage: message,
      completed: true,
    })
  }
}
