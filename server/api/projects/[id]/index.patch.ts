import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { prisma } from '~~/lib/db'
import { ACTIVE_DEPLOYMENT_STATUSES } from '~~/lib/deployment-status'
import {
  getPrimaryAppService,
  loadProjectWithServices,
  toProjectDetail,
  updateProjectFromInput,
} from '~~/lib/project-facade'
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

  const project = await loadProjectWithServices(projectId)

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

  const app = getPrimaryAppService(project.services)
  const previousDomain = app.domain

  const updated = await updateProjectFromInput(projectId, parsed.data)

  // Retire legacy domain-keyed snippets as soon as the hostname changes.
  // Slug-keyed snippets are overwritten on the next deploy; this only clears
  // older `${domain}.caddy` files so the previous hostname cannot keep proxying.
  if (previousDomain && previousDomain !== parsed.data.domain) {
    const config = useRuntimeConfig()
    const legacyPath = join(config.caddyConfigDir, `${previousDomain}.caddy`)
    if (existsSync(legacyPath)) {
      try {
        await unlink(legacyPath)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`Failed to remove legacy Caddy snippet for ${previousDomain}: ${message}`)
      }
    }
  }

  const detail: ProjectDetail = toProjectDetail(updated)

  return detail
})
