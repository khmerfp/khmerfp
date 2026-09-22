import { validatePaymentDetails } from '../validation/paymentValidation.js'
import { PaymentDetailsValidationError } from '../services/pendingTransactionService.js'
import {
  CheckoutUnavailableError,
  prepareSandboxCheckout,
} from '../services/checkoutPreparationService.js'
import {
  UnsupportedCallbackPayloadError,
  verifyCallbackSignature,
} from '../payway/callbackSignature.js'
import { validateCallbackPayload } from '../validation/callbackValidation.js'

// validate details without payment
export function validatePayment(request, response) {
  const result = validatePaymentDetails(request.body)

  if (!result.isValid) {
    response.status(400).json({
      message: 'Validation failed.',
      errors: result.errors,
    })
    return
  }

  response.status(200).json({
    message: 'Validation passed. No payment was initiated.',
    details: {
      amount: result.data.amount,
      currency: result.data.currency,
    },
  })
}

// create the sandbox checkout handler
export function createPrepareCheckoutHandler(
  checkoutPreparation = prepareSandboxCheckout,
) {
  // prepare checkout without calling PayWay
  return async function prepareCheckout(request, response, next) {
    try {
      const checkout = await checkoutPreparation(request.body)
      response.status(201).json({
        message: 'Sandbox checkout prepared. Payment is not yet verified.',
        checkout,
      })
    } catch (error) {
      if (error instanceof PaymentDetailsValidationError) {
        response.status(400).json({
          message: 'Validation failed.',
          errors: error.errors,
        })
        return
      }

      if (error instanceof CheckoutUnavailableError) {
        response.status(503).json({ message: error.message })
        return
      }

      next(error)
    }
  }
}

// create the temporary callback verifier
export function createCallbackHandler({
  callbackSecret,
  signatureVerifier = verifyCallbackSignature,
  payloadValidator = validateCallbackPayload,
} = {}) {
  // authenticate without processing payment state
  return function verifyCallback(request, response, next) {
    if (!callbackSecret) {
      response.status(503).json({
        message: 'PayWay callback verification is not configured.',
      })
      return
    }

    if (!request.is('application/json')) {
      response.status(415).json({
        message: 'PayWay callbacks require application/json.',
      })
      return
    }

    let isAuthentic
    try {
      isAuthentic = signatureVerifier(
        request.body,
        request.get('X-PayWay-HMAC-SHA512'),
        callbackSecret,
      )
    } catch (error) {
      if (error instanceof UnsupportedCallbackPayloadError) {
        response.status(422).json({
          message: 'Callback payload uses unsupported serialization.',
        })
        return
      }

      next(error)
      return
    }

    if (!isAuthentic) {
      response.status(401).json({ message: 'Invalid callback signature.' })
      return
    }

    const validation = payloadValidator(request.body)
    if (!validation.isValid) {
      response.status(400).json({
        message: 'Callback validation failed.',
        errors: validation.errors,
      })
      return
    }

    response.status(501).json({
      message: 'Callback authenticated, but payment processing is not implemented.',
    })
  }
}
