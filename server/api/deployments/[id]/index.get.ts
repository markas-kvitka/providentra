import { prisma } from '~~/lib/db'
import type { DeploymentDetail } from '../../../../shared/types'
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

  const detail: DeploymentDetail = {
    id: deployment.id,
    projectId: deployment.projectId,
    status: deployment.status,
    logs: deployment.logs,
    commitSha: deployment.commitSha,
    errorMessage: deployment.errorMessage,
    startedAt: deployment.startedAt?.toISOString() ?? null,
    completedAt: deployment.completedAt?.toISOString() ?? null,
    createdAt: deployment.createdAt.toISOString(),
  }

  return detail
})
