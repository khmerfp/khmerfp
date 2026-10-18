import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { test } from 'node:test'
import { Transaction } from '../src/models/transaction.js'
import {
  assertDesignatedTestDatabase,
  closeTestDatabaseConnection,
  hasTestDatabaseConfiguration,
  openTestDatabaseConnection,
} from '../test-support/testDatabase.js'

// generate one isolated test transaction id
function testTransactionId() {
  return `${randomInt(1_000_000_000, 10_000_000_000)}${randomInt(1_000_000_000, 10_000_000_000)}`
}

function validDetails(overrides = {}) {
  return {
    tranId: testTransactionId(),
    name: 'Test Sender',
    accountNumber: '0012345678',
    amount: 2000,
    ...overrides,
  }
}

test('requires tranId, name, accountNumber, and amount before any database access', async () => {
  for (const [missing, expected] of [
    [{ tranId: undefined }, 'Transaction ID is required'],
    [{ name: undefined }, 'Name is required'],
    [{ accountNumber: undefined }, 'Account number is required'],
    [{ amount: undefined }, 'Amount must be a positive safe integer'],
  ]) {
    const details = validDetails(missing)
    delete details[Object.keys(missing)[0]]

    await assert.rejects(
      Transaction.create(details),
      (error) => error.message.includes(expected),
    )
  }
})

test('rejects invalid statuses and non-KHR currencies', async () => {
  await assert.rejects(
    Transaction.create(validDetails({ status: 'UNKNOWN' })),
    /Invalid transaction status/,
  )
  await assert.rejects(
    Transaction.create(validDetails({ currency: 'USD' })),
    /Currency must be KHR/,
  )
})

for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`rejects invalid whole-KHR amount: ${amount}`, async () => {
    await assert.rejects(
      Transaction.create(validDetails({ amount })),
      /Amount must be a positive safe integer/,
    )
  })
}

test('enforces documented application-level string limits', async () => {
  await assert.rejects(
    Transaction.create(validDetails({ name: 'n'.repeat(101) })),
    /must not exceed 100 characters/,
  )
  await assert.rejects(
    Transaction.create(validDetails({ accountNumber: '1'.repeat(65) })),
    /must not exceed 64 characters/,
  )
})

const hasTestDatabase = hasTestDatabaseConfiguration()

test(
  'persists trimmed values and timestamps and rejects duplicate tranId in PostgreSQL',
  { skip: hasTestDatabase ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = await openTestDatabaseConnection()
    const tranId = testTransactionId()

    try {
      const created = await Transaction.create(validDetails({
        tranId,
        name: '  Persistence Test  ',
        accountNumber: ' 000042 ',
        amount: 1,
      }))

      assert.ok(created.createdAt instanceof Date)
      assert.ok(created.updatedAt instanceof Date)
      assert.equal(created.accountNumber, '000042')
      assert.equal(created.name, 'Persistence Test')
      assert.equal(created.currency, 'KHR')
      assert.equal(created.status, 'PENDING')
      assert.equal(created.paywayResponseCode, null)
      assert.equal(created.paidAt, null)
      assert.equal(created.verificationEvidence, null)

      await assert.rejects(
        Transaction.create(validDetails({
          tranId,
          name: 'Duplicate Test',
          accountNumber: '000043',
          amount: 2,
        })),
        (error) => error?.code === '23505',
      )
    } finally {
      await assertDesignatedTestDatabase(pool)
      await pool.query('DELETE FROM transactions WHERE tran_id = $1', [tranId])
      await closeTestDatabaseConnection()
    }
  },
)
