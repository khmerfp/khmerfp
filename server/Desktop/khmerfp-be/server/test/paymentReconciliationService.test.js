import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CheckTransactionError } from '../src/services/checkTransactionService.js'
import {
  PaymentReconciliationError,
  reconcileAuthenticatedCallback,
} from '../src/services/paymentReconciliationService.js'

const tranId = '12345678901234567890'

// build authenticated callback data
function callbackData(overrides = {}) {
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
    ...overrides,
  }
}

// build one pending database record
function pendingTransaction(overrides = {}) {
  return {
    tranId,
    amount: 2000,
    currency: 'KHR',
    status: 'PENDING',
    paidAt: null,
    verificationEvidence: null,
    ...overrides,
  }
}

// build one approved provider check
function approvedCheck(overrides = {}) {
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
      ...overrides.provider,
    },
    amounts: {
      originalAmount: 2000,
      originalCurrency: null,
      totalAmount: 2000,
      paymentAmount: 2000,
      paymentCurrency: 'KHR',
      ...overrides.amounts,
    },
    ...overrides.root,
  }
}

// build a simple atomic model fake matching the pg Transaction API
function createTransactionModel(initial = pendingTransaction()) {
  let current = structuredClone(initial)
  let effectiveUpdates = 0

  return {
    // return the current transaction
    async findByTranId(requestedId) {
      return current?.tranId === requestedId ? structuredClone(current) : null
    },
    // apply only the pending-to-paid conditional update
    async updateByTranId(requestedId, updates, options = {}) {
      const statusMatches =
        options.expectedStatus === undefined
        || current.status === options.expectedStatus
      const paidAtMatches =
        options.expectedPaidAtNull !== true || current.paidAt === null

      if (
        current?.tranId !== requestedId
        || current.status !== 'PENDING'
        || current.paidAt !== null
        || !statusMatches
        || !paidAtMatches
      ) {
        return null
      }

      current = { ...current, ...structuredClone(updates) }
      effectiveUpdates += 1
      return structuredClone(current)
    },
    // expose safe test state
    snapshot() {
      return structuredClone(current)
    },
    // count effective state changes
    updateCount() {
      return effectiveUpdates
    },
  }
}

test('rejects non-string and operator-shaped transaction ids before database access', async () => {
  let lookupCalls = 0
  const transactionModel = {
    async findByTranId() {
      lookupCalls += 1
      return null
    },
  }

  for (const unsafeId of [{ $ne: null }, '123', null]) {
    await assert.rejects(
      reconcileAuthenticatedCallback(callbackData({ tranId: unsafeId }), {
        transactionModel,
      }),
      (error) => error instanceof PaymentReconciliationError
        && error.code === 'TRANSACTION_NOT_FOUND',
    )
  }

  assert.equal(lookupCalls, 0)
})

test('matching callback and approved check atomically mark paid', async () => {
  const transactionModel = createTransactionModel()
  const paidAt = new Date('2026-09-22T10:21:00.000Z')
  const result = await reconcileAuthenticatedCallback(callbackData(), {
    transactionModel,
    checkTransaction: async (requestedId) => {
      assert.equal(requestedId, tranId)
      return approvedCheck()
    },
    now: () => paidAt,
  })
  const stored = transactionModel.snapshot()

  assert.deepEqual(result, { acknowledged: true, duplicate: false, status: 'PAID' })
  assert.equal(stored.status, 'PAID')
  assert.deepEqual(stored.paidAt, paidAt)
  assert.equal(stored.paywayResponseCode, '0')
  assert.equal(stored.verificationEvidence.callbackOriginalCurrency, 'KHR')
  assert.equal(stored.verificationEvidence.checkPaymentCurrency, 'KHR')
  assert.equal(stored.verificationEvidence.source, 'CALLBACK_AND_CHECK_TRANSACTION')
})

for (const callback of [
  callbackData({ originalAmount: 1 }),
  callbackData({ originalCurrency: 'USD' }),
]) {
  test('callback amount or currency mismatch never checks or marks paid', async () => {
    const transactionModel = createTransactionModel()
    let checkCalls = 0

    await assert.rejects(
      reconcileAuthenticatedCallback(callback, {
        transactionModel,
        checkTransaction: async () => {
          checkCalls += 1
        },
      }),
      (error) => error instanceof PaymentReconciliationError
        && error.code === 'CALLBACK_MISMATCH',
    )

    assert.equal(checkCalls, 0)
    assert.equal(transactionModel.snapshot().status, 'PENDING')
  })
}

test('unknown transaction does not create or check anything', async () => {
  let createCalls = 0
  let checkCalls = 0
  const transactionModel = {
    findByTranId: async () => null,
    updateByTranId: async () => null,
    create: async () => {
      createCalls += 1
    },
  }

  await assert.rejects(
    reconcileAuthenticatedCallback(callbackData(), {
      transactionModel,
      checkTransaction: async () => {
        checkCalls += 1
      },
    }),
    (error) => error.code === 'TRANSACTION_NOT_FOUND',
  )

  assert.equal(createCalls, 0)
  assert.equal(checkCalls, 0)
})

for (const [name, checkResult] of [
  ['pending', { ...approvedCheck(), outcome: 'PENDING', paymentApproved: false }],
  ['unknown', { ...approvedCheck(), outcome: 'UNKNOWN', paymentApproved: false }],
  ['malformed', { outcome: 'UNKNOWN', reason: 'MALFORMED_RESPONSE' }],
]) {
  test(`${name} provider result remains unverified`, async () => {
    const transactionModel = createTransactionModel()

    await assert.rejects(
      reconcileAuthenticatedCallback(callbackData(), {
        transactionModel,
        checkTransaction: async () => checkResult,
      }),
      (error) => error.code === 'PAYMENT_UNVERIFIED',
    )

    assert.equal(transactionModel.snapshot().status, 'PENDING')
    assert.equal(transactionModel.updateCount(), 0)
  })
}

