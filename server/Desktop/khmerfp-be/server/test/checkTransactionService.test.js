import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CheckTransactionError,
  checkTransaction,
  checkSandboxTransaction,
  normalizeCheckTransactionResponse,
} from '../src/services/checkTransactionService.js'

const transactionId = '00012345678901234567'
const config = Object.freeze({
  environment: 'sandbox',
  endpoints: Object.freeze({
    checkTransaction:
      'https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/check-transaction-2',
  }),
  credentials: Object.freeze({
    merchantId: 'fictional-merchant',
    apiKey: 'fictional-public-key',
  }),
})

// build one fictional provider response
function providerResponse(paymentStatusCode, paymentStatus, overrides = {}) {
  return {
    data: {
      payment_status_code: paymentStatusCode,
      original_amount: 2000,
      total_amount: 2000,
      payment_amount: paymentStatusCode === 0 ? 2000 : 0,
      payment_currency: 'KHR',
      payment_status: paymentStatus,
      ...overrides.data,
    },
    status: {
      code: '00',
      message: 'Success!',
      tran_id: transactionId,
      ...overrides.status,
    },
  }
}

// build one mocked json response
function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  }
}

for (const [code, status, outcome, approved] of [
  [0, 'APPROVED', 'APPROVED', true],
  [2, 'PENDING', 'PENDING', false],
  [3, 'DECLINED', 'DECLINED', false],
  [7, 'CANCELLED', 'CANCELLED', false],
]) {
  test(`normalizes documented ${status} outcome without verifying it`, () => {
    const result = normalizeCheckTransactionResponse(
      providerResponse(code, status),
      transactionId,
    )

    assert.equal(result.apiSuccess, true)
    assert.equal(result.outcome, outcome)
    assert.equal(result.paymentApproved, approved)
    assert.equal(result.verification, 'UNVERIFIED')
    assert.equal(result.provider.paymentStatusCode, String(code))
    assert.equal(result.amounts.originalAmount, 2000)
    assert.equal(result.amounts.paymentCurrency, 'KHR')
    assert.equal(result.amounts.originalCurrency, null)
  })
}

test('treats an unexpected payment status as unknown', () => {
  const result = normalizeCheckTransactionResponse(
    providerResponse(99, 'MYSTERY'),
    transactionId,
  )

  assert.equal(result.apiSuccess, true)
  assert.equal(result.outcome, 'UNKNOWN')
  assert.equal(result.paymentApproved, false)
  assert.equal(result.reason, 'UNEXPECTED_PAYMENT_STATUS')
})

test('keeps a successful api response separate from payment approval', () => {
  const result = normalizeCheckTransactionResponse(
    providerResponse(2, 'PENDING'),
    transactionId,
  )

  assert.equal(result.apiSuccess, true)
  assert.equal(result.paymentApproved, false)
  assert.equal(result.outcome, 'PENDING')
})

test('normalizes provider api errors without treating them as payment failures', () => {
  const result = normalizeCheckTransactionResponse(
    {
      status: { code: 12, message: 'Fictional API error', tran_id: transactionId },
    },
    transactionId,
  )

  assert.equal(result.apiSuccess, false)
  assert.equal(result.outcome, 'UNKNOWN')
  assert.equal(result.reason, 'API_ERROR')
  assert.equal(result.provider.apiCode, '12')
})

test('rejects mismatched response transaction ids as unknown', () => {
  const result = normalizeCheckTransactionResponse(
    providerResponse(0, 'APPROVED', {
      status: { tran_id: '99999999999999999999' },
    }),
    transactionId,
  )

  assert.equal(result.apiSuccess, true)
  assert.equal(result.outcome, 'UNKNOWN')
  assert.equal(result.paymentApproved, false)
  assert.equal(result.reason, 'TRANSACTION_ID_MISMATCH')
})

test('returns unknown when response verification fields are missing', () => {
  const missingStatus = normalizeCheckTransactionResponse(
    { status: { code: '00', tran_id: transactionId }, data: {} },
    transactionId,
  )
  const missingAmounts = normalizeCheckTransactionResponse(
    providerResponse(0, 'APPROVED', {
      data: { original_amount: undefined },
    }),
    transactionId,
  )

  assert.equal(missingStatus.reason, 'MISSING_PAYMENT_STATUS')
  assert.equal(missingStatus.paymentApproved, false)
  assert.equal(missingAmounts.reason, 'MISSING_RECONCILIATION_FIELDS')
  assert.equal(missingAmounts.paymentApproved, false)
})

