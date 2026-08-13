import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, prisma } from '../../lib/db'
import {
  createProjectFromInput,
  toProjectDetail,
  updateProjectFromInput,
} from '../../lib/project-facade'
import { isEncryptedSecret } from '../../lib/secrets'

describe('project-facade DB', () => {
  let userId: string

  beforeAll(async () => {
    userId = randomUUID()
    await prisma.user.create({
      data: {
        id: userId,
        name: 'Test User',
        email: `test-${userId}@example.com`,
        emailVerified: false,
      },
    })
  })

  afterEach(async () => {
    await prisma.project.deleteMany({ where: { userId } })
  })

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
    await closeDb()
  })

  it('creates a project with encrypted env vars and optional postgres', async () => {
    const project = await createProjectFromInput(
      {
        name: 'Integration App',
        gitRepositoryUrl: 'https://github.com/acme/app.git',
        branch: 'main',
        appPort: 3000,
        domain: 'integration.localhost',
        enablePostgres: true,
        environmentVariables: [{ key: 'SECRET', value: 'plain-secret' }],
      },
      `integration-${randomUUID().slice(0, 8)}`,
      userId,
    )

    expect(project.services.map((s) => s.type).sort()).toEqual(['app', 'postgres'])

    const web = project.services.find((s) => s.type === 'app')!
    expect(web.environmentVariables).toHaveLength(1)
    expect(isEncryptedSecret(web.environmentVariables[0]!.value)).toBe(true)

    const detail = toProjectDetail(project)
    expect(detail.enablePostgres).toBe(true)
    expect(detail.environmentVariables).toEqual([{ key: 'SECRET', value: 'plain-secret' }])
  })

  it('updates project settings, replaces env vars, and toggles postgres off', async () => {
    const created = await createProjectFromInput(
      {
        name: 'Updatable App',
        gitRepositoryUrl: 'https://github.com/acme/app.git',
        branch: 'main',
        appPort: 3000,
        domain: 'update.localhost',
        enablePostgres: true,
        environmentVariables: [{ key: 'OLD', value: 'one' }],
      },
      `update-${randomUUID().slice(0, 8)}`,
      userId,
    )

    const updated = await updateProjectFromInput(created.id, {
      gitRepositoryUrl: 'https://github.com/acme/app.git',
      branch: 'develop',
      appPort: 4000,
      domain: 'updated.localhost',
      enablePostgres: false,
      environmentVariables: [{ key: 'NEW', value: 'two' }],
    })

    const detail = toProjectDetail(updated)
    expect(detail.branch).toBe('develop')
    expect(detail.appPort).toBe(4000)
    expect(detail.domain).toBe('updated.localhost')
    expect(detail.enablePostgres).toBe(false)
    expect(detail.environmentVariables).toEqual([{ key: 'NEW', value: 'two' }])
    expect(updated.services.some((s) => s.type === 'postgres')).toBe(false)
  })
})
