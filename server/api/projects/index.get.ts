import { prisma } from '~~/lib/db'
import type { ProjectSummary } from '../../../shared/types'

export default defineEventHandler(async () => {
  const allProjects = await prisma.project.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      deployments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  const result: ProjectSummary[] = allProjects.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    domain: p.domain,
    branch: p.branch,
    latestDeploymentStatus: p.deployments[0]?.status ?? null,
    createdAt: p.createdAt.toISOString(),
  }))

  return result
})
