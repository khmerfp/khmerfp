
import { getBakongConfig } from '../config/bakong.js'

export const BAKONG_CHECK_TRANSACTION_PATH = '/v1/check_transaction_by_md5'
export const BAKONG_RENEW_TOKEN_PATH = '/v1/renew_token'

export const TOKEN_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000

const MD5_PATTERN = /^[a-f0-9]{32}$/

export class BakongApiError extends Error {
  constructor(message, code, options = {}) {
    super(message, options)
    this.name = 'BakongApiError'
    this.code = code
  }
}

export function decodeJwtExpiry(token) {
  if (typeof token !== 'string') return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    )

    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

// Accept integer numbers and numeric integer strings.
// Do not silently interpret malformed values as successful responses.
function parseIntegerCode(value) {
  if (Number.isInteger(value)) return value

  if (
    typeof value === 'string'
    && /^-?\d+$/.test(value.trim())
  ) {
    const parsed = Number(value.trim())
    return Number.isSafeInteger(parsed) ? parsed : null
  }

  return null
}

export function normalizeCheckTransactionResponse(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      found: false,
      responseCode: null,
      errorCode: null,
      message: 'Malformed Bakong response.',
      transaction: null,
    }
  }

  const responseCode = parseIntegerCode(body.responseCode)
  const errorCode = parseIntegerCode(body.errorCode)

  const message = typeof body.responseMessage === 'string'
    ? body.responseMessage
    : null

  if (responseCode !== 0) {
    return {
      found: false,
      responseCode,
      errorCode,
      message,
      transaction: null,
    }
  }

  const data = body.data

  if (
    data === null
    || typeof data !== 'object'
    || Array.isArray(data)
  ) {
    return {
      found: false,
      responseCode,
      errorCode,
      message: 'Bakong returned no transaction data.',
      transaction: null,
    }
  }

  const amount = Number(data.amount)

  const currency = typeof data.currency === 'string'
    ? data.currency.toUpperCase()
    : null

  if (!Number.isFinite(amount) || amount <= 0 || !currency) {
    return {
      found: false,
      responseCode,
      errorCode,
      message: 'Bakong returned incomplete transaction data.',
      transaction: null,
    }
  }

  return {
    found: true,
    responseCode,
    errorCode,
    message,
    transaction: {
      hash: typeof data.hash === 'string' ? data.hash : null,
      fromAccountId: typeof data.fromAccountId === 'string'
        ? data.fromAccountId
        : null,
      toAccountId: typeof data.toAccountId === 'string'
        ? data.toAccountId
        : null,
      amount,
      currency,
      description: typeof data.description === 'string'
        ? data.description
        : null,
    },
  }
}

async function requestJson(url, options, { transport, timeoutMs }) {
  const controller = new AbortController()
  let timeout

  const timeoutFailure = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort()
      reject(new BakongApiError('Bakong request timed out.', 'TIMEOUT'))
    }, timeoutMs)
  })

  try {
    const response = await Promise.race([
      transport(url, {
        ...options,
        signal: controller.signal,
      }),
      timeoutFailure,
    ])

    if (!response?.ok) {
      const code = response?.status === 401 || response?.status === 403
        ? 'HTTP_UNAUTHORIZED'
        : 'HTTP_ERROR'

      throw new BakongApiError(
        `Bakong API returned HTTP ${response?.status ?? 'unknown'}.`,
        code,
      )
    }

    try {
      return await Promise.race([
        response.json(),
        timeoutFailure,
      ])
    } catch (error) {
      if (error instanceof BakongApiError) throw error

      throw new BakongApiError(
        'Bakong API returned invalid JSON.',
        'INVALID_JSON',
        { cause: error },
      )
    }
  } catch (error) {
    if (error instanceof BakongApiError) throw error

    if (error?.name === 'AbortError' || controller.signal.aborted) {
      throw new BakongApiError(
        'Bakong request timed out.',
        'TIMEOUT',
        { cause: error },
      )
    }

    throw new BakongApiError(
      'Bakong network request failed.',
      'NETWORK_FAILURE',
      { cause: error },
    )
  } finally {
    clearTimeout(timeout)
  }
}

export function createBakongClient({
  config = getBakongConfig(),
  transport = fetch,
  now = () => Date.now(),
} = {}) {
  let token = config.credentials.apiToken ?? null
  let tokenExpiresAt = token ? decodeJwtExpiry(token) : null

  function hasUsableToken() {
    if (!token) return false
    if (tokenExpiresAt === null) return true

    return tokenExpiresAt - now() > TOKEN_REFRESH_WINDOW_MS
  }

  async function renewToken() {
    const email = config.credentials.email

    if (!email) {
      throw new BakongApiError(
        'Bakong email is not configured for token renewal.',
        'MISSING_EMAIL',
      )
    }

    const body = await requestJson(
      `${config.endpoints.baseUrl}${BAKONG_RENEW_TOKEN_PATH}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      },
      {
        transport,
        timeoutMs: config.timeoutMs,
      },
    )

    const renewedToken = body?.data?.token

    if (typeof renewedToken !== 'string' || renewedToken === '') {
      throw new BakongApiError(
        'Bakong token renewal returned no token.',
        'TOKEN_RENEWAL_FAILED',
      )
    }

    token = renewedToken
    tokenExpiresAt = decodeJwtExpiry(renewedToken)

    return renewedToken
  }

  async function getToken() {
    if (hasUsableToken()) return token

    if (config.credentials.email) return renewToken()

    if (token) return token

    throw new BakongApiError(
      'Bakong API credentials are not configured.',
      'MISSING_CONFIGURATION',
    )
  }

  async function checkTransactionByMd5(md5) {
    if (typeof md5 !== 'string' || !MD5_PATTERN.test(md5)) {
      throw new TypeError(
        'MD5 must be a 32-character lowercase hex digest.',
      )
    }

    const url =
      `${config.endpoints.baseUrl}${BAKONG_CHECK_TRANSACTION_PATH}`

    const makeRequest = async (bearerToken) => requestJson(
      url,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${bearerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ md5 }),
      },
      {
        transport,
        timeoutMs: config.timeoutMs,
      },
    )

    let body

    try {
      body = await makeRequest(await getToken())
    } catch (error) {
      if (
        error instanceof BakongApiError
        && error.code === 'HTTP_UNAUTHORIZED'
        && config.credentials.email
      ) {
        body = await makeRequest(await renewToken())
      } else {
        throw error
      }
    }

    const data = body?.data

    // Temporary diagnostic logging. Never log tokens, hashes, or account IDs.
    console.info('bakong.check_transaction.response_summary', {
      responseCode: body?.responseCode ?? null,
      responseCodeType: typeof body?.responseCode,
      errorCode: body?.errorCode ?? null,
      errorCodeType: typeof body?.errorCode,
      responseMessage: body?.responseMessage ?? null,
      dataType: Array.isArray(data) ? 'array' : typeof data,
      dataKeys: data && typeof data === 'object'
        ? Object.keys(data)
        : [],
      amountType: typeof data?.amount,
      currency: data?.currency ?? null,
      hashPresent: typeof data?.hash === 'string',
      fromAccountIdPresent: typeof data?.fromAccountId === 'string',
      toAccountIdPresent: typeof data?.toAccountId === 'string',
    })

    return normalizeCheckTransactionResponse(body)
  }

  return {
    checkTransactionByMd5,
    getToken,
    renewToken,
    getCachedToken: () => token,
  }
}

let defaultClient

export function getBakongClient() {
  if (!defaultClient) {
    defaultClient = createBakongClient()
  }

  return defaultClient
}
