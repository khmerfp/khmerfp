import { createSha512Base64Hmac } from './hmac.js'

// list of the fieilds
// freeze to prevect pushing into arrays
export const PURCHASE_SIGNING_FIELDS = Object.freeze([
  'req_time',
  'merchant_id',
  'tran_id',
  'amount',
  'items',
  'shipping',
  'firstname',
  'lastname',
  'email',
  'phone',
  'type',
  'payment_option',
  'return_url',
  'cancel_url',
  'continue_success_url',
  'return_deeplink',
  'currency',
  'custom_fields',
  'return_params',
  'payout',
  'lifetime',
  'additional_params',
  'google_pay_token',
  'skip_success_page',
])

// build the official ordered signing input
export function buildPurchaseSigningInput(fields) {
  return PURCHASE_SIGNING_FIELDS.map((fieldName) => {
    const value = fields[fieldName]

    if (value === undefined || value === null) return ''

    // value must be string
    if (typeof value !== 'string') {
      throw new TypeError(`Purchase field ${fieldName} must be a string.`)
    }

    return value
  }).join('')
}

// create the purchase hmac signature
export function signPurchase(fields, secret) {
  const signingInput = buildPurchaseSigningInput(fields)
  return createSha512Base64Hmac(signingInput, secret)
}
