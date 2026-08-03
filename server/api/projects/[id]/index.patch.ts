import { prisma } from '~~/lib/db'
import { ACTIVE_DEPLOYMENT_STATUSES } from '~~/lib/deployment-status'
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

  const data = parsed.data

  const updated = await prisma.$transaction(async (tx) => {
    await tx.environmentVariable.deleteMany({
      where: { projectId },
    })

    return tx.project.update({
      where: { id: projectId },
      data: {
        gitRepositoryUrl: data.gitRepositoryUrl,
        branch: data.branch,
        appPort: data.appPort,
        domain: data.domain,
        enablePostgres: data.enablePostgres,
        environmentVariables: {
          create: data.environmentVariables.map((env) => ({
            key: env.key,
            value: env.value,
          })),
        },
      },
      include: {
        environmentVariables: true,
      },
    })
  })

  const detail: ProjectDetail = {
    id: updated.id,
    name: updated.name,
    slug: updated.slug,
    gitRepositoryUrl: updated.gitRepositoryUrl,
    branch: updated.branch,
    appPort: updated.appPort,
    domain: updated.domain,
    enablePostgres: updated.enablePostgres,
    environmentVariables: updated.environmentVariables.map((e) => ({
      key: e.key,
      value: e.value,
    })),
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  }

  return detail
})
