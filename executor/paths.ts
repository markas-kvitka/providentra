import { join } from 'node:path'
import { runtimeDir, runtimeHostDir } from './config'

export function getProjectPaths(slug: string) {
  const relative = join('projects', slug, 'repo')
  return {
    projectDir: join(runtimeDir, relative),
    hostProjectDir: join(runtimeHostDir, relative),
  }
}

export function getProjectRootDir(slug: string): string {
  return join(runtimeDir, 'projects', slug)
}