for (const changes of [
  { amounts: { originalAmount: 1 } },
  { amounts: { totalAmount: 1 } },
  { amounts: { paymentAmount: 1 } },
  { amounts: { paymentCurrency: 'USD' } },
  { provider: { transactionId: '99999999999999999999' }, root: {
    outcome: 'UNKNOWN', paymentApproved: false,
  } },
]) {
  test('inconsistent check evidence never marks paid', async () => {
    const transactionModel = createTransactionModel()

    await assert.rejects(
      reconcileAuthenticatedCallback(callbackData(), {
        transactionModel,
        checkTransaction: async () => approvedCheck(changes),
      }),
      PaymentReconciliationError,
    )

    assert.equal(transactionModel.snapshot().status, 'PENDING')
  })
}

for (const callback of [
  callbackData({ discountAmount: 1, totalAmount: 1999 }),
  callbackData({ paymentCurrency: 'USD' }),
  callbackData({ status: '2' }),
]) {
  test('unsupported callback evidence never marks paid', async () => {
    const transactionModel = createTransactionModel()

    await assert.rejects(
      reconcileAuthenticatedCallback(callback, {
        transactionModel,
        checkTransaction: async () => approvedCheck(),
      }),
      (error) => error.code === 'PAYMENT_EVIDENCE_MISMATCH',
    )

    assert.equal(transactionModel.snapshot().status, 'PENDING')
  })
}

test('check timeout remains transient and unverified', async () => {
  const transactionModel = createTransactionModel()

  await assert.rejects(
    reconcileAuthenticatedCallback(callbackData(), {
      transactionModel,
      checkTransaction: async () => {
        throw new CheckTransactionError('timeout', 'TIMEOUT')
      },
    }),
    (error) => error.code === 'CHECK_TIMEOUT' && error.httpStatus === 503,
  )
  assert.equal(transactionModel.snapshot().status, 'PENDING')
})

test('database lookup and update failures remain unacknowledged', async () => {
  await assert.rejects(
    reconcileAuthenticatedCallback(callbackData(), {
      transactionModel: {
        findByTranId: async () => {
          throw new Error('fictional lookup failure')
        },
      },
    }),
    (error) => error.code === 'DATABASE_FAILURE' && error.httpStatus === 503,
  )

  await assert.rejects(
    reconcileAuthenticatedCallback(callbackData(), {
      transactionModel: {
        findByTranId: async () => pendingTransaction(),
        updateByTranId: async () => {
          throw new Error('fictional update failure')
        },
      },
      checkTransaction: async () => approvedCheck(),
    }),
    (error) => error.code === 'DATABASE_FAILURE' && error.httpStatus === 503,
  )
})

test('verified duplicate is acknowledged without changing paidAt', async () => {
  const originalPaidAt = new Date('2026-09-22T10:21:00.000Z')
  const transactionModel = createTransactionModel(pendingTransaction({
    status: 'PAID',
    paidAt: originalPaidAt,
    verificationEvidence: {
      source: 'CALLBACK_AND_CHECK_TRANSACTION',
      callbackStatus: '0',
      callbackApprovalCode: '123456',
      callbackOriginalAmount: 2000,
      callbackOriginalCurrency: 'KHR',
    },
  }))
  let checkCalls = 0
  const result = await reconcileAuthenticatedCallback(callbackData(), {
    transactionModel,
    checkTransaction: async () => {
      checkCalls += 1
    },
  })

  assert.deepEqual(result, { acknowledged: true, duplicate: true, status: 'PAID' })
  assert.deepEqual(transactionModel.snapshot().paidAt, originalPaidAt)
  assert.equal(transactionModel.updateCount(), 0)
  assert.equal(checkCalls, 0)
})

test('delayed conflicting notification never downgrades paid', async () => {
  const originalPaidAt = new Date('2026-09-22T10:21:00.000Z')
  const transactionModel = createTransactionModel(pendingTransaction({
    status: 'PAID',
    paidAt: originalPaidAt,
    verificationEvidence: {
      source: 'CALLBACK_AND_CHECK_TRANSACTION',
      callbackStatus: '0',
      callbackApprovalCode: '123456',
      callbackOriginalAmount: 2000,
      callbackOriginalCurrency: 'KHR',
    },
  }))

  await assert.rejects(
    reconcileAuthenticatedCallback(callbackData({ status: '2' }), {
      transactionModel,
    }),
    (error) => error.code === 'PAID_EVIDENCE_CONFLICT',
  )

  assert.equal(transactionModel.snapshot().status, 'PAID')
  assert.deepEqual(transactionModel.snapshot().paidAt, originalPaidAt)
  assert.equal(transactionModel.updateCount(), 0)
})

test('concurrent callbacks produce one effective paid transition', async () => {
  const transactionModel = createTransactionModel()
  const paidAt = new Date('2026-09-22T10:21:00.000Z')
  const options = {
    transactionModel,
    checkTransaction: async () => approvedCheck(),
    now: () => paidAt,
  }
  const results = await Promise.all([
    reconcileAuthenticatedCallback(callbackData(), options),
    reconcileAuthenticatedCallback(callbackData(), options),
  ])

  assert.equal(transactionModel.updateCount(), 1)
  assert.equal(results.filter((result) => result.duplicate).length, 1)
  assert.deepEqual(transactionModel.snapshot().paidAt, paidAt)
})
