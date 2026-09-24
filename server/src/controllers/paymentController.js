import { validatePaymentDetails } from '../validation/paymentValidation.js'
import { PaymentDetailsValidationError } from '../services/pendingTransactionService.js'
import {
  CheckoutUnavailableError,
  prepareCheckout,
} from '../services/checkoutPreparationService.js'
import {
  UnsupportedCallbackPayloadError,
  verifyCallbackSignature,
} from '../payway/callbackSignature.js'
import { validateCallbackPayload } from '../validation/callbackValidation.js'
import {
  PaymentReconciliationError,
  reconcileAuthenticatedCallback,
} from '../services/paymentReconciliationService.js'
import {
  getProtectedPaymentStatus,
  PaymentStatusUnavailableError,
} from '../services/paymentStatusService.js'
import { operationalLogger } from '../logging/operationalLogger.js'

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

// create the checkout handler
export function createPrepareCheckoutHandler(
  checkoutPreparation = prepareCheckout,
  logger = operationalLogger,
) {
  // prepare checkout without calling PayWay
  return async function prepareCheckout(request, response, next) {
    try {
      const checkout = await checkoutPreparation(request.body)
      logger.info('checkout.prepared', {
        transactionId: checkout.transaction?.tranId,
        environment: checkout.environment,
        outcome: checkout.transaction?.status,
      })
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
  callbackReconciliation = reconcileAuthenticatedCallback,
  logger = operationalLogger,
} = {}) {
  // authenticate and reconcile one callback
  return async function verifyCallback(request, response, next) {
    if (!callbackSecret) {
      logger.warn('callback.rejected', { code: 'MISSING_CONFIGURATION' })
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
      logger.warn('callback.rejected', { code: 'INVALID_SIGNATURE' })
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

    try {
      const result = await callbackReconciliation(validation.data)
      logger.info('callback.handled', {
        transactionId: validation.data.tranId,
        outcome: result.status,
        duplicate: result.duplicate,
      })
      response.status(200).json({
        message: 'Callback handled durably.',
        status: result.duplicate ? 'already_processed' : 'paid',
      })
    } catch (error) {
      if (error instanceof PaymentReconciliationError) {
        logger.warn('callback.reconciliation_failed', {
          transactionId: validation.data.tranId,
          code: error.code,
          httpStatus: error.httpStatus,
        })
        response.status(error.httpStatus).json({
          message: error.message,
          code: error.code,
        })
        return
      }

      next(error)
    }
  }
}

// create the protected payment status handler
export function createPaymentStatusHandler(
  statusLookup = getProtectedPaymentStatus,
) {
  // return only the safe payment result fields
  return async function readPaymentStatus(request, response, next) {
    try {
      const payment = await statusLookup(
        request.params.tranId,
        request.get('X-Payment-Status-Token'),
      )
      response.status(200).json({ payment })
    } catch (error) {
      if (error instanceof PaymentStatusUnavailableError) {
        response.status(404).json({ message: error.message })
        return
      }

      next(error)
    }
  }
}
