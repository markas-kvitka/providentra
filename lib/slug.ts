import slugify from 'slugify'

export function toSlug(name: string): string {
  return slugify(name, { lower: true, strict: true })
}

export function getProjectDir(runtimeDir: string, slug: string): string {
  return `${runtimeDir}/projects/${slug}`
}

export function getComposeProjectName(slug: string): string {
  return `providentra-${slug}`
}
