import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { test } from 'node:test'
import { Transaction } from '../src/models/transaction.js'
import { hashStatusAccessToken } from '../src/payway/statusAccessToken.js'
import {
  getProtectedPaymentStatus,
  PaymentStatusUnavailableError,
} from '../src/services/paymentStatusService.js'
import {
  assertDesignatedTestDatabase,
  closeTestDatabaseConnection,
  hasTestDatabaseConfiguration,
  openTestDatabaseConnection,
} from '../test-support/testDatabase.js'

const hasTestDatabase = hasTestDatabaseConfiguration()

// generate one isolated test transaction id
function testTransactionId() {
  return `${randomInt(1_000_000_000, 10_000_000_000)}${randomInt(1_000_000_000, 10_000_000_000)}`
}

test(
  'protected status reads without changing the isolated database record',
  { skip: hasTestDatabase ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = await openTestDatabaseConnection()
    const tranId = testTransactionId()
    const token = 'A'.repeat(43)
    const wrongToken = 'B'.repeat(43)

    try {
      await Transaction.create({
        tranId,
        name: 'Protected Status Test',
        accountNumber: '000042',
        amount: 2000,
        statusAccessTokenHash: hashStatusAccessToken(token),
      })

      const before = await Transaction.findByTranId(tranId, {
        includeSensitive: true,
      })

      const result = await getProtectedPaymentStatus(tranId, token)

      const after = await Transaction.findByTranId(tranId, {
        includeSensitive: true,
      })

      assert.deepEqual(result, {
        tranId,
        amount: 2000,
        currency: 'KHR',
        status: 'PENDING',
        paidAt: null,
      })
      assert.equal(after.statusAccessTokenHash, hashStatusAccessToken(token))
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime())
      assert.equal(after.status, 'PENDING')

      await assert.rejects(
        getProtectedPaymentStatus(tranId, wrongToken),
        PaymentStatusUnavailableError,
      )
    } finally {
      await assertDesignatedTestDatabase(pool)
      await pool.query('DELETE FROM transactions WHERE tran_id = $1', [tranId])
      await closeTestDatabaseConnection()
    }
  },
)
