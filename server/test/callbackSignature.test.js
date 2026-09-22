import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildCallbackSigningInput,
  serializePhpJsonValue,
  UnsupportedCallbackPayloadError,
  verifyCallbackSignature,
} from '../src/payway/callbackSignature.js'

const FICTIONAL_SECRET = 'fictional-callback-secret'
const INDEPENDENT_SIGNATURE =
  '5iLXxgTk9CLQxnf+k6fv7wOm1VFbIUItYsuD+mxHM9Bl/81Yu+NKH/pTq87U5AJKik5RXxy8LGp7CsfB9UAWPg=='

// build the independently signed fixture
function callbackFixture() {
  return {
    tran_id: '000123456789',
    status: '0',
    original_amount: 2000,
    original_currency: 'KHR',
    payment_amount: 2000,
    payment_currency: 'KHR',
    total_amount: 2000,
    discount_amount: 0,
    transaction_date: '2026-09-22 10:20:30',
    apv: '123456',
  }
}

test('matches an independently generated php-reference fixture', () => {
  const payload = callbackFixture()

  assert.equal(
    buildCallbackSigningInput(payload),
    '12345602000KHR2000KHR020000001234567892026-09-22 10:20:30',
  )
  assert.equal(
    verifyCallbackSignature(payload, INDEPENDENT_SIGNATURE, FICTIONAL_SECRET),
    true,
  )
})

test('ignores top-level insertion order but not modified values or secrets', () => {
  const payload = callbackFixture()
  const reordered = Object.fromEntries(Object.entries(payload).reverse())

  assert.equal(
    verifyCallbackSignature(reordered, INDEPENDENT_SIGNATURE, FICTIONAL_SECRET),
    true,
  )
  assert.equal(
    verifyCallbackSignature(
      { ...payload, original_amount: 1 },
      INDEPENDENT_SIGNATURE,
      FICTIONAL_SECRET,
    ),
    false,
  )
  assert.equal(
    verifyCallbackSignature(payload, INDEPENDENT_SIGNATURE, 'wrong-fictional-secret'),
    false,
  )
})

test('reproduces supported php numeric unicode nested and null serialization', () => {
  const nested = {
    label: 'សុខា/店',
    values: [1.5, true, false, null],
  }
  const payload = {
    z: null,
    number: 0.01,
    nested,
    a: 'start',
  }

  assert.equal(
    serializePhpJsonValue(nested),
    '{"label":"\\u179f\\u17bb\\u1781\\u17b6\\/\\u5e97","values":[1.5,true,false,null]}',
  )
  assert.equal(
    buildCallbackSigningInput(payload),
    'start{"label":"\\u179f\\u17bb\\u1781\\u17b6\\/\\u5e97","values":[1.5,true,false,null]}0.01',
  )
})

for (const signature of [undefined, '', 'not-base64', 'AA==', `${INDEPENDENT_SIGNATURE}x`]) {
  test(`rejects missing or malformed signature ${JSON.stringify(signature)}`, () => {
    assert.equal(
      verifyCallbackSignature(callbackFixture(), signature, FICTIONAL_SECRET),
      false,
    )
  })
}

test('rejects serialization cases not defined safely across php and javascript', () => {
  for (const payload of [
    { amount: 1e-7 },
    { amount: 0.001 },
    { amount: Number.MAX_SAFE_INTEGER + 1 },
    { nested: { 0: 'first', 1: 'second' } },
    { 'មិនគាំទ្រ': 'value' },
    { text: '\ud800' },
  ]) {
    assert.throws(
      () => buildCallbackSigningInput(payload),
      UnsupportedCallbackPayloadError,
    )
  }
})

test('does not mutate the original parsed payload', () => {
  const payload = callbackFixture()
  const before = structuredClone(payload)

  buildCallbackSigningInput(payload)
  assert.deepEqual(payload, before)
})
