import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getHostedCheckoutEntries } from '../../client/src/services/api.js'

test('frontend submits one unchanged currency and amount field', () => {
  const entries = getHostedCheckoutEntries({
    fields: {
      req_time: '20260921123456',
      merchant_id: 'fictional-merchant',
      tran_id: '12345678901234567890',
      amount: '2000',
      cancel_url: 'https://example.test/payment/cancel',
      continue_success_url: 'https://example.test/payment/result',
      currency: 'KHR',
      hash: 'fictional-signature',
    },
  })

  assert.deepEqual(entries.filter(([name]) => name === 'currency'), [
    ['currency', 'KHR'],
  ])
  assert.deepEqual(entries.filter(([name]) => name === 'amount'), [
    ['amount', '2000'],
  ])
  assert.equal(entries.some(([name]) => name === 'payment_option'), false)
})
