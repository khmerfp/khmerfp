import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { test } from 'node:test'
import { transactionSchema } from '../src/models/transaction.js'
import { hashStatusAccessToken } from '../src/payway/statusAccessToken.js'
import { getProtectedPaymentStatus } from '../src/services/paymentStatusService.js'
import {
  assertDesignatedTestDatabase,
  hasTestDatabaseConfiguration,
  openTestDatabaseConnection,
} from '../test-support/testDatabase.js'

const hasTestMongoUri = hasTestDatabaseConfiguration()

// generate one isolated test transaction id
function testTransactionId() {
  return `${randomInt(1_000_000_000, 10_000_000_000)}${randomInt(1_000_000_000, 10_000_000_000)}`
}

test(
  'protected status reads without changing the isolated database record',
  { skip: hasTestMongoUri ? false : 'TEST_MONGODB_URI is not configured' },
  async () => {
    const connection = await openTestDatabaseConnection()
    const TestTransaction = connection.model('StatusTransaction', transactionSchema)
    const tranId = testTransactionId()
    const token = 'A'.repeat(43)

    try {
      await TestTransaction.init()
      const created = await TestTransaction.create({
        tranId,
        name: 'Protected Status Test',
        accountNumber: '000042',
        amount: 2000,
        statusAccessTokenHash: hashStatusAccessToken(token),
      })
      const updatedAt = created.updatedAt
      const result = await getProtectedPaymentStatus(tranId, token, {
        transactionModel: TestTransaction,
      })
      const stored = await TestTransaction.findOne({ tranId })
        .select('+statusAccessTokenHash')

      assert.deepEqual(result, {
        tranId,
        amount: 2000,
        currency: 'KHR',
        status: 'PENDING',
        paidAt: null,
      })
      assert.equal(stored.statusAccessTokenHash, hashStatusAccessToken(token))
      assert.equal(stored.updatedAt.getTime(), updatedAt.getTime())
      assert.equal(stored.status, 'PENDING')
    } finally {
      assertDesignatedTestDatabase(connection)
      await TestTransaction.deleteOne({ tranId })
      await connection.close()
    }
  },
)
