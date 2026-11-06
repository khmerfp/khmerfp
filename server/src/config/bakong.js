// Bakong Open API (National Bank of Cambodia) environment contract.
export const BAKONG_ENDPOINTS = Object.freeze({
  sit: Object.freeze({
    baseUrl: 'https://sit-api-bakong.nbc.org.kh',
  }),
  production: Object.freeze({
    baseUrl: 'https://api-bakong.nbc.gov.kh',
  }),
})

export const BAKONG_DEFAULT_CURRENCY = 'USD'
export const BAKONG_MIN_QR_EXPIRE_MINUTES = 1
export const BAKONG_MAX_QR_EXPIRE_MINUTES = 10
export const BAKONG_DEFAULT_TIMEOUT_MS = 8000

const SUPPORTED_CURRENCIES = ['USD', 'KHR']

// Report safe configuration failures without exposing credentials.
export class BakongConfigurationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BakongConfigurationError'
  }
}

// Select the Bakong API environment.
function parseEnvironment(value) {
  const environment = value === undefined ? 'sit' : value

  if (!Object.hasOwn(BAKONG_ENDPOINTS, environment)) {
    throw new BakongConfigurationError(
      'BAKONG_ENV must be either "sit" or "production".',
    )
  }

  return environment
}

// Parse one strict boolean.
function parseStrictBoolean(value, variableName) {
  if (value === undefined) return false
  if (value === 'true') return true
  if (value === 'false') return false

  throw new BakongConfigurationError(
    `${variableName} must be exactly "true" or "false".`,
  )
}

// Normalize one optional value.
function optionalTrimmedValue(value) {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined
}

// Parse a bounded positive integer.
function parseBoundedInteger(value, variableName, { defaultValue, min, max }) {
  if (value === undefined) return defaultValue

  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new BakongConfigurationError(
      `${variableName} must be an integer from ${min} to ${max}.`,
    )
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new BakongConfigurationError(
      `${variableName} must be an integer from ${min} to ${max}.`,
    )
  }

  return parsed
}

// Parse the KHQR currency.
function parseCurrency(value) {
  if (value === undefined) return BAKONG_DEFAULT_CURRENCY

  const currency = typeof value === 'string' ? value.trim().toUpperCase() : ''

  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw new BakongConfigurationError(
      'BAKONG_CURRENCY must be either "USD" or "KHR".',
    )
  }

  return currency
}

// Resolve and validate Bakong configuration.
export function getBakongConfig(environmentVariables = process.env) {
  const environment = parseEnvironment(environmentVariables.BAKONG_ENV)
  const paymentsEnabled = parseStrictBoolean(
    environmentVariables.BAKONG_PAYMENTS_ENABLED,
    'BAKONG_PAYMENTS_ENABLED',
  )
  const currency = parseCurrency(environmentVariables.BAKONG_CURRENCY)
  const qrExpireMinutes = parseBoundedInteger(
    environmentVariables.BAKONG_QR_EXPIRE_MINUTES,
    'BAKONG_QR_EXPIRE_MINUTES',
    {
      defaultValue: 5,
      min: BAKONG_MIN_QR_EXPIRE_MINUTES,
      max: BAKONG_MAX_QR_EXPIRE_MINUTES,
    },
  )
  const timeoutMs = parseBoundedInteger(
    environmentVariables.BAKONG_TIMEOUT_MS,
    'BAKONG_TIMEOUT_MS',
    { defaultValue: BAKONG_DEFAULT_TIMEOUT_MS, min: 1000, max: 30000 },
  )

  const apiToken = optionalTrimmedValue(environmentVariables.BAKONG_API_TOKEN)
  const email = optionalTrimmedValue(environmentVariables.BAKONG_EMAIL)
  const accountId = optionalTrimmedValue(environmentVariables.BAKONG_ACCOUNT_ID)
  const merchantName = optionalTrimmedValue(
    environmentVariables.BAKONG_MERCHANT_NAME,
  )
  const merchantCity = optionalTrimmedValue(
    environmentVariables.BAKONG_MERCHANT_CITY,
  ) ?? 'Phnom Penh'
  const acquiringBank = optionalTrimmedValue(
    environmentVariables.BAKONG_ACQUIRING_BANK,
  )

  // A token or the registered email is required to call the Bakong API.
  if (paymentsEnabled) {
    if (!accountId || !merchantName) {
      throw new BakongConfigurationError(
        'Bakong payments require BAKONG_ACCOUNT_ID and BAKONG_MERCHANT_NAME.',
      )
    }

    if (!apiToken && !email) {
      throw new BakongConfigurationError(
        'Bakong payments require BAKONG_API_TOKEN or BAKONG_EMAIL.',
      )
    }
  }

  // Return an immutable configuration snapshot.
  return Object.freeze({
    environment,
    paymentsEnabled,
    endpoints: BAKONG_ENDPOINTS[environment],
    credentials: Object.freeze({ apiToken, email }),
    merchant: Object.freeze({
      accountId,
      name: merchantName,
      city: merchantCity,
      acquiringBank,
    }),
    qr: Object.freeze({ currency, expireMinutes: qrExpireMinutes }),
    timeoutMs,
  })
}
