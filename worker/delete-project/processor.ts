import { prisma } from '~~/lib/db'
import { cleanupProjectResources } from '~~/lib/project-cleanup'
import {
  getPrimaryAppService,
  loadProjectWithServices,
  projectHasManagedVolumes,
} from '~~/lib/project-facade'
import { cancelActiveDeploymentJobsForProject } from '../../server/queue/index'
import type { DeleteProjectJobData } from '~~/lib/queue'
import { caddyConfigDir, caddyfilePath, dockerExecutorUrl, runtimeDir } from '../config'

export async function processProjectDeletion(data: DeleteProjectJobData): Promise<void> {
  const { projectId } = data

  const project = await loadProjectWithServices(projectId)

  if (!project) {
    console.log(`Project ${projectId} already deleted, skipping`)
    return
  }

  console.log(`Deleting project ${project.slug} (${projectId})`)

  await cancelActiveDeploymentJobsForProject(projectId)

  const app = getPrimaryAppService(project.services)
  if (!app.domain) {
    throw new Error(`Project ${project.slug} app service is missing a domain`)
  }

  await cleanupProjectResources(
    {
      slug: project.slug,
      domain: app.domain,
      hasManagedVolumes: projectHasManagedVolumes(project.services),
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
