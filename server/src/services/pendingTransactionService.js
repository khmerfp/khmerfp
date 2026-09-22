import { randomInt } from 'node:crypto'
import { Transaction } from '../models/transaction.js'
import { validatePaymentDetails } from '../validation/paymentValidation.js'

export const TRANSACTION_ID_LENGTH = 20
export const MAX_TRANSACTION_ID_ATTEMPTS = 3

export class PaymentDetailsValidationError extends Error {
  // keep validation details available to internal callers
  constructor(errors) {
    super('Payment details are invalid.')
    this.name = 'PaymentDetailsValidationError'
    this.errors = errors
  }
}

// generate the proposed decimal transaction id
export function generateTransactionId() {
  let transactionId = String(randomInt(1, 10))

  while (transactionId.length < TRANSACTION_ID_LENGTH) {
    transactionId += String(randomInt(0, 10))
  }

  return transactionId
}

// identify only duplicate transaction id errors
function isTransactionIdCollision(error, transactionId) {
  if (error?.code !== 11000) {
    return false
  }

  return error?.keyPattern?.tranId === 1 || error?.keyValue?.tranId === transactionId
}

// validate and persist one pending transaction
export async function preparePendingTransaction(
  paymentDetails,
  {
    transactionModel = Transaction,
    transactionIdGenerator = generateTransactionId,
    maxAttempts = MAX_TRANSACTION_ID_ATTEMPTS,
    statusAccessTokenHash,
  } = {},
) {
  const validation = validatePaymentDetails(paymentDetails)

  if (!validation.isValid) {
    throw new PaymentDetailsValidationError(validation.errors)
  }

  const { name, accountNumber, amount, currency } = validation.data

  if (
    statusAccessTokenHash !== undefined
    && (
      typeof statusAccessTokenHash !== 'string'
      || !/^[a-f0-9]{64}$/.test(statusAccessTokenHash)
    )
  ) {
    throw new TypeError('Status access token hash must be a SHA-256 hex digest.')
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const tranId = transactionIdGenerator()

    try {
      const transactionValues = {
        tranId,
        name,
        accountNumber,
        amount,
        currency,
        status: 'PENDING',
      }
      if (statusAccessTokenHash !== undefined) {
        transactionValues.statusAccessTokenHash = statusAccessTokenHash
      }
      const transaction = await transactionModel.create(transactionValues)

      return {
        tranId: transaction.tranId,
        amount: transaction.amount,
        currency: transaction.currency,
        status: transaction.status,
      }
    } catch (error) {
      const canRetry =
        attempt < maxAttempts && isTransactionIdCollision(error, tranId)

      if (!canRetry) {
        throw error
      }
    }
  }

  throw new Error('Pending transaction preparation failed.')
}
