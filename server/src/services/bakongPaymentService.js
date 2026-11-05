import { randomInt } from 'node:crypto'

import { getBakongConfig } from '../config/bakong.js'
import { BakongPayment } from '../models/bakongPayment.js'
import { BakongKhqrError, generateBakongKhqr } from '../payway/bakongKhqr.js'
import {
  generateStatusAccessToken,
  hashStatusAccessToken,
} from '../payway/statusAccessToken.js'
import {
  BakongApiError,
  getBakongClient,
} from './bakongClient.js'
import { validateBakongPaymentDetails } from '../validation/bakongPaymentValidation.js'

export const BAKONG_TRANSACTION_ID_MAX_LENGTH = 25
export const MAX_TRANSACTION_ID_ATTEMPTS = 3
export const STATUS_ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

const TRANSACTION_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export class BakongPaymentsUnavailableError extends Error {
  constructor(message = 'Bakong payments are unavailable.', options = {}) {
    super(message, options)
    this.name = 'BakongPaymentsUnavailableError'
  }
}

export class BakongPaymentValidationError extends Error {
  constructor(errors) {
    super('Payment details are invalid.')
    this.name = 'BakongPaymentValidationError'
    this.errors = errors
  }
}

export class BakongPaymentNotFoundError extends Error {
  constructor() {
    super('Payment is unavailable.')
    this.name = 'BakongPaymentNotFoundError'
  }
}

export class BakongProviderUnavailableError extends Error {
  constructor(message = 'Bakong status verification is unavailable.', options = {}) {
    super(message, options)
    this.name = 'BakongProviderUnavailableError'
  }
}

// Generate a unique KHQR bill number that fits the 25-character limit.
export function generateBakongTransactionId(now = () => Date.now()) {
  const timePart = now().toString(36).toUpperCase()
  let randomPart = ''

  for (let index = 0; index < 6; index += 1) {
    randomPart += TRANSACTION_ID_ALPHABET[
      randomInt(0, TRANSACTION_ID_ALPHABET.length)
    ]
  }

  return `FP${timePart}${randomPart}`.slice(0, BAKONG_TRANSACTION_ID_MAX_LENGTH)
}

// Store money in minor units so comparisons do not drift on floats.
export function toMinorUnits(amount, currency) {
  return currency === 'KHR'
    ? Math.round(amount)
    : Math.round(amount * 100)
}

// PostgreSQL unique constraint violation for tran_id or md5.
function isPaymentCollision(error) {
  return error?.code === '23505'
    && (
      error?.constraint === 'bakong_payments_tran_id_key'
      || error?.constraint === 'bakong_payments_md5_key'
      || error?.constraint === 'bakong_payments_pkey'
    )
}

// Keep only fields that are safe to return to the browser.
export function toSafePayment(payment) {
  return {
    tranId: payment.tranId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    expiresAt: payment.expiresAt,
    paidAt: payment.paidAt ?? null,
  }
}

function validateStatusLookup(transactionId, token) {
  if (
    typeof transactionId !== 'string'
    || transactionId.length === 0
    || transactionId.length > BAKONG_TRANSACTION_ID_MAX_LENGTH
    || transactionId.trim() !== transactionId
    || typeof token !== 'string'
    || !STATUS_ACCESS_TOKEN_PATTERN.test(token)
  ) {
    throw new BakongPaymentNotFoundError()
  }
}

function createProviderEvidence(transaction, verifiedAt) {
  return {
    source: 'BAKONG_OPEN_API',
    checkTransactionHash: transaction.hash,
    fromAccountId: transaction.fromAccountId,
    toAccountId: transaction.toAccountId,
    amount: transaction.amount,
    currency: transaction.currency,
    description: transaction.description,
    verifiedAt: verifiedAt.toISOString(),
  }
}

function paymentMatchesTransaction(payment, transaction) {
  return (
    transaction.currency === payment.currency
    && toMinorUnits(transaction.amount, payment.currency)
      === toMinorUnits(payment.amount, payment.currency)
  )
}

