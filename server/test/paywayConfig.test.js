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

test('requires both sandbox credentials when sandbox checkout is enabled', () => {
  const enabled = { PAYWAY_ENV: 'sandbox', PAYWAY_CHECKOUT_ENABLED: 'true' }

  assert.throws(() => getPayWayConfig(enabled), PayWayConfigurationError)
  assert.throws(
    () =>
      getPayWayConfig({
        ...enabled,
        PAYWAY_SANDBOX_MERCHANT_ID: 'sandbox-merchant',
      }),
    PayWayConfigurationError,
  )
  assert.throws(
    () =>
      getPayWayConfig({
        ...enabled,
        PAYWAY_SANDBOX_API_KEY: 'sandbox-api-key',
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
  })

  assert.equal(config.checkoutEnabled, true)
  assert.equal(config.credentials.merchantId, 'sandbox-merchant')
  assert.equal(config.credentials.apiKey, 'sandbox-api-key')
})

test('refuses production checkout activation even when sandbox credentials exist', () => {
  assert.throws(
    () =>
      getPayWayConfig({
        PAYWAY_ENV: 'production',
        PAYWAY_CHECKOUT_ENABLED: 'true',
        PAYWAY_SANDBOX_MERCHANT_ID: 'sandbox-merchant',
        PAYWAY_SANDBOX_API_KEY: 'sandbox-api-key',
      }),
    /cannot be enabled in production/,
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
