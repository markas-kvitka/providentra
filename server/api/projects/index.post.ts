import { prisma } from '~~/lib/db'
import { toSlug } from '~~/lib/slug'
import { createProjectSchema } from '../../utils/validation'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parsed = createProjectSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid project data',
      data: parsed.error.flatten(),
    })
  }

  const data = parsed.data
  const slug = toSlug(data.name)

  const existing = await prisma.project.findUnique({
    where: { slug },
  })

  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'A project with this name already exists',
    })
  }

  const project = await prisma.project.create({
    data: {
      name: data.name,
      slug,
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
  })

  return {
    id: project.id,
    slug: project.slug,
  }
})
