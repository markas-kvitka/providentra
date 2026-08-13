import { describe, expect, it } from 'vitest'
import {
  containerNameForService,
  findPrimaryAppService,
  getPrimaryAppService,
  hasPostgresService,
  projectHasManagedVolumes,
  toProjectDetail,
  type ProjectWithServices,
} from '../../lib/project-facade'
import { encryptSecret } from '../../lib/secrets'

describe('project-facade helpers', () => {
  const web = {
    id: 'svc-web',
    name: 'web',
    type: 'app' as const,
    gitRepositoryUrl: 'https://github.com/acme/app.git',
    branch: 'main',
    port: 3000,
    domain: 'app.localhost',
  }

  const otherApp = {
    id: 'svc-api',
    name: 'api',
    type: 'app' as const,
    gitRepositoryUrl: 'https://github.com/acme/api.git',
    branch: 'main',
    port: 4000,
    domain: 'api.localhost',
  }

  const postgres = {
    id: 'svc-pg',
    name: 'postgres',
    type: 'postgres' as const,
    gitRepositoryUrl: null,
    branch: null,
    port: null,
    domain: null,
  }

  it('prefers the web app service as primary', () => {
    expect(findPrimaryAppService([otherApp, web])?.name).toBe('web')
  })

  it('falls back to any app service', () => {
    expect(findPrimaryAppService([otherApp])?.name).toBe('api')
  })

  it('throws when no app service exists', () => {
    expect(() => getPrimaryAppService([postgres])).toThrow(/no app service/)
  })

  it('detects postgres services', () => {
    expect(hasPostgresService([web, postgres])).toBe(true)
    expect(hasPostgresService([web])).toBe(false)
  })

  it('builds container names from recipes or app default', () => {
    expect(containerNameForService('demo', 'postgres')).toBe('providentra-demo-postgres')
    expect(containerNameForService('demo', 'app')).toBe('providentra-demo-app')
  })

  it('detects managed volumes', () => {
    expect(projectHasManagedVolumes([web, postgres])).toBe(true)
    expect(projectHasManagedVolumes([web])).toBe(false)
  })

  it('maps project to detail and decrypts env values', () => {
    const encrypted = encryptSecret('secret-value')
    const project = {
      id: 'proj-1',
      name: 'Demo',
      slug: 'demo',
      userId: 'user-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      services: [
        {
          ...web,
          projectId: 'proj-1',
          deploymentId: null,
          containerName: null,
          status: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          environmentVariables: [
            { id: 'env-1', serviceId: web.id, key: 'API_KEY', value: encrypted },
          ],
        },
        {
          ...postgres,
          projectId: 'proj-1',
          deploymentId: null,
          containerName: null,
          status: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          environmentVariables: [],
        },
      ],
    } satisfies ProjectWithServices

    const detail = toProjectDetail(project)
    expect(detail.enablePostgres).toBe(true)
    expect(detail.domain).toBe('app.localhost')
    expect(detail.environmentVariables).toEqual([{ key: 'API_KEY', value: 'secret-value' }])
  })
})
