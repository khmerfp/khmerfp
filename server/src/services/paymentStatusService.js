import { Transaction } from '../models/transaction.js'
import { hashStatusAccessToken } from '../payway/statusAccessToken.js'

export class PaymentStatusUnavailableError extends Error {
  // create one non-enumerating lookup error
  constructor() {
    super('Payment status is unavailable.')
    this.name = 'PaymentStatusUnavailableError'
  }
}

// validate one protected lookup request
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

// read one minimal protected payment status
export async function getProtectedPaymentStatus(
  transactionId,
  token,
  { transactionModel = Transaction } = {},
) {
  validateLookupInput(transactionId, token)
  const tokenHash = hashStatusAccessToken(token)
  let transaction

  try {
    const query = transactionModel.findOne({
      tranId: transactionId,
      statusAccessTokenHash: tokenHash,
    })
    transaction = typeof query?.select === 'function'
      ? await query.select('tranId amount currency status paidAt')
      : await query
  } catch (error) {
    throw new Error('Payment status lookup failed.', { cause: error })
  }

  if (!transaction) throw new PaymentStatusUnavailableError()

  return {
    tranId: transaction.tranId,
    amount: transaction.amount,
    currency: transaction.currency,
    status: transaction.status,
    paidAt: transaction.paidAt ?? null,
  }
}
