
import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { test } from 'node:test'

import { Transaction } from '../src/models/transaction.js'
import {
  reconcileAuthenticatedCallback,
} from '../src/services/paymentReconciliationService.js'
import {
  assertDesignatedTestDatabase,
  closeTestDatabaseConnection,
  hasTestDatabaseConfiguration,
  openTestDatabaseConnection,
} from '../test-support/testDatabase.js'

// Generate one unique twenty-digit test transaction ID.
function testTransactionId() {
  return `${randomInt(1_000_000_000, 10_000_000_000)}${randomInt(1_000_000_000, 10_000_000_000)}`
}

// Build authenticated callback data.
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

// Build an approved provider check result.
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
  'concurrent callbacks persist one paid transition in PostgreSQL',
  {
    skip: hasTestDatabaseConfiguration()
      ? false
      : 'TEST_DATABASE_URL is not configured',
  },
  async () => {
    let pool
    let tranId

    const verifiedAt = new Date('2026-09-22T10:21:00.000Z')

    try {
      pool = await openTestDatabaseConnection()
      tranId = testTransactionId()

      await Transaction.create({
        tranId,
        name: 'Callback Persistence Test',
        accountNumber: '000042',
        amount: 2000,
      })

      const options = {
        transactionModel: Transaction,
        checkTransaction: async () => approvedCheck(tranId),
        now: () => verifiedAt,
      }

      const results = await Promise.all([
        reconcileAuthenticatedCallback(callbackData(tranId), options),
        reconcileAuthenticatedCallback(callbackData(tranId), options),
      ])

      const stored = await Transaction.findByTranId(tranId)

      assert.equal(
        results.filter((result) => result.duplicate).length,
        1,
        'Exactly one concurrent callback should be treated as a duplicate',
      )

      assert.equal(stored.status, 'PAID')
      assert.deepEqual(stored.paidAt, verifiedAt)
      assert.equal(stored.paywayResponseCode, '0')

      assert.equal(
        stored.verificationEvidence.source,
        'CALLBACK_AND_CHECK_TRANSACTION',
      )

      assert.equal(
        stored.verificationEvidence.callbackOriginalCurrency,
        'KHR',
      )

      assert.equal(
        stored.verificationEvidence.checkPaymentCurrency,
        'KHR',
      )

      // A later callback must also be acknowledged as a duplicate.
      const duplicate = await reconcileAuthenticatedCallback(
        callbackData(tranId),
        options,
      )

      const afterDuplicate = await Transaction.findByTranId(tranId)

      assert.equal(duplicate.duplicate, true)
      assert.equal(afterDuplicate.status, 'PAID')
      assert.deepEqual(afterDuplicate.paidAt, verifiedAt)
    } finally {
      if (pool && tranId) {
        await assertDesignatedTestDatabase(pool)

        await pool.query(
          'DELETE FROM transactions WHERE tran_id = $1',
          [tranId],
        )
      }

      if (pool) {
        await closeTestDatabaseConnection()
      }
    }
  },
)
