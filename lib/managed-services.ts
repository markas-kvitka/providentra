/**
 * Catalog of managed (platform-provided) service recipes.
 * Service rows select a type; the executor looks up how to run it here.
 * Swap this module for a DB-backed fetcher later without changing Service shape.
 */

export type ManagedServiceKey = 'postgres' | 'redis'

export interface ManagedServiceVolume {
  /** Suffix appended to the compose project name for the volume */
  nameSuffix: string
  mountPath: string
}

export interface ManagedServiceHealthcheck {
  test: string[]
  /** Docker healthcheck interval in nanoseconds */
  intervalNs: number
  timeoutNs: number
  retries: number
}

export interface ManagedServiceRecipe {
  key: ManagedServiceKey
  /** Human label for logs */
  label: string
  image: string
  /** Container name suffix: providentra-{slug}-{containerSuffix} */
  containerSuffix: string
  /** DNS alias on the project Docker network */
  networkAlias: string
  env: string[]
  volume?: ManagedServiceVolume
  healthcheck?: ManagedServiceHealthcheck
  /** Env vars injected into the app container when this service is present */
  injectIntoApp: Record<string, string>
}

export const MANAGED_SERVICE_CATALOG: Record<ManagedServiceKey, ManagedServiceRecipe> = {
  postgres: {
    key: 'postgres',
    label: 'PostgreSQL',
    image: 'postgres:16-alpine',
    containerSuffix: 'postgres',
    networkAlias: 'postgres',
    env: [
      'POSTGRES_USER=app',
      'POSTGRES_PASSWORD=app',
      'POSTGRES_DB=app',
    ],
    volume: {
      nameSuffix: 'postgres-data',
      mountPath: '/var/lib/postgresql/data',
    },
    healthcheck: {
      test: ['CMD-SHELL', 'pg_isready -U app'],
      intervalNs: 5_000_000_000,
      timeoutNs: 5_000_000_000,
      retries: 5,
    },
    injectIntoApp: {
      DATABASE_URL: 'postgresql://app:app@postgres:5432/app',
    },
  },
  redis: {
    key: 'redis',
    label: 'Redis',
    image: 'redis:7-alpine',
    containerSuffix: 'redis',
    networkAlias: 'redis',
    env: [],
    healthcheck: {
      test: ['CMD', 'redis-cli', 'ping'],
      intervalNs: 5_000_000_000,
      timeoutNs: 5_000_000_000,
      retries: 5,
    },
    injectIntoApp: {
      REDIS_URL: 'redis://redis:6379',
    },
  },
}

export function isManagedServiceKey(type: string): type is ManagedServiceKey {
  return Object.prototype.hasOwnProperty.call(MANAGED_SERVICE_CATALOG, type)
}

export function getManagedRecipe(key: ManagedServiceKey): ManagedServiceRecipe {
  return MANAGED_SERVICE_CATALOG[key]
}

export function tryGetManagedRecipe(type: string): ManagedServiceRecipe | undefined {
  if (!isManagedServiceKey(type)) {
    return undefined
  }
  return MANAGED_SERVICE_CATALOG[type]
}

export function listManagedRecipes(): ManagedServiceRecipe[] {
  return Object.values(MANAGED_SERVICE_CATALOG)
}

/** Env entries (`KEY=value`) to inject into the app from selected managed services. */
export function collectAppInjectEnv(managedTypes: Iterable<string>): string[] {
  const entries: string[] = []
  for (const type of managedTypes) {
    const recipe = tryGetManagedRecipe(type)
    if (!recipe) continue
    for (const [key, value] of Object.entries(recipe.injectIntoApp)) {
      entries.push(`${key}=${value}`)
    }
  }
  return entries
}

export function managedContainerName(projectName: string, recipe: ManagedServiceRecipe): string {
  return `${projectName}-${recipe.containerSuffix}`
}

export function managedVolumeName(projectName: string, recipe: ManagedServiceRecipe): string | null {
  if (!recipe.volume) {
    return null
  }
  return `${projectName}-${recipe.volume.nameSuffix}`
}
