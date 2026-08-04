import { prisma } from '~~/lib/db'
import { createProjectFromInput } from '~~/lib/project-facade'
import { toSlug } from '~~/lib/slug'
import { createProjectSchema } from '../../utils/validation'
import { requireSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const session = await requireSession(event)
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

  const project = await createProjectFromInput(data, slug, session.user.id)

  return {
    id: project.id,
    slug: project.slug,
  }
})
