const PURCHASE_PATH = 'api/payment-gateway/v1/payments/purchase'
const CHECK_TRANSACTION_PATH = 'api/payment-gateway/v1/payments/check-transaction-2'

export const PAYWAY_ENDPOINTS = Object.freeze({

  // immutable mapping of payWay environment endpoints
  sandbox: Object.freeze({
    purchase: `https://checkout-sandbox.payway.com.kh/${PURCHASE_PATH}`,
    checkTransaction: `https://checkout-sandbox.payway.com.kh/${CHECK_TRANSACTION_PATH}`,
  }),
  production: Object.freeze({
    purchase: `https://checkout.payway.com.kh/${PURCHASE_PATH}`,
    checkTransaction: `https://checkout.payway.com.kh/${CHECK_TRANSACTION_PATH}`,
  }),
})

// ==> custom Error class thrown when configuration validation fails
export class PayWayConfigurationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PayWayConfigurationError'
  }
}

//=====> parses and validates the target deployment environment
// defaults to 'sandbox' if undefined for developer safety
function parseEnvironment(value) {
  const environment = value === undefined ? 'sandbox' : value

  if (!Object.hasOwn(PAYWAY_ENDPOINTS, environment)) {
    throw new PayWayConfigurationError(
      'PAYWAY_ENV must be either "sandbox" or "production".',
    )
  }

  return environment
}

// ===> strict parses a boolean stirng value

function parseStrictBoolean(value) {
  if (value === undefined) return false
  if (value === 'true') return true
  if (value === 'false') return false

  throw new PayWayConfigurationError(
    'PAYWAY_CHECKOUT_ENABLED must be exactly "true" or "false".',
  )
}

// ====> safely santizies optinal string configuration variable by triming whitespace
function optionalTrimmedValue(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

// validate one configured navigation url
function optionalUrl(value, variableName) {
  const normalizedValue = optionalTrimmedValue(value)
  if (!normalizedValue) return undefined

  try {
    const parsedUrl = new URL(normalizedValue)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Unsupported navigation URL protocol.')
    }
  } catch {
    throw new PayWayConfigurationError(`${variableName} must be an HTTP or HTTPS URL.`)
  }

  return normalizedValue
}

export function getPayWayConfig(environmentVariables = process.env) {

  //=====> resolve and validate the environment
  const environment = parseEnvironment(environmentVariables.PAYWAY_ENV)

  //====> parse the strict checkout
  const checkoutEnabled = parseStrictBoolean(
    environmentVariables.PAYWAY_CHECKOUT_ENABLED,
  )

  //====> disallow live production
  if (checkoutEnabled && environment === 'production') {
    throw new PayWayConfigurationError(
      'PayWay checkout cannot be enabled in production at this project stage.',
    )
  }

  //====> retrive and sanitize sanbox merchant
  const merchantId = optionalTrimmedValue(
    environmentVariables.PAYWAY_SANDBOX_MERCHANT_ID,
  )
  const apiKey = optionalTrimmedValue(environmentVariables.PAYWAY_SANDBOX_API_KEY)
  const callbackSecret = optionalTrimmedValue(
    environmentVariables.PAYWAY_SANDBOX_CALLBACK_SECRET,
  )
  const successUrl = optionalUrl(
    environmentVariables.PAYWAY_SANDBOX_SUCCESS_URL,
    'PAYWAY_SANDBOX_SUCCESS_URL',
  )
  const cancelUrl = optionalUrl(
    environmentVariables.PAYWAY_SANDBOX_CANCEL_URL,
    'PAYWAY_SANDBOX_CANCEL_URL',
  )

  //===> validation check.. ensure credential exist
  if (checkoutEnabled && (!merchantId || !apiKey || !successUrl || !cancelUrl)) {
    throw new PayWayConfigurationError(
      'Sandbox checkout requires merchant credentials and success/cancel URLs.',
    )
  }

  //===> return a completly frozen
  return Object.freeze({
    environment,
    checkoutEnabled,
    endpoints: PAYWAY_ENDPOINTS[environment],
    credentials: Object.freeze({ merchantId, apiKey }),
    callback: Object.freeze({
      secret: environment === 'sandbox' ? callbackSecret : undefined,
    }),
    navigation: Object.freeze({ successUrl, cancelUrl }),
  })
}
