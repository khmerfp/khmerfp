
import { Transaction } from '../models/transaction.js'
import {
  CheckTransactionError,
  checkTransaction,
} from './checkTransactionService.js'

const VERIFIED_SOURCE = 'CALLBACK_AND_CHECK_TRANSACTION'

export class PaymentReconciliationError extends Error {
  constructor(message, code, httpStatus, options = {}) {
    super(message, options)
    this.name = 'PaymentReconciliationError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

function hasExactMoney(actual, expected) {
  return typeof actual === 'number' && actual === expected
}

function requireGeneratedTransactionId(callback) {
  if (
    typeof callback?.tranId !== 'string'
    || !/^\d{20}$/.test(callback.tranId)
  ) {
    throw new PaymentReconciliationError(
      'No saved transaction matches this callback.',
      'TRANSACTION_NOT_FOUND',
      404,
    )
  }

  return callback.tranId
}

function validateCallbackMatch(callback, transaction) {
  if (
    !hasExactMoney(callback.originalAmount, transaction.amount)
    || callback.originalCurrency !== transaction.currency
  ) {
    throw new PaymentReconciliationError(
      'Callback transaction details do not match the saved transaction.',
      'CALLBACK_MISMATCH',
      409,
    )
  }
}

function validateApprovalEvidence(callback, checkResult, transaction) {
  const provider = checkResult?.provider ?? {}
  const amounts = checkResult?.amounts ?? {}

  const approved =
    checkResult?.apiSuccess === true
    && checkResult?.outcome === 'APPROVED'
    && checkResult?.paymentApproved === true
    && provider.apiCode === '00'
    && provider.paymentStatusCode === '0'
    && provider.paymentStatus === 'APPROVED'
    && provider.transactionId === transaction.tranId

  if (!approved) {
    throw new PaymentReconciliationError(
      'Payment approval could not be verified.',
      'PAYMENT_UNVERIFIED',
      503,
    )
  }

  const callbackIsConsistent =
    callback.status === '0'
    && hasExactMoney(callback.totalAmount, transaction.amount)
    && hasExactMoney(callback.paymentAmount, transaction.amount)
    && callback.paymentCurrency === transaction.currency
    && callback.discountAmount === 0

  const checkIsConsistent =
    hasExactMoney(amounts.originalAmount, transaction.amount)
    && hasExactMoney(amounts.totalAmount, transaction.amount)
    && hasExactMoney(amounts.paymentAmount, transaction.amount)
    && amounts.paymentCurrency === transaction.currency

  if (!callbackIsConsistent || !checkIsConsistent) {
    throw new PaymentReconciliationError(
      'Payment evidence contains inconsistent or unsupported monetary details.',
      'PAYMENT_EVIDENCE_MISMATCH',
      409,
    )
  }
}

function isVerifiedPaidTransaction(transaction, callback) {
  const evidence = transaction?.verificationEvidence

  return transaction?.status === 'PAID'
    && transaction.paidAt instanceof Date
    && evidence?.source === VERIFIED_SOURCE
    && evidence.callbackStatus === callback.status
    && evidence.callbackApprovalCode === callback.approvalCode
    && evidence.callbackOriginalAmount === callback.originalAmount
    && evidence.callbackOriginalCurrency === callback.originalCurrency
    && hasExactMoney(callback.totalAmount, transaction.amount)
    && hasExactMoney(callback.paymentAmount, transaction.amount)
    && callback.paymentCurrency === transaction.currency
    && callback.discountAmount === 0
}

function createVerificationEvidence(callback, checkResult, verifiedAt) {
  return {
    source: VERIFIED_SOURCE,
    callbackStatus: callback.status,
    callbackApprovalCode: callback.approvalCode,
    callbackOriginalAmount: callback.originalAmount,
    callbackOriginalCurrency: callback.originalCurrency,
    checkApiCode: checkResult.provider.apiCode,
    checkPaymentStatusCode: checkResult.provider.paymentStatusCode,
    checkPaymentStatus: checkResult.provider.paymentStatus,
    checkOriginalAmount: checkResult.amounts.originalAmount,
    checkTotalAmount: checkResult.amounts.totalAmount,
    checkPaymentAmount: checkResult.amounts.paymentAmount,
    checkPaymentCurrency: checkResult.amounts.paymentCurrency,
    verifiedAt,
  }
}

export async function reconcileAuthenticatedCallback(
  callback,
  {
    transactionModel = Transaction,
    checkTransaction: checkPaymentStatus = checkTransaction,
    now = () => new Date(),
  } = {},
) {
  const transactionId = requireGeneratedTransactionId(callback)
  let transaction

  try {
    transaction = await transactionModel.findByTranId(transactionId)
  } catch (error) {
    throw new PaymentReconciliationError(
      'Transaction lookup failed.',
      'DATABASE_FAILURE',
      503,
      { cause: error },
    )
  }

  if (!transaction) {
    throw new PaymentReconciliationError(
      'No saved transaction matches this callback.',
      'TRANSACTION_NOT_FOUND',
      404,
    )
  }

  validateCallbackMatch(callback, transaction)

  if (transaction.status === 'PAID') {
    if (isVerifiedPaidTransaction(transaction, callback)) {
      return { acknowledged: true, duplicate: true, status: 'PAID' }
    }

    throw new PaymentReconciliationError(
      'Callback conflicts with an already paid transaction.',
      'PAID_EVIDENCE_CONFLICT',
      409,
    )
  }

  if (transaction.status !== 'PENDING' || transaction.paidAt !== null) {
    throw new PaymentReconciliationError(
      'Transaction state is not eligible for payment reconciliation.',
      'STATE_CONFLICT',
      409,
    )
  }

  let checkResult

  try {
    checkResult = await checkPaymentStatus(transaction.tranId)
  } catch (error) {
    const code = error instanceof CheckTransactionError
      ? `CHECK_${error.code}`
      : 'CHECK_FAILURE'

    throw new PaymentReconciliationError(
      'Payment status verification is temporarily unavailable.',
      code,
      503,
      { cause: error },
    )
  }

  validateApprovalEvidence(callback, checkResult, transaction)

  const verifiedAt = now()
  const verificationEvidence = createVerificationEvidence(
    callback,
    checkResult,
    verifiedAt,
  )

  let updated

  try {
    // This must be one conditional SQL UPDATE in the model.
    updated = await transactionModel.updateByTranId(
      transaction.tranId,
      {
        status: 'PAID',
        paidAt: verifiedAt,
        paywayResponseCode: checkResult.provider.paymentStatusCode,
        verificationEvidence,
      },
      {
        expectedStatus: 'PENDING',
        expectedPaidAtNull: true,
      },
    )
  } catch (error) {
    throw new PaymentReconciliationError(
      'Verified payment could not be persisted.',
      'DATABASE_FAILURE',
      503,
      { cause: error },
    )
  }

  if (updated) {
    return { acknowledged: true, duplicate: false, status: 'PAID' }
  }

  // Another callback may have completed reconciliation first.
  let current

  try {
    current = await transactionModel.findByTranId(transaction.tranId)
  } catch (error) {
    throw new PaymentReconciliationError(
      'Transaction recheck failed.',
      'DATABASE_FAILURE',
      503,
      { cause: error },
    )
  }

  if (isVerifiedPaidTransaction(current, callback)) {
    return { acknowledged: true, duplicate: true, status: 'PAID' }
  }

  throw new PaymentReconciliationError(
    'Concurrent reconciliation produced conflicting evidence.',
    'CONCURRENT_STATE_CONFLICT',
    409,
  )
}
