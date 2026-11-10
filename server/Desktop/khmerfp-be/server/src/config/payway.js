const PURCHASE_PATH = 'api/payment-gateway/v1/payments/purchase'
const CHECK_TRANSACTION_PATH = 'api/payment-gateway/v1/payments/check-transaction-2'

export const PAYWAY_ENDPOINTS = Object.freeze({
  // map fixed payway endpoints
  sandbox: Object.freeze({
    purchase: `https://checkout-sandbox.payway.com.kh/${PURCHASE_PATH}`,
    checkTransaction: `https://checkout-sandbox.payway.com.kh/${CHECK_TRANSACTION_PATH}`,
  }),
  production: Object.freeze({
    purchase: `https://checkout.payway.com.kh/${PURCHASE_PATH}`,
    checkTransaction: `https://checkout.payway.com.kh/${CHECK_TRANSACTION_PATH}`,
  }),
})

const PAYWAY_VARIABLES = Object.freeze({
  sandbox: Object.freeze({
    merchantId: 'PAYWAY_SANDBOX_MERCHANT_ID',
    apiKey: 'PAYWAY_SANDBOX_API_KEY',
    callbackSecret: 'PAYWAY_SANDBOX_CALLBACK_SECRET',
    successUrl: 'PAYWAY_SANDBOX_SUCCESS_URL',
    cancelUrl: 'PAYWAY_SANDBOX_CANCEL_URL',
  }),
  production: Object.freeze({
    merchantId: 'PAYWAY_PRODUCTION_MERCHANT_ID',
    apiKey: 'PAYWAY_PRODUCTION_API_KEY',
    callbackSecret: 'PAYWAY_PRODUCTION_CALLBACK_SECRET',
    successUrl: 'PAYWAY_PRODUCTION_SUCCESS_URL',
    cancelUrl: 'PAYWAY_PRODUCTION_CANCEL_URL',
  }),
})

// report safe configuration failures
export class PayWayConfigurationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PayWayConfigurationError'
  }
}

// select the payway environment
function parseEnvironment(value) {
  const environment = value === undefined ? 'sandbox' : value

  if (!Object.hasOwn(PAYWAY_ENDPOINTS, environment)) {
    throw new PayWayConfigurationError(
      'PAYWAY_ENV must be either "sandbox" or "production".',
    )
  }

  return environment
}

// parse one strict boolean
function parseStrictBoolean(value) {
  if (value === undefined) return false
  if (value === 'true') return true
  if (value === 'false') return false

  throw new PayWayConfigurationError(
    'PAYWAY_CHECKOUT_ENABLED must be exactly "true" or "false".',
  )
}

// normalize one optional value
function optionalTrimmedValue(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

// validate one navigation url
function optionalUrl(value, variableName, requireHttps) {
  const normalizedValue = optionalTrimmedValue(value)
  if (!normalizedValue) return undefined

  try {
    const parsedUrl = new URL(normalizedValue)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Unsupported navigation URL protocol.')
    }
    if (requireHttps && parsedUrl.protocol !== 'https:') {
      throw new Error('Production navigation URLs require HTTPS.')
    }
  } catch {
    const protocol = requireHttps ? 'an HTTPS URL' : 'an HTTP or HTTPS URL'
    throw new PayWayConfigurationError(`${variableName} must be ${protocol}.`)
  }

  return normalizedValue
}

export function getPayWayConfig(environmentVariables = process.env) {
  // resolve the selected environment
  const environment = parseEnvironment(environmentVariables.PAYWAY_ENV)
  const checkoutEnabled = parseStrictBoolean(
    environmentVariables.PAYWAY_CHECKOUT_ENABLED,
  )

  // keep live checkout blocked
  if (checkoutEnabled && environment === 'production') {
    throw new PayWayConfigurationError(
      'PayWay checkout cannot be enabled in production at this project stage.',
    )
  }

  const variables = PAYWAY_VARIABLES[environment]
  const merchantId = optionalTrimmedValue(environmentVariables[variables.merchantId])
  const apiKey = optionalTrimmedValue(environmentVariables[variables.apiKey])
  const callbackSecret = optionalTrimmedValue(
    environmentVariables[variables.callbackSecret],
  )
  const successUrl = optionalUrl(
    environmentVariables[variables.successUrl],
    variables.successUrl,
    environment === 'production',
  )
  const cancelUrl = optionalUrl(
    environmentVariables[variables.cancelUrl],
    variables.cancelUrl,
    environment === 'production',
  )

  // require complete sandbox checkout settings
  if (checkoutEnabled && (!merchantId || !apiKey || !successUrl || !cancelUrl)) {
    throw new PayWayConfigurationError(
      'Sandbox checkout requires merchant credentials and success/cancel URLs.',
    )
  }

  // return immutable configuration
  return Object.freeze({
    environment,
    checkoutEnabled,
    endpoints: PAYWAY_ENDPOINTS[environment],
    credentials: Object.freeze({ merchantId, apiKey }),
    callback: Object.freeze({
      secret: callbackSecret,
    }),
    navigation: Object.freeze({ successUrl, cancelUrl }),
  })
}