// Create a Bakong KHQR payment and persist it as PENDING.
export async function createBakongPayment(
  paymentDetails,
  {
    config = getBakongConfig(),
    customerName = 'KhmerFP customer',
    now = () => new Date(),
    transactionModel = BakongPayment,
    generateQr = generateBakongKhqr,
    transactionIdGenerator = generateBakongTransactionId,
    createStatusToken = generateStatusAccessToken,
    hashStatusToken = hashStatusAccessToken,
    maxAttempts = MAX_TRANSACTION_ID_ATTEMPTS,
  } = {},
) {
  if (!config.paymentsEnabled) {
    throw new BakongPaymentsUnavailableError()
  }

  const validation = validateBakongPaymentDetails(paymentDetails, {
    currency: config.qr.currency,
  })

  if (!validation.isValid) {
    throw new BakongPaymentValidationError(validation.errors)
  }

  const statusAccessToken = createStatusToken()
  const statusAccessTokenHash = hashStatusToken(statusAccessToken)
  const expiresAt = new Date(
    now().getTime() + config.qr.expireMinutes * 60 * 1000,
  )

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const tranId = transactionIdGenerator()

    let qr

    try {
      qr = generateQr({
        accountId: config.merchant.accountId,
        merchantName: config.merchant.name,
        merchantCity: config.merchant.city,
        acquiringBank: config.merchant.acquiringBank,
        amount: validation.data.amount,
        currency: validation.data.currency,
        billNumber: tranId,
        storeLabel: 'KhmerFP',
        expiresAt,
      })
    } catch (error) {
      throw new BakongPaymentsUnavailableError(
        'Unable to create a Bakong KHQR right now.',
        { cause: error },
      )
    }

    try {
      const payment = await transactionModel.create({
        tranId,
        md5: qr.md5,
        qrString: qr.qrString,
        name: customerName,
        description: validation.data.description,
        amount: validation.data.amount,
        currency: validation.data.currency,
        status: 'PENDING',
        statusAccessTokenHash,
        expiresAt,
      })

      return {
        environment: config.environment,
        provider: 'BAKONG',
        payment: {
          ...toSafePayment(payment),
          qrString: payment.qrString,
          md5: payment.md5,
        },
        statusAccess: { tranId: payment.tranId, token: statusAccessToken },
      }
    } catch (error) {
      if (
        error instanceof BakongKhqrError
        || !isPaymentCollision(error)
        || attempt === maxAttempts
      ) {
        throw error
      }
    }
  }

  throw new BakongPaymentsUnavailableError('Bakong payment creation failed.')
}

// Read a payment status and verify it with Bakong while it is pending.
export async function getBakongPaymentStatus(
  transactionId,
  token,
  {
    config = getBakongConfig(),
    now = () => new Date(),
    transactionModel = BakongPayment,
    checkTransaction,
  } = {},
) {
  validateStatusLookup(transactionId, token)

  if (!config.paymentsEnabled) {
    throw new BakongPaymentsUnavailableError()
  }

  const statusAccessTokenHash = hashStatusAccessToken(token)
  let payment

  try {
    payment = await transactionModel.findByTranId(transactionId, {
      statusAccessTokenHash,
    })
  } catch (error) {
    throw new BakongProviderUnavailableError(
      'Payment status lookup failed.',
      { cause: error },
    )
  }

  if (!payment) {
    throw new BakongPaymentNotFoundError()
  }

  if (payment.status !== 'PENDING') {
    return toSafePayment(payment)
  }

  const backends = checkTransaction
    ? { checkTransactionByMd5: checkTransaction }
    : getBakongClient()
  let checkResult

  try {
    checkResult = await backends.checkTransactionByMd5(payment.md5)
  } catch (error) {
    if (now().getTime() >= new Date(payment.expiresAt).getTime()) {
      await transactionModel.updateStatus(
        payment.tranId,
        { status: 'EXPIRED' },
        { expectedStatus: 'PENDING' },
      )

      return {
        ...toSafePayment(payment),
        status: 'EXPIRED',
      }
    }

    const code = error instanceof BakongApiError ? error.code : 'CHECK_FAILURE'

    throw new BakongProviderUnavailableError(
      `Bakong status check failed (${code}).`,
      { cause: error },
    )
  }

  if (checkResult.found) {
    if (!paymentMatchesTransaction(payment, checkResult.transaction)) {
      const updated = await transactionModel.updateStatus(
        payment.tranId,
        {
          status: 'FAILED',
          providerEvidence: createProviderEvidence(
            checkResult.transaction,
            now(),
          ),
        },
        { expectedStatus: 'PENDING' },
      )

      return toSafePayment(updated ?? { ...payment, status: 'FAILED' })
    }

    const verifiedAt = now()
    const updated = await transactionModel.updateStatus(
      payment.tranId,
      {
        status: 'PAID',
        paidAt: verifiedAt,
        providerEvidence: createProviderEvidence(
          checkResult.transaction,
          verifiedAt,
        ),
      },
      { expectedStatus: 'PENDING' },
    )

    if (updated) {
      return toSafePayment(updated)
    }

    const current = await transactionModel.findByTranId(payment.tranId, {
      statusAccessTokenHash,
    })

    return toSafePayment(current ?? { ...payment, status: 'PAID' })
  }

  if (now().getTime() >= new Date(payment.expiresAt).getTime()) {
    const updated = await transactionModel.updateStatus(
      payment.tranId,
      { status: 'EXPIRED' },
      { expectedStatus: 'PENDING' },
    )

    return toSafePayment(updated ?? { ...payment, status: 'EXPIRED' })
  }

  return toSafePayment(payment)
}
