import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import { isAuthorized, tokensEqual } from '../../executor/auth'

function requestWithAuth(authorization?: string): IncomingMessage {
  return { headers: { authorization } } as IncomingMessage
}

describe('executor auth', () => {
  it('tokensEqual returns true for identical tokens', () => {
    expect(tokensEqual('abc', 'abc')).toBe(true)
  })

  it('tokensEqual returns false for different lengths', () => {
    expect(tokensEqual('abc', 'ab')).toBe(false)
  })

  it('tokensEqual returns false for different values of same length', () => {
    expect(tokensEqual('abc', 'abd')).toBe(false)
  })

  it('isAuthorized accepts a valid Bearer token', () => {
    expect(isAuthorized(requestWithAuth('Bearer secret'), 'secret')).toBe(true)
  })

  it('isAuthorized rejects missing token config', () => {
    expect(isAuthorized(requestWithAuth('Bearer secret'), undefined)).toBe(false)
    expect(isAuthorized(requestWithAuth('Bearer secret'), '')).toBe(false)
  })

  it('isAuthorized rejects missing or non-Bearer headers', () => {
    expect(isAuthorized(requestWithAuth(undefined), 'secret')).toBe(false)
    expect(isAuthorized(requestWithAuth('Basic secret'), 'secret')).toBe(false)
  })

  it('isAuthorized rejects wrong token', () => {
    expect(isAuthorized(requestWithAuth('Bearer wrong'), 'secret')).toBe(false)
  })
})
