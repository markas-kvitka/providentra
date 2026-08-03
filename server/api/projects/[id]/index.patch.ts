import { prisma } from '~~/lib/db'
import { ACTIVE_DEPLOYMENT_STATUSES } from '~~/lib/deployment-status'
import { toProjectDetail, updateProjectFromInput } from '~~/lib/project-facade'
import type { ProjectDetail } from '../../../../shared/types'
import { isProjectDeletionPending } from '../../../queue'
import { updateProjectSchema } from '../../../utils/validation'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'id')
  if (!projectId) {
    throw createError({ statusCode: 400, statusMessage: 'Project ID is required' })
  }

  const body = await readBody(event)
  const parsed = updateProjectSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid project data',
      data: parsed.error.flatten(),
    })
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
      statusMessage: 'Cannot update project while a deployment is in progress',
    })
  }

  const updated = await updateProjectFromInput(projectId, parsed.data)
  const detail: ProjectDetail = toProjectDetail(updated)

  return detail
})
