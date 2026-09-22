import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildPurchaseSigningInput,
  PURCHASE_SIGNING_FIELDS,
  signPurchase,
} from '../src/payway/purchaseSigning.js'

const FICTIONAL_SECRET = 'fictional-public-key'
const fixture = Object.freeze({
  req_time: '20260921123456',
  merchant_id: 'testmerchant',
  tran_id: '12345678901234567890',
  amount: '2000',
  cancel_url: 'https://example.test/payment/cancel',
  continue_success_url: 'https://example.test/payment/result',
  currency: 'KHR',
})

test('uses the official purchase field order with empty optional positions', () => {
  assert.deepEqual(PURCHASE_SIGNING_FIELDS, [
    'req_time', 'merchant_id', 'tran_id', 'amount', 'items', 'shipping',
    'firstname', 'lastname', 'email', 'phone', 'type', 'payment_option',
    'return_url', 'cancel_url', 'continue_success_url', 'return_deeplink',
    'currency', 'custom_fields', 'return_params', 'payout', 'lifetime',
    'additional_params', 'google_pay_token', 'skip_success_page',
  ])
  assert.equal(
    buildPurchaseSigningInput(fixture),
    '20260921123456testmerchant123456789012345678902000https://example.test/payment/cancelhttps://example.test/payment/resultKHR',
  )
})

test('matches an independently generated fictional hmac fixture', () => {
  assert.equal(
    signPurchase(fixture, FICTIONAL_SECRET),
    '79DE1pl5pN2jv6x3gqI9yFUrPffLOfC8pkCH3ZOXZZG9DjUdOeuolAvHBqwMWj6tbhyBd/njFKZSyvnHNBb2GA==',
  )
})

test('uses utf8 encoding for unicode values', () => {
  assert.equal(
    signPurchase({ ...fixture, firstname: 'សុខា' }, FICTIONAL_SECRET),
    'Z3dN/v2yDoZ1Qm7XCSbHwRDQW1eLzX/7nAPWsF06Nz06JtxPT1KgNV1sz6Z2lrTWU2wet41BbyFOWNECO/nJmg==',
  )
})

test('changes the signature when transaction data or secret changes', () => {
  const signature = signPurchase(fixture, FICTIONAL_SECRET)

  assert.notEqual(signPurchase({ ...fixture, amount: '1' }, FICTIONAL_SECRET), signature)
  assert.notEqual(
    signPurchase({ ...fixture, tran_id: '22345678901234567890' }, FICTIONAL_SECRET),
    signature,
  )
  assert.notEqual(signPurchase(fixture, 'another-fictional-key'), signature)
})

test('does not mutate fields or sign hosted mode controls', () => {
  const fields = {
    ...fixture,
    view_type: 'hosted_view',
    payment_gate: '0',
  }
  const before = structuredClone(fields)

  assert.equal(signPurchase(fields, FICTIONAL_SECRET), signPurchase(fixture, FICTIONAL_SECRET))
  assert.deepEqual(fields, before)
})

test('rejects non-string values and missing secrets', () => {
  assert.throws(() => signPurchase({ ...fixture, amount: 2000 }, FICTIONAL_SECRET))
  assert.throws(() => signPurchase(fixture, ''))
})
