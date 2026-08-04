import { prisma } from '~~/lib/db'
import { ACTIVE_DEPLOYMENT_STATUSES } from '~~/lib/deployment-status'
import { retryDeployment } from '../../../queue'
import { requireSession } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Deployment ID is required' })
  }

  const session = await requireSession(event)

  const deployment = await prisma.deployment.findFirst({
    where: {
      id,
      project: { userId: session.user.id },
    },
  })

  if (!deployment) {
    throw createError({ statusCode: 404, statusMessage: 'Deployment not found' })
  }

  if (deployment.status !== 'failed') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Only failed deployments can be retried',
    })
  }

  const activeDeployment = await prisma.deployment.findFirst({
    where: {
      projectId: deployment.projectId,
      id: { not: id },
      status: { in: [...ACTIVE_DEPLOYMENT_STATUSES] },
    },
  })

  if (activeDeployment) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Another deployment is already in progress for this project',
    })
  }

  await prisma.deployment.update({
    where: { id },
    data: {
      status: 'queued',
      logs: `[${new Date().toISOString()}] Deployment retry queued\n`,
      commitSha: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
    },
  })

  await retryDeployment({
    deploymentId: deployment.id,
    projectId: deployment.projectId,
  })

  return {
    deploymentId: deployment.id,
    status: 'queued' as const,
  }
})
