import { createSha512Base64Hmac } from './hmac.js'

export const CHECK_TRANSACTION_SIGNING_FIELDS = Object.freeze([
  'req_time',
  'merchant_id',
  'tran_id',
])

// build the check transaction signing input
export function buildCheckTransactionSigningInput(fields) {
  return CHECK_TRANSACTION_SIGNING_FIELDS.map((fieldName) => {
    const value = fields[fieldName]

    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError(`Check Transaction field ${fieldName} is required.`)
    }

    return value
  }).join('')
}

// sign one check transaction request
export function signCheckTransaction(fields, secret) {
  return createSha512Base64Hmac(
    buildCheckTransactionSigningInput(fields),
    secret,
  )
}
