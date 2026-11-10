import { randomInt } from 'node:crypto'

import { getBakongConfig } from '../config/bakong.js'
import {
  BAKONG_IDEMPOTENCY_KEY_PATTERN,
  BakongPayment,
} from '../models/bakongPayment.js'
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

export class BakongPaymentStorageError extends Error {
  constructor(message = 'Unable to record the verified payment.', options = {}) {
    super(message, options)
    this.name = 'BakongPaymentStorageError'
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
  const expectedMinor = payment.amountMinor
    ?? toMinorUnits(payment.amount, payment.currency)

  return (
    transaction.currency === payment.currency
    && toMinorUnits(transaction.amount, payment.currency) === expectedMinor
  )
}

function toCreateResponse(payment, statusAccessToken, environment) {
  return {
    environment,
    provider: 'BAKONG',
    payment: {
      ...toSafePayment(payment),
      qrString: payment.qrString,
      md5: payment.md5,
    },
    statusAccess: { tranId: payment.tranId, token: statusAccessToken },
  }
}

// Return an existing payment for a repeated idempotency key. The status token
// is rotated because only its hash is stored.
async function replayIdempotentPayment(payment, options) {
  const {
    environment,
    transactionModel,
    userId,
    createStatusToken,
    hashStatusToken,
  } = options

  const statusAccessToken = createStatusToken()
  const rotated = await transactionModel.rotateStatusAccessToken(
    payment.tranId,
    hashStatusToken(statusAccessToken),
    userId,
  )

  return toCreateResponse(
    rotated ?? payment,
    statusAccessToken,
    environment,
  )
}

// Create a Bakong KHQR payment and persist it as PENDING.
export async function createBakongPayment(
  paymentDetails,
  {
    config = getBakongConfig(),
    customerName = 'KhmerFP customer',
    userId,
    idempotencyKey,
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

  // Postgres returns BIGINT ids as strings, so accept either form.
  const normalizedUserId = typeof userId === 'string' && userId.trim() !== ''
    ? Number(userId)
    : userId

  if (!Number.isSafeInteger(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error('A user id is required to create a Bakong payment.')
  }

  if (
    idempotencyKey != null
    && (
      typeof idempotencyKey !== 'string'
      || !BAKONG_IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
    )
  ) {
    throw new BakongPaymentValidationError({
      idempotencyKey: 'Invalid idempotency key.',
    })
  }

  const validation = validateBakongPaymentDetails(paymentDetails, {
    currency: config.qr.currency,
  })

  if (!validation.isValid) {
    throw new BakongPaymentValidationError(validation.errors)
  }

  const replayOptions = {
    environment: config.environment,
    transactionModel,
    userId: normalizedUserId,
    createStatusToken,
    hashStatusToken,
  }

  if (idempotencyKey) {
    let existing

    try {
      existing = await transactionModel.findByUserIdAndIdempotencyKey(
        normalizedUserId,
        idempotencyKey,
      )
    } catch (error) {
      throw new BakongProviderUnavailableError(
        'Payment lookup failed.',
        { cause: error },
      )
    }

    if (existing) {
      return replayIdempotentPayment(existing, replayOptions)
    }
  }

  const statusAccessToken = createStatusToken()
  const statusAccessTokenHash = hashStatusToken(statusAccessToken)
  const amountMinor = toMinorUnits(
    validation.data.amount,
    validation.data.currency,
  )
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
        userId: normalizedUserId,
        tranId,
        md5: qr.md5,
        qrString: qr.qrString,
        name: customerName,
        description: validation.data.description,
        amount: validation.data.amount,
        amountMinor,
        currency: validation.data.currency,
        status: 'PENDING',
        statusAccessTokenHash,
        idempotencyKey: idempotencyKey ?? null,
        expiresAt,
      })

      return toCreateResponse(
        payment,
        statusAccessToken,
        config.environment,
      )
    } catch (error) {
      // A concurrent request with the same idempotency key won the insert.
      if (
        error?.code === '23505'
        && error?.constraint === 'idx_bakong_payments_user_idempotency'
        && idempotencyKey
      ) {
        const existing = await transactionModel.findByUserIdAndIdempotencyKey(
          normalizedUserId,
          idempotencyKey,
        )

        if (existing) {
          return replayIdempotentPayment(existing, replayOptions)
        }
      }

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

  const checkIntervalMs = config.checkIntervalMs ?? 0
  const expiresAt = new Date(payment.expiresAt).getTime()
  const expired = now().getTime() >= expiresAt

  // Throttle upstream checks per payment. Bakong allows only 100 requests per
  // day, so a fast status poll must reuse the last result instead of verifying
  // on every request.
  if (
    checkIntervalMs > 0
    && !expired
    && payment.lastCheckedAt != null
    && now().getTime() - new Date(payment.lastCheckedAt).getTime()
      < checkIntervalMs
  ) {
    return toSafePayment(payment)
  }

  // Claim the check window before calling Bakong so failed calls back off too.
  if (checkIntervalMs > 0 && !expired) {
    await transactionModel.updateStatus(
      payment.tranId,
      { lastCheckedAt: now() },
      { expectedStatus: 'PENDING' },
    )
  }

  const backends = checkTransaction
    ? { checkTransactionByMd5: checkTransaction }
    : getBakongClient()
  let checkResult

  try {
    checkResult = await backends.checkTransactionByMd5(payment.md5)
  } catch (error) {
    // A rate limit does not mean the payment is unpaid, so never expire it:
    // keep it pending and let a later check recover the payment.
    if (error instanceof BakongApiError && error.code === 'RATE_LIMITED') {
      throw new BakongProviderUnavailableError(
        'Payment status verification is temporarily unavailable.',
        { cause: error },
      )
    }

    if (now().getTime() >= expiresAt) {
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
    const evidence = createProviderEvidence(
      checkResult.transaction,
      verifiedAt,
    )
    let updated

    if (payment.userId != null) {
      try {
        updated = await transactionModel.creditVerifiedPayment({
          tranId: payment.tranId,
          statusAccessTokenHash,
          userId: payment.userId,
          amountMinor: payment.amountMinor
            ?? toMinorUnits(payment.amount, payment.currency),
          currency: payment.currency,
          paidAt: verifiedAt,
          providerEvidence: evidence,
        })
      } catch (error) {
        throw new BakongPaymentStorageError(
          'Unable to record the verified payment.',
          { cause: error },
        )
      }
    } else {
      // Legacy rows created before user linkage cannot be credited safely.
      updated = await transactionModel.updateStatus(
        payment.tranId,
        {
          status: 'PAID',
          paidAt: verifiedAt,
          providerEvidence: evidence,
        },
        { expectedStatus: 'PENDING' },
      )
    }

    if (updated) {
      return toSafePayment(updated)
    }

    const current = await transactionModel.findByTranId(payment.tranId, {
      statusAccessTokenHash,
    })

    if (!current) {
      throw new BakongPaymentNotFoundError()
    }

    return toSafePayment(current)
  }

  if (now().getTime() >= expiresAt) {
    const updated = await transactionModel.updateStatus(
      payment.tranId,
      { status: 'EXPIRED' },
      { expectedStatus: 'PENDING' },
    )

    return toSafePayment(updated ?? { ...payment, status: 'EXPIRED' })
  }

  return toSafePayment(payment)
}
