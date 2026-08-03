import { prisma } from '~~/lib/db'
import { cleanupProjectResources } from '~~/lib/project-cleanup'
import { cancelActiveDeploymentJobsForProject } from '../../server/queue/index'
import type { DeleteProjectJobData } from '~~/lib/queue'
import { caddyConfigDir, caddyfilePath, dockerExecutorUrl, runtimeDir } from '../config'

export async function processProjectDeletion(data: DeleteProjectJobData): Promise<void> {
  const { projectId } = data

  const project = await prisma.project.findUnique({
    where: { id: projectId },
  })

  if (!project) {
    console.log(`Project ${projectId} already deleted, skipping`)
    return
  }

  console.log(`Deleting project ${project.slug} (${projectId})`)

  await cancelActiveDeploymentJobsForProject(projectId)

  await cleanupProjectResources(
    {
      slug: project.slug,
      domain: project.domain,
      enablePostgres: project.enablePostgres,
    },
    runtimeDir,
    caddyConfigDir,
    dockerExecutorUrl,
    { caddyfilePath },
  )

  await prisma.project.delete({
    where: { id: projectId },
  })

  console.log(`Project ${project.slug} deleted`)
}
