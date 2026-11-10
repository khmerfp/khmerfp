import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ACCOUNT_NUMBER_MAX_LENGTH,
  NAME_MAX_LENGTH,
  Transaction,
} from '../src/models/transaction.js'
import { validatePayment } from '../src/controllers/paymentController.js'
import { validatePaymentDetails } from '../src/validation/paymentValidation.js'

function validDetails(overrides = {}) {
  return {
    name: 'Example Sender',
    accountNumber: '0012345678',
    amount: 1,
    ...overrides,
  }
}

test('normalizes strings, preserves account leading zeros, and sets KHR server-side', () => {
  const result = validatePaymentDetails({
    name: '  សុខា ឧទាហរណ៍  ',
    accountNumber: ' 0012345678 ',
    amount: 2000,
  })

  assert.deepEqual(result, {
    isValid: true,
    data: {
      name: 'សុខា ឧទាហរណ៍',
      accountNumber: '0012345678',
      amount: 2000,
      currency: 'KHR',
    },
  })
})

test('rejects missing fields', () => {
  const result = validatePaymentDetails({})

  assert.equal(result.isValid, false)
  assert.deepEqual(Object.keys(result.errors).sort(), ['accountNumber', 'amount', 'name'])
})

test('rejects blank and overlong strings', () => {
  const blank = validatePaymentDetails(validDetails({ name: ' ', accountNumber: '\t' }))
  const overlong = validatePaymentDetails(
    validDetails({
      name: 'n'.repeat(NAME_MAX_LENGTH + 1),
      accountNumber: '0'.repeat(ACCOUNT_NUMBER_MAX_LENGTH + 1),
    }),
  )

  assert.ok(blank.errors.name)
  assert.ok(blank.errors.accountNumber)
  assert.ok(overlong.errors.name)
  assert.ok(overlong.errors.accountNumber)
})

test('checks types before string transformations', () => {
  for (const value of [null, [], {}, 123]) {
    const nameResult = validatePaymentDetails(validDetails({ name: value }))
    const accountResult = validatePaymentDetails(validDetails({ accountNumber: value }))

    assert.equal(nameResult.errors.name, 'Name must be a string.')
    assert.equal(accountResult.errors.accountNumber, 'Account number must be a string.')
  }

  for (const value of [null, '1', [], {}, true]) {
    const amountResult = validatePaymentDetails(validDetails({ amount: value }))
    assert.equal(amountResult.errors.amount, 'Amount must be a JSON number.')
  }
})

test('rejects null, array, and primitive request bodies', () => {
  for (const body of [null, [], 'details', 1, true]) {
    const result = validatePaymentDetails(body)
    assert.equal(result.errors.body, 'Request body must be a JSON object.')
  }
})

for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`rejects non-positive, fractional, or unsafe amount ${amount}`, () => {
    const result = validatePaymentDetails(validDetails({ amount }))
    assert.equal(result.errors.amount, 'Amount must be a positive safe integer in whole KHR.')
  })
}

for (const amount of [2, 1999, 2001]) {
  test(`rejects unauthorized exam amount ${amount}`, () => {
    const result = validatePaymentDetails(validDetails({ amount }))
    assert.equal(result.errors.amount, 'amount must be either 1 or 2000 KHR.')
  })
}

test('rejects unexpected status, currency, and tranId fields', () => {
  const result = validatePaymentDetails({
    ...validDetails(),
    status: 'PAID',
    currency: 'KHR',
    tranId: 'CLIENT-SUPPLIED',
  })

  assert.equal(result.isValid, false)
  assert.equal(result.errors.status, 'Unexpected field.')
  assert.equal(result.errors.currency, 'Unexpected field.')
  assert.equal(result.errors.tranId, 'Unexpected field.')
})

test('controller validates without creating a transaction or making a payment request', () => {
  const originalCreate = Transaction.create
  const originalFetch = globalThis.fetch
  let transactionWriteAttempted = false
  let externalRequestAttempted = false
  let statusCode
  let responseBody

  Transaction.create = () => {
    transactionWriteAttempted = true
    throw new Error('Transaction creation is outside Step 3.')
  }
  globalThis.fetch = () => {
    externalRequestAttempted = true
    throw new Error('External requests are outside Step 3.')
  }

  const response = {
    status(code) {
      statusCode = code
      return this
    },
    json(body) {
      responseBody = body
      return this
    },
  }

  try {
    validatePayment({ body: validDetails() }, response)
  } finally {
    Transaction.create = originalCreate
    globalThis.fetch = originalFetch
  }

  assert.equal(statusCode, 200)
  assert.equal(responseBody.message, 'Validation passed. No payment was initiated.')
  assert.equal(transactionWriteAttempted, false)
  assert.equal(externalRequestAttempted, false)
})
