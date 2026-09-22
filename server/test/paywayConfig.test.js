import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  getPayWayConfig,
  PAYWAY_ENDPOINTS,
  PayWayConfigurationError,
} from '../src/config/payway.js'

test('defaults to sandbox with checkout disabled and no required credentials', () => {
  const config = getPayWayConfig({})

  assert.equal(config.environment, 'sandbox')
  assert.equal(config.checkoutEnabled, false)
  assert.equal(config.credentials.merchantId, undefined)
  assert.equal(config.credentials.apiKey, undefined)
  assert.equal(config.callback.secret, undefined)
  assert.equal(config.navigation.successUrl, undefined)
  assert.equal(config.navigation.cancelUrl, undefined)
})

test('uses fixed official endpoint mappings for sandbox and production', () => {
  assert.deepEqual(PAYWAY_ENDPOINTS, {
    sandbox: {
      purchase:
        'https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/purchase',
      checkTransaction:
        'https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/check-transaction-2',
    },
    production: {
      purchase: 'https://checkout.payway.com.kh/api/payment-gateway/v1/payments/purchase',
      checkTransaction:
        'https://checkout.payway.com.kh/api/payment-gateway/v1/payments/check-transaction-2',
    },
  })

  assert.equal(
    getPayWayConfig({ PAYWAY_ENV: 'production' }).endpoints,
    PAYWAY_ENDPOINTS.production,
  )
})

for (const value of ['', 'staging', 'SANDBOX', 'sandbox ']) {
  test(`rejects invalid PAYWAY_ENV value ${JSON.stringify(value)}`, () => {
    assert.throws(
      () => getPayWayConfig({ PAYWAY_ENV: value }),
      PayWayConfigurationError,
    )
  })
}

for (const value of ['', 'TRUE', 'False', '1', 'yes', true]) {
  test(`rejects non-strict checkout boolean ${JSON.stringify(value)}`, () => {
    assert.throws(
      () => getPayWayConfig({ PAYWAY_CHECKOUT_ENABLED: value }),
      PayWayConfigurationError,
    )
  })
}

test('requires sandbox credentials and navigation urls when checkout is enabled', () => {
  const enabled = { PAYWAY_ENV: 'sandbox', PAYWAY_CHECKOUT_ENABLED: 'true' }

  assert.throws(() => getPayWayConfig(enabled), PayWayConfigurationError)
  assert.throws(
    () =>
      getPayWayConfig({
        ...enabled,
        PAYWAY_SANDBOX_MERCHANT_ID: 'sandbox-merchant',
        PAYWAY_SANDBOX_SUCCESS_URL: 'http://localhost:5173/payment/result',
        PAYWAY_SANDBOX_CANCEL_URL: 'http://localhost:5173/payment/cancel',
      }),
    PayWayConfigurationError,
  )
  assert.throws(
    () =>
      getPayWayConfig({
        ...enabled,
        PAYWAY_SANDBOX_API_KEY: 'sandbox-api-key',
        PAYWAY_SANDBOX_SUCCESS_URL: 'http://localhost:5173/payment/result',
        PAYWAY_SANDBOX_CANCEL_URL: 'http://localhost:5173/payment/cancel',
      }),
    PayWayConfigurationError,
  )
})

test('accepts sandbox credentials only when both are present', () => {
  const config = getPayWayConfig({
    PAYWAY_ENV: 'sandbox',
    PAYWAY_CHECKOUT_ENABLED: 'true',
    PAYWAY_SANDBOX_MERCHANT_ID: ' sandbox-merchant ',
    PAYWAY_SANDBOX_API_KEY: ' sandbox-api-key ',
    PAYWAY_SANDBOX_SUCCESS_URL: ' http://localhost:5173/payment/result ',
    PAYWAY_SANDBOX_CANCEL_URL: ' http://localhost:5173/payment/cancel ',
  })

  assert.equal(config.checkoutEnabled, true)
  assert.equal(config.credentials.merchantId, 'sandbox-merchant')
  assert.equal(config.credentials.apiKey, 'sandbox-api-key')
  assert.equal(config.navigation.successUrl, 'http://localhost:5173/payment/result')
  assert.equal(config.navigation.cancelUrl, 'http://localhost:5173/payment/cancel')
})

