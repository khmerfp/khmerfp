
import { Transaction } from '../models/transaction.js'
import { hashStatusAccessToken } from '../payway/statusAccessToken.js'

export class PaymentStatusUnavailableError extends Error {
  constructor() {
    super('Payment status is unavailable.')
    this.name = 'PaymentStatusUnavailableError'
  }
}

function validateLookupInput(transactionId, token) {
  if (
    typeof transactionId !== 'string'
    || transactionId.length === 0
    || transactionId.length > 20
    || transactionId.trim() !== transactionId
    || typeof token !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/.test(token)
  ) {
    throw new PaymentStatusUnavailableError()
  }
}

export async function getProtectedPaymentStatus(
  transactionId,
  token,
  { transactionModel = Transaction } = {},
) {
  validateLookupInput(transactionId, token)

  const tokenHash = hashStatusAccessToken(token)
  let transaction

  try {
    transaction = await transactionModel.findByTranId(transactionId, {
      statusAccessTokenHash: tokenHash,
    })
  } catch (error) {
    throw new Error('Payment status lookup failed.', { cause: error })
  }

  if (!transaction) {
    throw new PaymentStatusUnavailableError()
  }

  return {
    tranId: transaction.tranId,
    amount: transaction.amount,
    currency: transaction.currency,
    status: transaction.status,
    paidAt: transaction.paidAt ?? null,
  }
}
