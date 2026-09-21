import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import {
  ACCOUNT_NUMBER_MAX_LENGTH,
  NAME_MAX_LENGTH,
  Transaction,
  transactionSchema,
} from '../src/models/transaction.js'
import {
  assertDesignatedTestDatabase,
  hasTestDatabaseConfiguration,
  openTestDatabaseConnection,
} from '../test-support/testDatabase.js'

function validTransaction(overrides = {}) {
  return new Transaction({
    tranId: 'STEP2-VALIDATION-001',
    name: 'Test Sender',
    accountNumber: '0012345678',
    amount: 2000,
    ...overrides,
  })
}

test('requires tranId, name, accountNumber, and amount', async () => {
  const error = await new Transaction().validate().catch((validationError) => validationError)

  assert.ok(error.errors.tranId)
  assert.ok(error.errors.name)
  assert.ok(error.errors.accountNumber)
  assert.ok(error.errors.amount)
})

test('rejects invalid statuses and non-KHR currencies', async () => {
  const invalidStatus = await validTransaction({ status: 'UNKNOWN' })
    .validate()
    .catch((validationError) => validationError)
  const invalidCurrency = await validTransaction({ currency: 'USD' })
    .validate()
    .catch((validationError) => validationError)

  assert.ok(invalidStatus.errors.status)
  assert.ok(invalidCurrency.errors.currency)
})

for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`rejects invalid whole-KHR amount: ${amount}`, async () => {
    const error = await validTransaction({ amount })
      .validate()
      .catch((validationError) => validationError)
    assert.ok(error.errors.amount)
  })
}

test('preserves leading zeros in accountNumber and applies defaults', async () => {
  const transaction = validTransaction({ accountNumber: ' 0012345678 ' })
  await transaction.validate()
  assert.equal(transaction.accountNumber, '0012345678')
  assert.equal(transaction.currency, 'KHR')
  assert.equal(transaction.status, 'PENDING')
  assert.equal(transaction.paywayResponseCode, null)
  assert.equal(transaction.paidAt, null)
})

test('enforces documented application-level string limits', async () => {
  const longName = await validTransaction({ name: 'n'.repeat(NAME_MAX_LENGTH + 1) })
    .validate()
    .catch((validationError) => validationError)
  const longAccount = await validTransaction({
    accountNumber: '1'.repeat(ACCOUNT_NUMBER_MAX_LENGTH + 1),
  })
    .validate()
    .catch((validationError) => validationError)

  assert.ok(longName.errors.name)
  assert.ok(longAccount.errors.accountNumber)
})

const hasTestMongoUri = hasTestDatabaseConfiguration()

test(
  'persists timestamps and rejects duplicate tranId in an isolated test database',
  { skip: hasTestMongoUri ? false : 'TEST_MONGODB_URI is not configured' },
  async () => {
    const connection = await openTestDatabaseConnection()
    const TestTransaction = connection.model('Transaction', transactionSchema)
    const tranId = `STEP2-TEST-${randomUUID()}`

    try {
      await TestTransaction.init()
      const indexes = await TestTransaction.collection.indexes()
      const tranIdIndex = indexes.find((index) => index.key?.tranId === 1)
      assert.equal(tranIdIndex?.unique, true)

      const created = await TestTransaction.create({
        tranId,
        name: 'Persistence Test',
        accountNumber: '000042',
        amount: 1,
      })

      assert.ok(created.createdAt instanceof Date)
      assert.ok(created.updatedAt instanceof Date)
      assert.equal(created.accountNumber, '000042')

      await assert.rejects(
        TestTransaction.create({
          tranId,
          name: 'Duplicate Test',
          accountNumber: '000043',
          amount: 2,
        }),
        (error) => error?.code === 11000,
      )
    } finally {
      assertDesignatedTestDatabase(connection)
      await TestTransaction.deleteMany({ tranId })
      await connection.close()
    }
  },
)
