import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CheckoutUnavailableError,
  formatKhrAmount,
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

test('revalidates payment details before persistence', async () => {
  await assert.rejects(
    prepareSandboxCheckout(paymentDetails({ amount: 2 }), { config }),
    PaymentDetailsValidationError,
  )
})

test('persists pending details before signing and returns no secret', async () => {
  let persisted = false
  let signedFields
  const checkout = await prepareSandboxCheckout(paymentDetails(), {
    config,
    now: () => new Date('2026-09-21T12:34:56.000Z'),
    prepareTransaction: async (details) => {
      assert.deepEqual(details, paymentDetails())
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
  assert.equal(checkout.fields.amount, signedFields.amount)
  assert.equal(checkout.fields.currency, signedFields.currency)
  assert.equal(Object.hasOwn(checkout.fields, 'payment_option'), false)
  assert.equal(
    checkout.action,
    'https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/purchase',
  )
  assert.equal(checkout.fields.hash, 'fictional-signature')
  assert.equal(checkout.transaction.status, 'PENDING')
  assert.equal(JSON.stringify(checkout).includes(config.credentials.apiKey), false)
  assert.equal(JSON.stringify(checkout).includes('accountNumber'), false)
  assert.deepEqual(Object.keys(checkout.fields).sort(), [
    'amount', 'cancel_url', 'continue_success_url', 'currency', 'hash',
    'merchant_id', 'req_time', 'tran_id',
  ])
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
