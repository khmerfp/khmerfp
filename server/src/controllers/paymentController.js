import { validatePaymentDetails } from '../validation/paymentValidation.js'

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

