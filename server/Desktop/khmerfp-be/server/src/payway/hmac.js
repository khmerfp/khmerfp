import { createHmac } from 'node:crypto'

// create one sha512 base64 hmac
export function createSha512Base64Hmac(input, secret) {

  // check whether input string
  if (typeof input !== 'string') {
    throw new TypeError('HMAC input must be a string.')
  }

  // check whether string or empty
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new TypeError('HMAC secret is required.')
  }

  return createHmac('sha512', secret).update(input, 'utf8').digest('base64')
}
