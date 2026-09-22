import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CheckoutUnavailableError,
  formatKhrAmount,
  prepareCheckout,
  prepareSandboxCheckout,
} from '../src/services/checkoutPreparationService.js'
import { PaymentDetailsValidationError } from '../src/services/pendingTransactionService.js'

const config = Object.freeze({
  environment: 'sandbox',
  checkoutEnabled: true,
  endpoints: Object.freeze({
    purchase: 'https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/purchase',
  }),
  credentials: Object.freeze({
    merchantId: 'fictional-merchant',
    apiKey: 'fictional-public-key',
  }),
  navigation: Object.freeze({
    successUrl: 'https://example.test/payment/result',
    cancelUrl: 'https://example.test/payment/cancel',
  }),
})

// build fictional payment details
function paymentDetails(overrides = {}) {
  return {
    name: 'Example Sender',
    accountNumber: '00001234',
    amount: 2000,
    ...overrides,
  }
}

test('formats khr as a whole-number string', () => {
  assert.equal(formatKhrAmount(1), '1')
  assert.equal(formatKhrAmount(2000), '2000')
  assert.throws(() => formatKhrAmount(1.5))
})

test('refuses checkout while disabled before persistence', async () => {
  let persistenceCalled = false

  await assert.rejects(
    prepareSandboxCheckout(paymentDetails(), {
      config: { ...config, checkoutEnabled: false },
      prepareTransaction: async () => {
        persistenceCalled = true
      },
    }),
    CheckoutUnavailableError,
  )
  assert.equal(persistenceCalled, false)
})

test('uses the selected environment contract without mixing endpoints', async () => {
  const productionConfig = {
    ...config,
    environment: 'production',
    endpoints: { purchase: 'https://checkout.payway.com.kh/purchase' },
    credentials: {
      merchantId: 'fictional-production-merchant',
      apiKey: 'fictional-production-key',
    },
  }
  const checkout = await prepareCheckout(paymentDetails(), {
    config: productionConfig,
    createStatusToken: () => 'A'.repeat(43),
    prepareTransaction: async () => ({
      tranId: '12345678901234567890',
      amount: 2000,
      currency: 'KHR',
      status: 'PENDING',
    }),
    signer: (fields, secret) => {
      assert.equal(fields.merchant_id, 'fictional-production-merchant')
      assert.equal(secret, 'fictional-production-key')
      return 'fictional-signature'
    },
  })

  assert.equal(checkout.environment, 'production')
  assert.equal(checkout.action, productionConfig.endpoints.purchase)
})

test('revalidates payment details before persistence', async () => {
  await assert.rejects(
    prepareSandboxCheckout(paymentDetails({ amount: 2 }), { config }),
    PaymentDetailsValidationError,
  )
})

test('persists pending details before signing and returns no secret', async () => {
  let persisted = false
  let signedFields
  const statusToken = 'A'.repeat(43)
  const statusTokenHash = 'b'.repeat(64)
  const checkout = await prepareSandboxCheckout(paymentDetails(), {
    config,
    now: () => new Date('2026-09-21T12:34:56.000Z'),
    createStatusToken: () => statusToken,
    hashStatusToken: (token) => {
      assert.equal(token, statusToken)
      return statusTokenHash
    },
    prepareTransaction: async (details, options) => {
      assert.deepEqual(details, paymentDetails())
      assert.deepEqual(options, { statusAccessTokenHash: statusTokenHash })
      persisted = true
      return {
        tranId: '12345678901234567890',
        amount: 2000,
        currency: 'KHR',
        status: 'PENDING',
      }
    },
    signer: (fields, secret) => {
      assert.equal(persisted, true)
      assert.equal(secret, 'fictional-public-key')
      signedFields = structuredClone(fields)
      return 'fictional-signature'
    },
  })

  assert.equal(checkout.fields.amount, '2000')
  assert.equal(checkout.fields.currency, 'KHR')
  assert.equal(checkout.fields.view_type, 'hosted_view')
  assert.equal(checkout.fields.payment_gate, '0')
  assert.equal(checkout.fields.amount, signedFields.amount)
  assert.equal(checkout.fields.currency, signedFields.currency)
  assert.equal(Object.hasOwn(checkout.fields, 'payment_option'), false)
  assert.equal(
    checkout.action,
    'https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/purchase',
  )
  assert.equal(checkout.fields.hash, 'fictional-signature')
  assert.equal(checkout.transaction.status, 'PENDING')
  assert.deepEqual(checkout.statusAccess, {
    tranId: '12345678901234567890',
    token: statusToken,
  })
  assert.equal(checkout.fields.cancel_url, 'https://example.test/payment/cancel?tran_id=12345678901234567890')
  assert.equal(checkout.fields.continue_success_url, 'https://example.test/payment/result?tran_id=12345678901234567890')
  assert.equal(JSON.stringify(checkout.fields).includes(statusToken), false)
  assert.equal(JSON.stringify(checkout).includes(config.credentials.apiKey), false)
  assert.equal(JSON.stringify(checkout).includes('accountNumber'), false)
  assert.deepEqual(Object.keys(checkout.fields).sort(), [
    'amount', 'cancel_url', 'continue_success_url', 'currency', 'hash',
    'merchant_id', 'payment_gate', 'req_time', 'tran_id', 'view_type',
  ])
})

// verify exact one khr checkout values
test('preserves exact 1 KHR values through persistence and signing', async () => {
  let signedFields
  const checkout = await prepareSandboxCheckout(paymentDetails({ amount: 1 }), {
    config,
    createStatusToken: () => 'A'.repeat(43),
    prepareTransaction: async (details) => {
      assert.equal(details.amount, 1)
      return {
        tranId: '12345678901234567890',
        amount: details.amount,
        currency: 'KHR',
        status: 'PENDING',
      }
    },
    signer: (fields) => {
      signedFields = structuredClone(fields)
      return 'fictional-signature'
    },
  })

  assert.equal(signedFields.amount, '1')
  assert.equal(signedFields.currency, 'KHR')
  assert.equal(checkout.fields.amount, '1')
  assert.equal(checkout.fields.currency, 'KHR')
  assert.equal(checkout.transaction.amount, 1)
  assert.equal(checkout.transaction.currency, 'KHR')
})

test('does not sign or respond when validation or persistence fails', async () => {
  for (const failure of [
    new PaymentDetailsValidationError({ amount: 'Invalid amount.' }),
    new Error('database unavailable'),
  ]) {
    let signerCalled = false

    await assert.rejects(
      prepareSandboxCheckout(paymentDetails(), {
        config,
        prepareTransaction: async () => {
          throw failure
        },
        signer: () => {
          signerCalled = true
        },
      }),
      (error) => error === failure,
    )
    assert.equal(signerCalled, false)
  }
})
