import { prisma } from '~~/lib/db'
import { GitAdapter } from '~~/lib/adapters/git'
import { CaddyAdapter } from '~~/lib/adapters/caddy'
import { DeploymentAdapter } from '~~/lib/adapters/docker-executor'
import { DockerExecutorClient } from '~~/lib/adapters/docker-executor-client'
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

export async function processDeployment(data: DeploymentJobData): Promise<void> {
  const { deploymentId, projectId } = data

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { environmentVariables: true },
  })

  if (!project) {
    await updateStatus(deploymentId, 'failed', {
      errorMessage: 'Project not found',
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
    await appendLog(deploymentId, `Cloning ${project.gitRepositoryUrl} (branch: ${project.branch})`)

    const gitResult = await gitAdapter.cloneOrPull(project.gitRepositoryUrl, project.branch)
    await appendLog(deploymentId, `Checked out commit ${gitResult.commitSha}: ${gitResult.commitMessage}`)
    await updateStatus(deploymentId, 'cloning', { commitSha: gitResult.commitSha })

    await updateStatus(deploymentId, 'building')
    await appendLog(deploymentId, 'Deploying containers via Docker executor')
    await updateStatus(deploymentId, 'starting')

    const upResult = await deploymentAdapter.deploy({
      appPort: project.appPort,
      enablePostgres: project.enablePostgres,
      environmentVariables: project.environmentVariables.map((e) => ({
        key: e.key,
        value: e.value,
      })),
    })
    if (upResult.stdout) await appendLog(deploymentId, upResult.stdout)
    if (upResult.stderr) await appendLog(deploymentId, upResult.stderr)

    await appendLog(deploymentId, `Configuring Caddy reverse proxy for ${project.domain}`)
    await caddyAdapter.updateProxyConfig(project.domain, project.appPort)

    await prisma.service.createMany({
      data: [
        {
          projectId: project.id,
          deploymentId,
          type: 'app',
          containerName: `${deploymentAdapter.composeProjectName}-app`,
          status: 'running',
        },
        ...(project.enablePostgres
          ? [
              {
                projectId: project.id,
                deploymentId,
                type: 'postgres' as const,
                containerName: `${deploymentAdapter.composeProjectName}-postgres`,
                status: 'running',
              },
            ]
          : []),
      ],
    })

    const containerLogs = await deploymentAdapter.logs()
    if (containerLogs) await appendLog(deploymentId, `Container logs:\n${containerLogs}`)

    await updateStatus(deploymentId, 'running', { completed: true })
    await appendLog(deploymentId, 'Deployment completed successfully')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await appendLog(deploymentId, `ERROR: ${message}`)

    try {
      await appendLog(deploymentId, 'Cleaning up failed deployment')
      await deploymentAdapter.down()
      await caddyAdapter.removeProxyConfig(project.domain)
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
