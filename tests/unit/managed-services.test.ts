import { describe, expect, it } from 'vitest'
import {
  collectAppInjectEnv,
  isManagedServiceKey,
  listManagedRecipes,
  tryGetManagedRecipe,
} from '../../lib/managed-services'

describe('managed-services', () => {
  it('lists postgres and redis recipes', () => {
    const keys = listManagedRecipes().map((r) => r.key).sort()
    expect(keys).toEqual(['postgres', 'redis'])
  })

  it('identifies managed service keys', () => {
    expect(isManagedServiceKey('postgres')).toBe(true)
    expect(isManagedServiceKey('redis')).toBe(true)
    expect(isManagedServiceKey('app')).toBe(false)
  })

  it('returns recipes for known keys', () => {
    expect(tryGetManagedRecipe('postgres')?.networkAlias).toBe('postgres')
    expect(tryGetManagedRecipe('unknown')).toBeUndefined()
  })

  it('collects inject env for selected managed types and ignores unknowns', () => {
    const env = collectAppInjectEnv(['postgres', 'redis', 'nope'])
    expect(env).toContain('DATABASE_URL=postgresql://app:app@postgres:5432/app')
    expect(env).toContain('REDIS_URL=redis://redis:6379')
    expect(env).toHaveLength(2)
  })
})
