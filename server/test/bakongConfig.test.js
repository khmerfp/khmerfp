import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BAKONG_ENDPOINTS,
  BakongConfigurationError,
  getBakongConfig,
} from '../src/config/bakong.js'

test('defaults to SIT with payments disabled', () => {
  const config = getBakongConfig({})

  assert.equal(config.environment, 'sit')
  assert.equal(config.paymentsEnabled, false)
  assert.equal(config.endpoints, BAKONG_ENDPOINTS.sit)
  assert.equal(config.credentials.apiToken, undefined)
  assert.equal(config.credentials.email, undefined)
  assert.equal(config.merchant.accountId, undefined)
  assert.equal(config.merchant.city, 'Phnom Penh')
  assert.equal(config.qr.currency, 'USD')
  assert.equal(config.qr.expireMinutes, 5)
  assert.equal(config.timeoutMs, 8000)
})

test('uses fixed official endpoint mappings', () => {
  assert.deepEqual(BAKONG_ENDPOINTS, {
    sit: { baseUrl: 'https://sit-api-bakong.nbc.org.kh' },
    production: { baseUrl: 'https://api-bakong.nbc.gov.kh' },
  })

  assert.equal(
    getBakongConfig({ BAKONG_ENV: 'production' }).endpoints,
    BAKONG_ENDPOINTS.production,
  )
})

for (const value of ['', 'sandbox', 'PRODUCTION', 'sit ']) {
  test(`rejects invalid BAKONG_ENV value ${JSON.stringify(value)}`, () => {
    assert.throws(
      () => getBakongConfig({ BAKONG_ENV: value }),
      BakongConfigurationError,
    )
  })
}

for (const value of ['', 'TRUE', 'False', '1', 'yes']) {
  test(`rejects non-strict BAKONG_PAYMENTS_ENABLED ${JSON.stringify(value)}`, () => {
    assert.throws(
      () => getBakongConfig({ BAKONG_PAYMENTS_ENABLED: value }),
      BakongConfigurationError,
    )
  })
}

for (const value of ['', 'EUR', 'US']) {
  test(`rejects invalid BAKONG_CURRENCY ${JSON.stringify(value)}`, () => {
    assert.throws(
      () => getBakongConfig({ BAKONG_CURRENCY: value }),
      BakongConfigurationError,
    )
  })
}

test('normalizes a lowercase currency value', () => {
  assert.equal(
    getBakongConfig({ BAKONG_CURRENCY: ' khr ' }).qr.currency,
    'KHR',
  )
})

for (const [variable, value] of [
  ['BAKONG_QR_EXPIRE_MINUTES', '0'],
  ['BAKONG_QR_EXPIRE_MINUTES', '11'],
  ['BAKONG_QR_EXPIRE_MINUTES', '2.5'],
  ['BAKONG_TIMEOUT_MS', '999'],
  ['BAKONG_TIMEOUT_MS', '30001'],
]) {
  test(`rejects invalid ${variable} value ${value}`, () => {
    assert.throws(
      () => getBakongConfig({ [variable]: value }),
      BakongConfigurationError,
    )
  })
}

test('requires merchant identity and credentials when enabled', () => {
  assert.throws(
    () => getBakongConfig({ BAKONG_PAYMENTS_ENABLED: 'true' }),
    BakongConfigurationError,
  )

  assert.throws(
    () => getBakongConfig({
      BAKONG_PAYMENTS_ENABLED: 'true',
      BAKONG_ACCOUNT_ID: 'merchant@aclb',
      BAKONG_MERCHANT_NAME: 'KhmerFP',
    }),
    BakongConfigurationError,
  )

  assert.throws(
    () => getBakongConfig({
      BAKONG_PAYMENTS_ENABLED: 'true',
      BAKONG_MERCHANT_NAME: 'KhmerFP',
      BAKONG_API_TOKEN: 'token',
    }),
    BakongConfigurationError,
  )
})

test('accepts a token or an email for renewal when enabled', () => {
  const base = {
    BAKONG_PAYMENTS_ENABLED: 'true',
    BAKONG_ACCOUNT_ID: 'merchant@aclb',
    BAKONG_MERCHANT_NAME: 'KhmerFP',
    BAKONG_CURRENCY: 'khr',
  }

  const withToken = getBakongConfig({ ...base, BAKONG_API_TOKEN: 'token' })
  assert.equal(withToken.paymentsEnabled, true)
  assert.equal(withToken.credentials.apiToken, 'token')
  assert.equal(withToken.qr.currency, 'KHR')

  const withEmail = getBakongConfig({ ...base, BAKONG_EMAIL: 'owner@example.com' })
  assert.equal(withEmail.paymentsEnabled, true)
  assert.equal(withEmail.credentials.email, 'owner@example.com')
})
