import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_TRANSACTION_ID_ATTEMPTS,
  PaymentDetailsValidationError,
  generateTransactionId,
  preparePendingTransaction,
} from '../src/services/pendingTransactionService.js'
import { Transaction } from '../src/models/transaction.js'
import {
  assertDesignatedTestDatabase,
  closeTestDatabaseConnection,
  hasTestDatabaseConfiguration,
  openTestDatabaseConnection,
} from '../test-support/testDatabase.js'

// build fictional valid payment details
function validDetails(overrides = {}) {
  return {
    name: 'Example Sender',
    accountNumber: '0012345678',
    amount: 1,
    ...overrides,
  }
}

// build a fake stored transaction
function storedTransaction(values) {
  return {
    ...values,
    paywayResponseCode: null,
    paidAt: null,
  }
}

// build a PostgreSQL unique-violation error (SQLSTATE 23505)
function duplicateKeyError(constraint = 'transactions_tran_id_key') {
  const error = new Error(`duplicate key value violates unique constraint "${constraint}"`)
  error.code = '23505'
  error.constraint = constraint
  return error
}

test('generates a 20-digit cryptographically random transaction id with no leading zero', () => {
  for (let index = 0; index < 25; index += 1) {
    assert.match(generateTransactionId(), /^[1-9][0-9]{19}$/)
  }
})

test('persists only allowed normalized fields and returns a minimal result', async () => {
  const input = validDetails({
    name: '  Example Sender  ',
    accountNumber: ' 00001234 ',
    status: undefined,
  })
  delete input.status
  const originalInput = structuredClone(input)
  let inserted

  const transactionModel = {
    // capture the allow-listed insert
    async create(values) {
      inserted = values
      return storedTransaction(values)
    },
  }

  const result = await preparePendingTransaction(input, {
    transactionModel,
    transactionIdGenerator: () => '12345678901234567890',
  })

  assert.deepEqual(input, originalInput)
  assert.deepEqual(inserted, {
    tranId: '12345678901234567890',
    name: 'Example Sender',
    accountNumber: '00001234',
    amount: 1,
    currency: 'KHR',
    status: 'PENDING',
  })
  assert.deepEqual(result, {
    tranId: '12345678901234567890',
    amount: 1,
    currency: 'KHR',
    status: 'PENDING',
  })
})

test('rejects invalid or caller-controlled transaction fields before persistence', async () => {
  let createCalls = 0
  const transactionModel = {
    // count unexpected writes
    async create() {
      createCalls += 1
    },
  }

  for (const details of [
    validDetails({ amount: 2 }),
    validDetails({ status: 'PAID' }),
    validDetails({ tranId: 'CALLER-ID' }),
    validDetails({ paidAt: new Date().toISOString() }),
    validDetails({ paywayResponseCode: '00' }),
  ]) {
    await assert.rejects(
      preparePendingTransaction(details, { transactionModel }),
      PaymentDetailsValidationError,
    )
  }

  assert.equal(createCalls, 0)
})

test('retries a transaction id collision and uses a new generated id', async () => {
  const generatedIds = ['11111111111111111111', '22222222222222222222']
  const insertedIds = []
  const transactionModel = {
    // simulate one tranId collision
    async create(values) {
      insertedIds.push(values.tranId)
      if (insertedIds.length === 1) {
        throw duplicateKeyError()
      }
      return storedTransaction(values)
    },
  }

  const result = await preparePendingTransaction(validDetails(), {
    transactionModel,
    transactionIdGenerator: () => generatedIds.shift(),
  })

  assert.deepEqual(insertedIds, [
    '11111111111111111111',
    '22222222222222222222',
  ])
  assert.equal(result.tranId, '22222222222222222222')
})

test('bounds transaction id collision retries', async () => {
  let createCalls = 0
  const collision = duplicateKeyError()
  const transactionModel = {
    // always report the same collision
    async create() {
      createCalls += 1
      throw collision
    },
  }

  await assert.rejects(
    preparePendingTransaction(validDetails(), {
      transactionModel,
      transactionIdGenerator: () => '11111111111111111111',
    }),
    (error) => error === collision,
  )
  assert.equal(createCalls, MAX_TRANSACTION_ID_ATTEMPTS)
})

test('does not retry unrelated database failures or other duplicate indexes', async () => {
  for (const databaseError of [
    Object.assign(new Error('database unavailable'), { code: 'ECONNREFUSED' }),
    duplicateKeyError('transactions_other_unique_key'),
  ]) {
    let createCalls = 0
    const transactionModel = {
      // return the selected database failure
      async create() {
        createCalls += 1
        throw databaseError
      },
    }

    await assert.rejects(
      preparePendingTransaction(validDetails(), { transactionModel }),
      (error) => error === databaseError,
    )
    assert.equal(createCalls, 1)
  }
})

const hasTestDatabase = hasTestDatabaseConfiguration()

test(
  'persists a pending KHR transaction in an isolated database',
  { skip: hasTestDatabase ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = await openTestDatabaseConnection()
    let tranId

    try {
      const result = await preparePendingTransaction(
        validDetails({ accountNumber: '00000042', amount: 2000 }),
        { transactionModel: Transaction },
      )
      tranId = result.tranId

      const stored = await Transaction.findByTranId(tranId)
      assert.ok(stored)
      assert.equal(stored.status, 'PENDING')
      assert.equal(stored.currency, 'KHR')
      assert.equal(stored.amount, 2000)
      assert.equal(stored.accountNumber, '00000042')
      assert.equal(stored.paywayResponseCode, null)
      assert.equal(stored.paidAt, null)
      assert.ok(stored.createdAt instanceof Date)
      assert.ok(stored.updatedAt instanceof Date)
    } finally {
      if (tranId) {
        await assertDesignatedTestDatabase(pool)
        await pool.query('DELETE FROM transactions WHERE tran_id = $1', [tranId])
      }
      await closeTestDatabaseConnection()
    }
  },
)
