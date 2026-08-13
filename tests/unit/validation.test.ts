import { describe, expect, it } from 'vitest'
import {
  createProjectSchema,
  gitRepositoryUrlSchema,
  updateProjectSchema,
} from '../../server/utils/validation'

describe('gitRepositoryUrlSchema', () => {
  it.each([
    'https://github.com/acme/app.git',
    'http://example.com/repo',
    'ssh://git@github.com/acme/app.git',
    'git@github.com:acme/app.git',
  ])('accepts %s', (url) => {
    expect(gitRepositoryUrlSchema.parse(url)).toBe(url)
  })

  it('rejects https:/host without //', () => {
    const result = gitRepositoryUrlSchema.safeParse('https:/github.com/acme/app')
    expect(result.success).toBe(false)
  })

  it('rejects empty string', () => {
    expect(gitRepositoryUrlSchema.safeParse('').success).toBe(false)
  })
})

describe('createProjectSchema', () => {
  const valid = {
    name: 'My App',
    gitRepositoryUrl: 'https://github.com/acme/app.git',
    domain: 'myapp.localhost',
  }

  it('accepts a minimal valid body and applies defaults', () => {
    const parsed = createProjectSchema.parse(valid)
    expect(parsed.branch).toBe('main')
    expect(parsed.appPort).toBe(3000)
    expect(parsed.enablePostgres).toBe(false)
    expect(parsed.environmentVariables).toEqual([])
  })

  it('rejects empty name', () => {
    expect(createProjectSchema.safeParse({ ...valid, name: '' }).success).toBe(false)
  })
})

describe('updateProjectSchema', () => {
  it('requires all fields including enablePostgres', () => {
    const parsed = updateProjectSchema.parse({
      gitRepositoryUrl: 'https://github.com/acme/app.git',
      branch: 'develop',
      appPort: 8080,
      domain: 'app.localhost',
      enablePostgres: true,
      environmentVariables: [{ key: 'FOO', value: 'bar' }],
    })
    expect(parsed.enablePostgres).toBe(true)
    expect(parsed.environmentVariables).toHaveLength(1)
  })
})
