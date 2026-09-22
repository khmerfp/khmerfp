import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  getProtectedPaymentStatus,
  PaymentStatusUnavailableError,
} from '../src/services/paymentStatusService.js'
import { hashStatusAccessToken } from '../src/payway/statusAccessToken.js'

const token = 'A'.repeat(43)
const tranId = '12345678901234567890'

// create one query-compatible transaction model
function modelReturning(value, inspectFilter = () => {}) {
  return {
    findOne(filter) {
      inspectFilter(filter)
      return { select: async () => value }
    },
  }
}

test('protected lookup hashes the token and returns only minimum fields', async () => {
  const result = await getProtectedPaymentStatus(tranId, token, {
    transactionModel: modelReturning({
      tranId,
      amount: 2000,
      currency: 'KHR',
      status: 'PAID',
      paidAt: new Date('2026-09-22T00:00:00Z'),
      name: 'Must not leak',
      accountNumber: '0001',
      verificationEvidence: { secret: true },
    }, (filter) => assert.deepEqual(filter, {
      tranId,
      statusAccessTokenHash: hashStatusAccessToken(token),
    })),
  })

  assert.deepEqual(Object.keys(result), ['tranId', 'amount', 'currency', 'status', 'paidAt'])
  assert.equal(JSON.stringify(result).includes('Must not leak'), false)
  assert.equal(JSON.stringify(result).includes('0001'), false)
})

test('unknown transactions and incorrect tokens use the same unavailable error', async () => {
  for (const suppliedToken of [token, 'B'.repeat(43), undefined]) {
    await assert.rejects(
      getProtectedPaymentStatus(tranId, suppliedToken, {
        transactionModel: modelReturning(null),
      }),
      PaymentStatusUnavailableError,
    )
  }
})

test('status lookup wraps database failures without exposing details', async () => {
  await assert.rejects(
    getProtectedPaymentStatus(tranId, token, {
      transactionModel: { findOne: () => { throw new Error('private database detail') } },
    }),
    /Payment status lookup failed/,
  )
})
