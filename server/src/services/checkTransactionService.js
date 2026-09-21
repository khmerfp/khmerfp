import { getPayWayConfig } from '../config/payway.js'
import { signCheckTransaction } from '../payway/checkTransactionSigning.js'

export const CHECK_TRANSACTION_TIMEOUT_MS = 5000

// status codes 
const DOCUMENTED_OUTCOMES = Object.freeze({
  '0:APPROVED': 'APPROVED',
  '2:PENDING': 'PENDING',
  '3:DECLINED': 'DECLINED',
  '7:CANCELLED': 'CANCELLED',
})

export class CheckTransactionError extends Error {
  // create a safe check transaction error
  constructor(message, code, options = {}) {
    super(message, options)
    this.name = 'CheckTransactionError'
    this.code = code
  }
}

// format utc time for the status request
function formatRequestTime(date) {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14)
}

// validate the exact transaction id string
function validateTransactionId(transactionId) {
  if (
    typeof transactionId !== 'string'
    || transactionId.length === 0
    || transactionId.length > 20
    || transactionId.trim() !== transactionId
  ) {
    throw new CheckTransactionError(
      'Transaction ID must be a non-empty string of at most 20 characters.',
      'INVALID_TRANSACTION_ID',
    )
  }

  return transactionId
}

// convert one provider value to a code string
function toCode(value) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : null
}

// keep only finite monetary values
function toAmount(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// create an unknown unverified result
function unknownResult(reason, provider = {}, amounts = {}, apiSuccess = false) {
  return {
    apiSuccess,
    outcome: 'UNKNOWN',
    paymentApproved: false,
    verification: 'UNVERIFIED',
    reason,
    provider: {
      apiCode: provider.apiCode ?? null,
      paymentStatusCode: provider.paymentStatusCode ?? null,
      paymentStatus: provider.paymentStatus ?? null,
      transactionId: provider.transactionId ?? null,
    },
    amounts: {
      originalAmount: amounts.originalAmount ?? null,
      originalCurrency: null,
      totalAmount: amounts.totalAmount ?? null,
      paymentAmount: amounts.paymentAmount ?? null,
      paymentCurrency: amounts.paymentCurrency ?? null,
    },
  }
}

// normalize a documented provider response
export function normalizeCheckTransactionResponse(responseBody, requestedId) {
  if (
    responseBody === null
    || typeof responseBody !== 'object'
    || Array.isArray(responseBody)
    || responseBody.status === null
    || typeof responseBody.status !== 'object'
    || Array.isArray(responseBody.status)
  ) {
    return unknownResult('MALFORMED_RESPONSE')
  }

  const apiCode = toCode(responseBody.status.code)
  const responseId = typeof responseBody.status.tran_id === 'string'
    ? responseBody.status.tran_id
    : null
  const data = responseBody.data
  const provider = {
    apiCode,
    paymentStatusCode: toCode(data?.payment_status_code),
    paymentStatus: typeof data?.payment_status === 'string'
      ? data.payment_status
      : null,
    transactionId: responseId,
  }
  const amounts = {
    originalAmount: toAmount(data?.original_amount),
    totalAmount: toAmount(data?.total_amount),
    paymentAmount: toAmount(data?.payment_amount),
    paymentCurrency: typeof data?.payment_currency === 'string'
      ? data.payment_currency
      : null,
  }

  if (responseId !== requestedId) {
    return unknownResult(
      'TRANSACTION_ID_MISMATCH',
      provider,
      amounts,
      apiCode === '00',
    )
  }

  if (apiCode !== '00') {
    return unknownResult('API_ERROR', provider, amounts)
  }

  if (!provider.paymentStatusCode || !provider.paymentStatus) {
    return unknownResult('MISSING_PAYMENT_STATUS', provider, amounts, true)
  }

  if (
    amounts.originalAmount === null
    || amounts.totalAmount === null
    || !amounts.paymentCurrency
  ) {
    return unknownResult('MISSING_RECONCILIATION_FIELDS', provider, amounts, true)
  }

  const outcome = DOCUMENTED_OUTCOMES[
    `${provider.paymentStatusCode}:${provider.paymentStatus}`
  ]

  if (!outcome) {
    return unknownResult('UNEXPECTED_PAYMENT_STATUS', provider, amounts, true)
  }

  return {
    apiSuccess: true,
    outcome,
    paymentApproved: outcome === 'APPROVED',
    verification: 'UNVERIFIED',
    reason: 'RECONCILIATION_REQUIRED',
    provider,
    amounts: {
      ...amounts,
      originalCurrency: null,
    },
  }
}

// check one existing sandbox transaction
export async function checkSandboxTransaction(
  transactionId,
  {
    config = getPayWayConfig(),
    now = () => new Date(),
    transport = fetch,
    timeoutMs = CHECK_TRANSACTION_TIMEOUT_MS,
    signer = signCheckTransaction,
  } = {},
) {
  const tranId = validateTransactionId(transactionId)

  if (config.environment !== 'sandbox') {
    throw new CheckTransactionError(
      'Check Transaction is restricted to sandbox.',
      'ENVIRONMENT_NOT_ALLOWED',
    )
  }

  const { merchantId, apiKey } = config.credentials
  if (!merchantId || !apiKey) {
    throw new CheckTransactionError(
      'Sandbox Check Transaction credentials are not configured.',
      'MISSING_CONFIGURATION',
    )
  }

  const signingFields = {
    req_time: formatRequestTime(now()),
    merchant_id: merchantId,
    tran_id: tranId,
  }
  const requestBody = {
    ...signingFields,
    hash: signer(signingFields, apiKey),
  }
  const controller = new AbortController()
  let timeout
  const timeoutFailure = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new CheckTransactionError(
        'Check Transaction request timed out.',
        'TIMEOUT',
      ))
    }, timeoutMs)
  })
  let responseBody

  try {
    const response = await Promise.race([
      transport(config.endpoints.checkTransaction, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }),
      timeoutFailure,
    ])

    if (!response?.ok) {
      throw new CheckTransactionError(
        'Check Transaction returned a non-success HTTP response.',
        'HTTP_ERROR',
      )
    }

    try {
      responseBody = await Promise.race([response.json(), timeoutFailure])
    } catch (error) {
      if (error?.name === 'AbortError' || controller.signal.aborted) throw error

      throw new CheckTransactionError(
        'Check Transaction returned invalid JSON.',
        'INVALID_JSON',
        { cause: error },
      )
    }
  } catch (error) {
    if (error instanceof CheckTransactionError) throw error

    if (error?.name === 'AbortError' || controller.signal.aborted) {
      throw new CheckTransactionError(
        'Check Transaction request timed out.',
        'TIMEOUT',
        { cause: error },
      )
    }

    throw new CheckTransactionError(
      'Check Transaction network request failed.',
      'NETWORK_FAILURE',
      { cause: error },
    )
  } finally {
    clearTimeout(timeout)
  }

  return normalizeCheckTransactionResponse(responseBody, tranId)
}
