import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateCallbackPayload } from '../src/validation/callbackValidation.js'

// build one valid callback payload
function validPayload(overrides = {}) {
  return {
    tran_id: '000123456789',
    apv: '123456',
    status: '0',
    original_amount: 2000,
    original_currency: 'KHR',
    payment_amount: 2000,
    payment_currency: 'KHR',
    total_amount: 2000,
    discount_amount: 0,
    transaction_date: '2026-09-22 10:20:30',
    ...overrides,
  }
}

test('preserves a valid callback transaction id as a string', () => {
  const result = validateCallbackPayload(validPayload())

  assert.equal(result.isValid, true)
  assert.equal(result.data.tranId, '000123456789')
})

test('rejects missing and incorrectly typed verification fields', () => {
  const payload = validPayload({
    tran_id: 123,
    status: 0,
    original_amount: '2000',
    original_currency: 'EUR',
    payment_amount: null,
    payment_currency: '',
  })
  delete payload.total_amount

  const result = validateCallbackPayload(payload)

  assert.equal(result.isValid, false)
  assert.deepEqual(Object.keys(result.errors).sort(), [
    'original_amount',
    'original_currency',
    'payment_amount',
    'payment_currency',
    'status',
    'total_amount',
    'tran_id',
  ])
})
