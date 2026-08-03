import type { Prisma, Service, ServiceType } from '../prisma/generated/client'
import type {
  CreateProjectInput,
  EnvironmentVariableInput,
  ProjectDetail,
  UpdateProjectInput,
} from '../shared/types'
import { prisma } from './db'
import { getComposeProjectName } from './slug'
import { tryGetManagedRecipe } from './managed-services'

export const PRIMARY_APP_SERVICE_NAME = 'web'
export const POSTGRES_SERVICE_NAME = 'postgres'

export type ProjectWithServices = Prisma.ProjectGetPayload<{
  include: {
    services: {
      include: { environmentVariables: true }
    }
  }
}>

export function listProjectServices(projectId: string) {
  return prisma.service.findMany({
    where: { projectId },
    include: { environmentVariables: true },
    orderBy: { createdAt: 'asc' },
  })
}

export function getPrimaryAppService<
  T extends Pick<Service, 'id' | 'name' | 'type' | 'gitRepositoryUrl' | 'branch' | 'port' | 'domain'> & {
    environmentVariables?: EnvironmentVariableInput[]
  },
>(services: T[]): T {
  const app = services.find((s) => s.type === 'app' && s.name === PRIMARY_APP_SERVICE_NAME)
    ?? services.find((s) => s.type === 'app')

  if (!app) {
    throw new Error('Project has no app service')
  }

  return app
}

export function hasPostgresService(services: Array<Pick<Service, 'type'>>): boolean {
  return services.some((s) => s.type === 'postgres')
}

export function toProjectDetail(project: ProjectWithServices): ProjectDetail {
  const app = getPrimaryAppService(project.services)
  const env = app.environmentVariables ?? []

  if (!app.gitRepositoryUrl || !app.branch || app.port == null || !app.domain) {
    throw new Error(`App service "${app.name}" is missing required configuration`)
  }

  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    gitRepositoryUrl: app.gitRepositoryUrl,
    branch: app.branch,
    appPort: app.port,
    domain: app.domain,
    enablePostgres: hasPostgresService(project.services),
    environmentVariables: env.map((e) => ({ key: e.key, value: e.value })),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}

export function containerNameForService(projectSlug: string, type: ServiceType): string {
  const projectName = getComposeProjectName(projectSlug)
  const recipe = tryGetManagedRecipe(type)
  if (recipe) {
    return `${projectName}-${recipe.containerSuffix}`
  }
  return `${projectName}-app`
}

export function projectHasManagedVolumes(services: Array<Pick<Service, 'type'>>): boolean {
  return services.some((service) => {
    const recipe = tryGetManagedRecipe(service.type)
    return Boolean(recipe?.volume)
  })
}

export async function createProjectFromInput(data: CreateProjectInput, slug: string) {
  return prisma.project.create({
    data: {
      name: data.name,
      slug,
      services: {
        create: [
          {
            name: PRIMARY_APP_SERVICE_NAME,
            type: 'app',
            gitRepositoryUrl: data.gitRepositoryUrl,
            branch: data.branch,
            port: data.appPort,
            domain: data.domain,
            environmentVariables: {
              create: data.environmentVariables.map((env) => ({
                key: env.key,
                value: env.value,
              })),
            },
          },
          ...(data.enablePostgres
            ? [{
                name: POSTGRES_SERVICE_NAME,
                type: 'postgres' as const,
              }]
            : []),
        ],
      },
    },
    include: {
      services: {
        include: { environmentVariables: true },
      },
    },
  })
}

export async function updateProjectFromInput(projectId: string, data: UpdateProjectInput) {
  return prisma.$transaction(async (tx) => {
    const services = await tx.service.findMany({
      where: { projectId },
    })

    const app = getPrimaryAppService(services)
    const postgres = services.find((s) => s.type === 'postgres')

    await tx.environmentVariable.deleteMany({
      where: { serviceId: app.id },
    })

    await tx.service.update({
      where: { id: app.id },
      data: {
        gitRepositoryUrl: data.gitRepositoryUrl,
        branch: data.branch,
        port: data.appPort,
        domain: data.domain,
        environmentVariables: {
          create: data.environmentVariables.map((env) => ({
            key: env.key,
            value: env.value,
          })),
        },
      },
    })

    if (data.enablePostgres && !postgres) {
      await tx.service.create({
        data: {
          projectId,
          name: POSTGRES_SERVICE_NAME,
          type: 'postgres',
        },
      })
    } else if (!data.enablePostgres && postgres) {
      await tx.service.delete({
        where: { id: postgres.id },
      })
    }

    return tx.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        services: {
          include: { environmentVariables: true },
        },
      },
    })
  })
}

export async function loadProjectWithServices(projectId: string) {
  return prisma.project.findUnique({
    where: { id: projectId },
    include: {
      services: {
        include: { environmentVariables: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
}
