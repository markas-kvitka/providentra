import { prisma } from '~~/lib/db'
import type { ProjectDetail, DeploymentSummary } from '../../../../shared/types'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Project ID is required' })
  }

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      environmentVariables: true,
      deployments: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  })

  if (!project) {
    throw createError({ statusCode: 404, statusMessage: 'Project not found' })
  }

  const detail: ProjectDetail = {
    id: project.id,
    name: project.name,
    slug: project.slug,
    gitRepositoryUrl: project.gitRepositoryUrl,
    branch: project.branch,
    appPort: project.appPort,
    domain: project.domain,
    enablePostgres: project.enablePostgres,
    environmentVariables: project.environmentVariables.map((e) => ({
      key: e.key,
      value: e.value,
    })),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }

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