test('sends the documented sandbox json request and preserves id digits', async () => {
  let requestedUrl
  let requestedOptions
  const result = await checkSandboxTransaction(transactionId, {
    config,
    now: () => new Date('2026-09-21T12:34:56.000Z'),
    signer: (fields, secret) => {
      assert.equal(fields.tran_id, transactionId)
      assert.equal(secret, 'fictional-public-key')
      return 'fictional-signature'
    },
    transport: async (url, options) => {
      requestedUrl = url
      requestedOptions = options
      return jsonResponse(providerResponse(0, 'APPROVED'))
    },
  })
  const requestBody = JSON.parse(requestedOptions.body)

  assert.equal(
    requestedUrl,
    'https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/check-transaction-2',
  )
  assert.equal(requestedOptions.method, 'POST')
  assert.equal(requestedOptions.headers['Content-Type'], 'application/json')
  assert.equal(typeof requestBody.tran_id, 'string')
  assert.equal(requestBody.tran_id, transactionId)
  assert.deepEqual(Object.keys(requestBody).sort(), [
    'hash', 'merchant_id', 'req_time', 'tran_id',
  ])
  assert.equal(result.outcome, 'APPROVED')
  assert.equal(result.verification, 'UNVERIFIED')
})

test('uses only the selected production endpoint and credentials', async () => {
  let requestedUrl
  const productionConfig = {
    ...config,
    environment: 'production',
    endpoints: {
      checkTransaction:
        'https://checkout.payway.com.kh/api/payment-gateway/v1/payments/check-transaction-2',
    },
    credentials: {
      merchantId: 'fictional-production-merchant',
      apiKey: 'fictional-production-key',
    },
  }

  await checkTransaction(transactionId, {
    config: productionConfig,
    signer: (fields, secret) => {
      assert.equal(fields.merchant_id, 'fictional-production-merchant')
      assert.equal(secret, 'fictional-production-key')
      return 'fictional-signature'
    },
    transport: async (url) => {
      requestedUrl = url
      return jsonResponse(providerResponse(2, 'PENDING'))
    },
  })

  assert.equal(requestedUrl, productionConfig.endpoints.checkTransaction)
})

test('handles non-2xx and invalid json responses safely', async () => {
  await assert.rejects(
    checkSandboxTransaction(transactionId, {
      config,
      transport: async () => jsonResponse({}, { ok: false, status: 503 }),
    }),
    (error) => error instanceof CheckTransactionError && error.code === 'HTTP_ERROR',
  )

  await assert.rejects(
    checkSandboxTransaction(transactionId, {
      config,
      transport: async () => ({
        ok: true,
        json: async () => {
          throw new SyntaxError('fictional invalid json')
        },
      }),
    }),
    (error) => error instanceof CheckTransactionError && error.code === 'INVALID_JSON',
  )
})

test('handles malformed response data as unknown', async () => {
  const result = await checkSandboxTransaction(transactionId, {
    config,
    transport: async () => jsonResponse([]),
  })

  assert.equal(result.outcome, 'UNKNOWN')
  assert.equal(result.reason, 'MALFORMED_RESPONSE')
})

test('bounds the request with a timeout', async () => {
  await assert.rejects(
    checkSandboxTransaction(transactionId, {
      config,
      timeoutMs: 5,
      transport: async () => new Promise(() => {}),
    }),
    (error) => error instanceof CheckTransactionError && error.code === 'TIMEOUT',
  )
})

test('handles network failures without exposing request details', async () => {
  await assert.rejects(
    checkSandboxTransaction(transactionId, {
      config,
      transport: async () => {
        throw new Error('fictional network failure')
      },
    }),
    (error) =>
      error instanceof CheckTransactionError
      && error.code === 'NETWORK_FAILURE'
      && !error.message.includes(transactionId),
  )
})

test('rejects non-string ids and unknown environments before transport', async () => {
  let transportCalled = false

  await assert.rejects(
    checkSandboxTransaction(123, { config }),
    (error) => error.code === 'INVALID_TRANSACTION_ID',
  )
  await assert.rejects(
    checkSandboxTransaction(transactionId, {
      config: { ...config, environment: 'staging' },
      transport: async () => {
        transportCalled = true
      },
    }),
    (error) => error.code === 'ENVIRONMENT_NOT_ALLOWED',
  )
  assert.equal(transportCalled, false)
})
