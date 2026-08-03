import { Queue } from 'bullmq'
import {
  DEPLOYMENT_QUEUE_NAME,
  PROJECT_DELETE_QUEUE_NAME,
  type DeploymentJobData,
  type DeleteProjectJobData,
} from '~~/lib/queue'
import { getRedisConnectionOptions } from '~~/lib/redis'

let deploymentQueue: Queue<DeploymentJobData> | null = null
let projectDeleteQueue: Queue<DeleteProjectJobData> | null = null

export function getDeploymentQueue(): Queue<DeploymentJobData> {
  if (!deploymentQueue) {
    deploymentQueue = new Queue<DeploymentJobData>(DEPLOYMENT_QUEUE_NAME, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 1,
      },
    })
  }
  return deploymentQueue
}

export function getProjectDeleteQueue(): Queue<DeleteProjectJobData> {
  if (!projectDeleteQueue) {
    projectDeleteQueue = new Queue<DeleteProjectJobData>(PROJECT_DELETE_QUEUE_NAME, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 1,
      },
    })
  }
  return projectDeleteQueue
}

async function addDeploymentJob(data: DeploymentJobData): Promise<string> {
  const queue = getDeploymentQueue()
  const existingJob = await queue.getJob(data.deploymentId)
  if (existingJob) {
    await existingJob.remove()
  }

  const job = await queue.add('deploy', data, {
    jobId: data.deploymentId,
  })
  return job.id ?? data.deploymentId
}

export async function enqueueDeployment(data: DeploymentJobData): Promise<string> {
  return addDeploymentJob(data)
}

export async function retryDeployment(data: DeploymentJobData): Promise<string> {
  return addDeploymentJob(data)
}

export async function enqueueProjectDeletion(projectId: string): Promise<string> {
  const queue = getProjectDeleteQueue()
  const existingJob = await queue.getJob(projectId)
  if (existingJob) {
    const state = await existingJob.getState()
    if (state === 'waiting' || state === 'active' || state === 'delayed') {
      return projectId
    }
    await existingJob.remove()
  }

  const job = await queue.add('delete-project', { projectId }, { jobId: projectId })
  return job.id ?? projectId
}

export async function isProjectDeletionPending(projectId: string): Promise<boolean> {
  const queue = getProjectDeleteQueue()
  const job = await queue.getJob(projectId)
  if (!job) return false

  const state = await job.getState()
  return state === 'waiting' || state === 'active' || state === 'delayed'
}

export async function cancelActiveDeploymentJobsForProject(projectId: string): Promise<void> {
  const { prisma } = await import('~~/lib/db')
  const { ACTIVE_DEPLOYMENT_STATUSES } = await import('~~/lib/deployment-status')

  const activeDeployments = await prisma.deployment.findMany({
    where: {
      projectId,
      status: { in: [...ACTIVE_DEPLOYMENT_STATUSES] },
    },
  })

  const queue = getDeploymentQueue()
  const now = new Date()

  for (const deployment of activeDeployments) {
    const job = await queue.getJob(deployment.id)
    if (job) {
      await job.remove()
    }

    await prisma.deployment.update({
      where: { id: deployment.id },
      data: {
        status: 'failed',
        errorMessage: 'Project deleted',
        completedAt: now,
      },
    })
  }
}
