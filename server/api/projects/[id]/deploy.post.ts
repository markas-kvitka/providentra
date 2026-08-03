import { prisma } from '~~/lib/db'
import { ACTIVE_DEPLOYMENT_STATUSES } from '~~/lib/deployment-status'
import { enqueueDeployment, isProjectDeletionPending } from '../../../queue'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'id')
  if (!projectId) {
    throw createError({ statusCode: 400, statusMessage: 'Project ID is required' })
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
  })

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  if (await isProjectDeletionPending(projectId)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Project deletion is in progress',
    })
  }

  const activeDeployment = await prisma.deployment.findFirst({
    where: {
      projectId,
      status: { in: [...ACTIVE_DEPLOYMENT_STATUSES] },
    },
  })

  if (activeDeployment) {
    throw createError({
      statusCode: 409,
      statusMessage: 'A deployment is already in progress for this project',
    })
  }

  const deployment = await prisma.deployment.create({
    data: {
      projectId: project.id,
      status: 'queued',
      logs: `[${new Date().toISOString()}] Deployment queued\n`,
    },
  })

  await enqueueDeployment({
    deploymentId: deployment.id,
    projectId: project.id,
  })

  return {
    deploymentId: deployment.id,
    status: deployment.status,
  }
})
