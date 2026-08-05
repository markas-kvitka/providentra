import { authClient } from '~~/lib/auth-client'

const PUBLIC_PATHS = new Set(['/login', '/register'])

export default defineNuxtRouteMiddleware(async (to) => {
  const { data: session } = await authClient.useSession(useFetch)

  if (!session.value && !PUBLIC_PATHS.has(to.path)) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath },
    })
  }

  if (session.value && PUBLIC_PATHS.has(to.path)) {
    return navigateTo('/projects')
  }
})
