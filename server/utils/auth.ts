import type { H3Event } from 'h3'
import { auth } from '~~/lib/auth'
import { prisma } from '~~/lib/db'

export async function requireSession(event: H3Event) {
  const session = await auth.api.getSession({
    headers: event.headers,
  })

  if (!session?.user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    })
  }

  return session
}

export async function requireOwnedProject(event: H3Event, projectId: string) {
  const session = await requireSession(event)

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: session.user.id,
    },
  })

  if (!project) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Project not found',
    })
  }

  return { session, project }
}
