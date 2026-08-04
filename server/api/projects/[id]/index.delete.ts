import { prisma } from '~~/lib/db'
import { ACTIVE_DEPLOYMENT_STATUSES } from '~~/lib/deployment-status'
import { enqueueProjectDeletion, isProjectDeletionPending } from '../../../queue'
import { requireOwnedProject } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'id')
  if (!projectId) {
    throw createError({ statusCode: 400, statusMessage: 'Project ID is required' })
  }

  await requireOwnedProject(event, projectId)

  if (await isProjectDeletionPending(projectId)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Project deletion is already in progress',
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
      statusMessage: 'Cannot delete project while a deployment is in progress',
    })
  }

  await enqueueProjectDeletion(projectId)

  return {
    projectId,
    status: 'queued' as const,
  }
})
