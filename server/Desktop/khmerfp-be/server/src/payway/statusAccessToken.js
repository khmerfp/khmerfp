import { createHash, randomBytes } from 'node:crypto'

export const STATUS_ACCESS_TOKEN_BYTES = 32

// generate one browser-only access token
export function generateStatusAccessToken() {
  return randomBytes(STATUS_ACCESS_TOKEN_BYTES).toString('base64url')
}

// hash one access token for storage
export function hashStatusAccessToken(token) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new TypeError('Status access token is required.')
  }

  return createHash('sha256').update(token, 'utf8').digest('hex')
}
