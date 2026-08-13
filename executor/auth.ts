import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export function tokensEqual(expected: string, provided: string): boolean {
  const expectedBuf = Buffer.from(expected)
  const providedBuf = Buffer.from(provided)
  if (expectedBuf.length !== providedBuf.length) {
    return false
  }
  return timingSafeEqual(expectedBuf, providedBuf)
}

export function isAuthorized(request: IncomingMessage, token: string | undefined): boolean {
  if (!token) {
    return false
  }

  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return false
  }

  const provided = header.slice('Bearer '.length).trim()
  return tokensEqual(token, provided)
}
