import assert from 'node:assert/strict'
import { test } from 'node:test'

import { validateBakongPaymentDetails } from '../src/validation/bakongPaymentValidation.js'

test('accepts a USD amount with two decimal places', () => {
  const result = validateBakongPaymentDetails(
    { amount: 25.5, description: ' Wallet top up ' },
    { currency: 'USD' },
  )

  assert.equal(result.isValid, true)
  assert.deepEqual(result.data, {
    amount: 25.5,
    currency: 'USD',
    description: 'Wallet top up',
  })
})

test('accepts a whole-KHR amount', () => {
  const result = validateBakongPaymentDetails(
    { amount: 4000 },
    { currency: 'KHR' },
  )

  assert.equal(result.isValid, true)
  assert.equal(result.data.amount, 4000)
})

for (const amount of [undefined, null, '25', 0, -1, 0.001, 100000.01]) {
  test(`rejects invalid USD amount ${JSON.stringify(amount)}`, () => {
    const result = validateBakongPaymentDetails(
      { amount },
      { currency: 'USD' },
    )
    assert.equal(result.isValid, false)
    assert.ok(result.errors.amount)
  })
}

test('rejects more than two decimal places', () => {
  const result = validateBakongPaymentDetails(
    { amount: 1.234 },
    { currency: 'USD' },
  )

  assert.equal(result.isValid, false)
  assert.match(result.errors.amount, /two decimal places/)
})

for (const amount of [99, 1.5, 100000001]) {
  test(`rejects invalid KHR amount ${amount}`, () => {
    const result = validateBakongPaymentDetails(
      { amount },
      { currency: 'KHR' },
    )

    assert.equal(result.isValid, false)
    assert.ok(result.errors.amount)
  })
}

test('rejects unexpected fields and oversized descriptions', () => {
  const unexpected = validateBakongPaymentDetails(
    { amount: 10, name: 'Attacker' },
    { currency: 'USD' },
  )
  assert.equal(unexpected.errors.name, 'Unexpected field.')

  const longDescription = validateBakongPaymentDetails(
    { amount: 10, description: 'x'.repeat(101) },
    { currency: 'USD' },
  )
  assert.ok(longDescription.errors.description)
})

test('rejects a non-object body', () => {
  const result = validateBakongPaymentDetails(null, { currency: 'USD' })

  assert.equal(result.isValid, false)
  assert.deepEqual(result.errors, {
    body: 'Request body must be a JSON object.',
  })
})
