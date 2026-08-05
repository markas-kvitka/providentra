import { prisma } from '~~/lib/db'
import { getPrimaryAppService, toProjectDetail } from '~~/lib/project-facade'
import type { ProjectDetail, DeploymentSummary } from '../../../../shared/types'
import { requireOwnedProject } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Project ID is required' })
  }

  await requireOwnedProject(event, id)

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      services: {
        include: { environmentVariables: true },
        orderBy: { createdAt: 'asc' },
      },
      deployments: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  })

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  try {
    getPrimaryAppService(project.services)
  } catch {
    throw createError({ statusCode: 500, statusMessage: 'Project is missing an app service' })
  }

  const detail: ProjectDetail = toProjectDetail(project)

  const deployments: DeploymentSummary[] = project.deployments.map((d) => ({
    id: d.id,
    status: d.status,
    commitSha: d.commitSha,
    errorMessage: d.errorMessage,
    startedAt: d.startedAt?.toISOString() ?? null,
    completedAt: d.completedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
  }))

  return { project: detail, deployments }
})