test('keeps the callback secret separate and optional', () => {
  const config = getPayWayConfig({
    PAYWAY_SANDBOX_API_KEY: 'purchase-secret',
    PAYWAY_SANDBOX_CALLBACK_SECRET: ' callback-secret ',
  })

  assert.equal(config.credentials.apiKey, 'purchase-secret')
  assert.equal(config.callback.secret, 'callback-secret')
  assert.notEqual(config.callback.secret, config.credentials.apiKey)
})

test('selects only production configuration when production is selected', () => {
  const config = getPayWayConfig({
    PAYWAY_ENV: 'production',
    PAYWAY_CHECKOUT_ENABLED: 'false',
    PAYWAY_SANDBOX_MERCHANT_ID: 'sandbox-merchant',
    PAYWAY_SANDBOX_API_KEY: 'sandbox-api-key',
    PAYWAY_SANDBOX_CALLBACK_SECRET: 'sandbox-callback-secret',
    PAYWAY_SANDBOX_SUCCESS_URL: 'http://localhost:5173/payment/result',
    PAYWAY_SANDBOX_CANCEL_URL: 'http://localhost:5173/payment/cancel',
    PAYWAY_PRODUCTION_MERCHANT_ID: ' production-merchant ',
    PAYWAY_PRODUCTION_API_KEY: ' production-api-key ',
    PAYWAY_PRODUCTION_CALLBACK_SECRET: ' production-callback-secret ',
    PAYWAY_PRODUCTION_SUCCESS_URL: ' https://pay.example.test/payment/result ',
    PAYWAY_PRODUCTION_CANCEL_URL: ' https://pay.example.test/payment/cancel ',
  })

  assert.equal(config.credentials.merchantId, 'production-merchant')
  assert.equal(config.credentials.apiKey, 'production-api-key')
  assert.equal(config.callback.secret, 'production-callback-secret')
  assert.equal(config.navigation.successUrl, 'https://pay.example.test/payment/result')
  assert.equal(config.navigation.cancelUrl, 'https://pay.example.test/payment/cancel')
})

test('does not fall back to sandbox values in production', () => {
  const config = getPayWayConfig({
    PAYWAY_ENV: 'production',
    PAYWAY_SANDBOX_MERCHANT_ID: 'sandbox-merchant',
    PAYWAY_SANDBOX_API_KEY: 'sandbox-api-key',
    PAYWAY_SANDBOX_CALLBACK_SECRET: 'sandbox-callback-secret',
    PAYWAY_SANDBOX_SUCCESS_URL: 'https://sandbox.example.test/payment/result',
    PAYWAY_SANDBOX_CANCEL_URL: 'https://sandbox.example.test/payment/cancel',
  })

  assert.equal(config.credentials.merchantId, undefined)
  assert.equal(config.credentials.apiKey, undefined)
  assert.equal(config.callback.secret, undefined)
  assert.equal(config.navigation.successUrl, undefined)
  assert.equal(config.navigation.cancelUrl, undefined)
})

test('refuses production checkout activation even when sandbox credentials exist', () => {
  assert.throws(
    () =>
      getPayWayConfig({
        PAYWAY_ENV: 'production',
        PAYWAY_CHECKOUT_ENABLED: 'true',
        PAYWAY_SANDBOX_MERCHANT_ID: 'sandbox-merchant',
        PAYWAY_SANDBOX_API_KEY: 'sandbox-api-key',
        PAYWAY_SANDBOX_SUCCESS_URL: 'https://example.test/payment/result',
        PAYWAY_SANDBOX_CANCEL_URL: 'https://example.test/payment/cancel',
      }),
    /cannot be enabled in production/,
  )
})

test('rejects invalid sandbox navigation urls', () => {
  assert.throws(
    () =>
      getPayWayConfig({
        PAYWAY_SANDBOX_SUCCESS_URL: 'javascript:alert(1)',
      }),
    /HTTP or HTTPS URL/,
  )
})

test('requires https for configured production navigation urls', () => {
  assert.throws(
    () =>
      getPayWayConfig({
        PAYWAY_ENV: 'production',
        PAYWAY_PRODUCTION_SUCCESS_URL: 'http://pay.example.test/payment/result',
      }),
    /must be an HTTPS URL/,
  )
})

test('configuration performs no network calls', () => {
  const originalFetch = globalThis.fetch
  let networkCalled = false
  globalThis.fetch = () => {
    networkCalled = true
    throw new Error('Configuration must not make network calls.')
  }

  try {
    getPayWayConfig({})
    getPayWayConfig({ PAYWAY_ENV: 'production', PAYWAY_CHECKOUT_ENABLED: 'false' })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(networkCalled, false)
})
