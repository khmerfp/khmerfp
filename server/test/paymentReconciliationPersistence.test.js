import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { test } from 'node:test'
import { transactionSchema } from '../src/models/transaction.js'
import { reconcileAuthenticatedCallback } from '../src/services/paymentReconciliationService.js'
import {
  assertDesignatedTestDatabase,
  hasTestDatabaseConfiguration,
  openTestDatabaseConnection,
} from '../test-support/testDatabase.js'

const hasTestMongoUri = hasTestDatabaseConfiguration()

// generate one twenty-digit test id
function testTransactionId() {
  return `${randomInt(1_000_000_000, 10_000_000_000)}${randomInt(1_000_000_000, 10_000_000_000)}`
}

// build authenticated callback data
function callbackData(tranId) {
  return {
    tranId,
    approvalCode: '123456',
    status: '0',
    originalAmount: 2000,
    originalCurrency: 'KHR',
    paymentAmount: 2000,
    paymentCurrency: 'KHR',
    totalAmount: 2000,
    discountAmount: 0,
    transactionDate: '2026-09-22 10:20:30',
  }
}

// build an approved mocked check result
function approvedCheck(tranId) {
  return {
    apiSuccess: true,
    outcome: 'APPROVED',
    paymentApproved: true,
    verification: 'UNVERIFIED',
    reason: 'RECONCILIATION_REQUIRED',
    provider: {
      apiCode: '00',
      paymentStatusCode: '0',
      paymentStatus: 'APPROVED',
      transactionId: tranId,
    },
    amounts: {
      originalAmount: 2000,
      originalCurrency: null,
      totalAmount: 2000,
      paymentAmount: 2000,
      paymentCurrency: 'KHR',
    },
  }
}

test(
  'concurrent callbacks persist one paid transition in the isolated database',
  { skip: hasTestMongoUri ? false : 'TEST_MONGODB_URI is not configured' },
  async () => {
    const connection = await openTestDatabaseConnection()
    const TestTransaction = connection.model('Transaction', transactionSchema)
    const tranId = testTransactionId()
    const verifiedAt = new Date('2026-09-22T10:21:00.000Z')

    try {
      await TestTransaction.init()
      await TestTransaction.create({
        tranId,
        name: 'Callback Persistence Test',
        accountNumber: '000042',
        amount: 2000,
      })

      const options = {
        transactionModel: TestTransaction,
        checkTransaction: async () => approvedCheck(tranId),
        now: () => verifiedAt,
      }
      const results = await Promise.all([
        reconcileAuthenticatedCallback(callbackData(tranId), options),
        reconcileAuthenticatedCallback(callbackData(tranId), options),
      ])
      const stored = await TestTransaction.findOne({ tranId })

      assert.equal(results.filter((result) => result.duplicate).length, 1)
      assert.equal(stored.status, 'PAID')
      assert.deepEqual(stored.paidAt, verifiedAt)
      assert.equal(stored.paywayResponseCode, '0')
      assert.equal(stored.verificationEvidence.source, 'CALLBACK_AND_CHECK_TRANSACTION')
      assert.equal(stored.verificationEvidence.callbackOriginalCurrency, 'KHR')
      assert.equal(stored.verificationEvidence.checkPaymentCurrency, 'KHR')

      const duplicate = await reconcileAuthenticatedCallback(callbackData(tranId), options)
      const afterDuplicate = await TestTransaction.findOne({ tranId })

      assert.equal(duplicate.duplicate, true)
      assert.deepEqual(afterDuplicate.paidAt, verifiedAt)
    } finally {
      assertDesignatedTestDatabase(connection)
      await TestTransaction.deleteMany({ tranId })
      await connection.close()
    }
  },
)
