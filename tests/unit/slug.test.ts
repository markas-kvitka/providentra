import { describe, expect, it } from 'vitest'
import { getComposeProjectName, getProjectDir, toSlug } from '../../lib/slug'

describe('slug helpers', () => {
  it('slugifies names to lowercase strict slugs', () => {
    expect(toSlug('My Cool App!')).toBe('my-cool-app')
  })

  it('builds compose project names', () => {
    expect(getComposeProjectName('my-app')).toBe('providentra-my-app')
  })

  it('builds project directories under runtime', () => {
    expect(getProjectDir('./runtime', 'my-app')).toBe('./runtime/projects/my-app')
  })
})
