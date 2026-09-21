import { validatePaymentDetails } from '../validation/paymentValidation.js'
import { PaymentDetailsValidationError } from '../services/pendingTransactionService.js'
import {
  CheckoutUnavailableError,
  prepareSandboxCheckout,
} from '../services/checkoutPreparationService.js'

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
