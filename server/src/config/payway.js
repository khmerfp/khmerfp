const PURCHASE_PATH = 'api/payment-gateway/v1/payments/purchase'
const CHECK_TRANSACTION_PATH = 'api/payment-gateway/v1/payments/check-transaction-2'

export const PAYWAY_ENDPOINTS = Object.freeze({
  sandbox: Object.freeze({
    purchase: `https://checkout-sandbox.payway.com.kh/${PURCHASE_PATH}`,
    checkTransaction: `https://checkout-sandbox.payway.com.kh/${CHECK_TRANSACTION_PATH}`,
  }),
  production: Object.freeze({
    purchase: `https://checkout.payway.com.kh/${PURCHASE_PATH}`,
    checkTransaction: `https://checkout.payway.com.kh/${CHECK_TRANSACTION_PATH}`,
  }),
})

export class PayWayConfigurationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PayWayConfigurationError'
  }
}

function parseEnvironment(value) {
  const environment = value === undefined ? 'sandbox' : value

  if (!Object.hasOwn(PAYWAY_ENDPOINTS, environment)) {
    throw new PayWayConfigurationError(
      'PAYWAY_ENV must be either "sandbox" or "production".',
    )
  }

  return environment
}

function parseStrictBoolean(value) {
  if (value === undefined) return false
  if (value === 'true') return true
  if (value === 'false') return false

  throw new PayWayConfigurationError(
    'PAYWAY_CHECKOUT_ENABLED must be exactly "true" or "false".',
  )
}

function optionalTrimmedValue(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export function getPayWayConfig(environmentVariables = process.env) {
  const environment = parseEnvironment(environmentVariables.PAYWAY_ENV)
  const checkoutEnabled = parseStrictBoolean(
    environmentVariables.PAYWAY_CHECKOUT_ENABLED,
  )

  if (checkoutEnabled && environment === 'production') {
    throw new PayWayConfigurationError(
      'PayWay checkout cannot be enabled in production at this project stage.',
    )
  }

  const merchantId = optionalTrimmedValue(
    environmentVariables.PAYWAY_SANDBOX_MERCHANT_ID,
  )
  const apiKey = optionalTrimmedValue(environmentVariables.PAYWAY_SANDBOX_API_KEY)

  if (checkoutEnabled && (!merchantId || !apiKey)) {
    throw new PayWayConfigurationError(
      'Sandbox checkout requires PAYWAY_SANDBOX_MERCHANT_ID and PAYWAY_SANDBOX_API_KEY.',
    )
  }

  return Object.freeze({
    environment,
    checkoutEnabled,
    endpoints: PAYWAY_ENDPOINTS[environment],
    credentials: Object.freeze({ merchantId, apiKey }),
  })
}

