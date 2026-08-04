import { prisma } from '~~/lib/db'
import { findPrimaryAppService } from '~~/lib/project-facade'
import type { ProjectSummary } from '../../../shared/types'

export default defineEventHandler(async () => {
  const allProjects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      services: true,
      deployments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  const result: ProjectSummary[] = allProjects.flatMap((p) => {
    const app = findPrimaryAppService(p.services)
    if (!app) {
      return []
    }

    return [{
      id: p.id,
      name: p.name,
      slug: p.slug,
      domain: app.domain ?? '',
      branch: app.branch ?? 'main',
      latestDeploymentStatus: p.deployments[0]?.status ?? null,
      createdAt: p.createdAt.toISOString(),
    }]
  })

  return result
})
