import {
  BakongPaymentNotFoundError,
  BakongPaymentStorageError,
  BakongPaymentValidationError,
  BakongPaymentsUnavailableError,
  BakongProviderUnavailableError,
  createBakongPayment,
  getBakongPaymentStatus,
} from '../services/bakongPaymentService.js'
import { operationalLogger } from '../logging/operationalLogger.js'

// Resolve a display name for the payment owner without trusting the client.
function getCustomerName(user) {
  if (typeof user?.display_name === 'string' && user.display_name.trim()) {
    return user.display_name.trim().slice(0, 100)
  }

  if (typeof user?.email === 'string' && user.email.trim()) {
    return user.email.trim().slice(0, 100)
  }

  return 'KhmerFP customer'
}

// Create the Bakong KHQR handler.
export function createBakongPaymentHandler(
  createPayment = createBakongPayment,
  logger = operationalLogger,
) {
  return async function createPaymentHandler(request, response, next) {
    try {
      const result = await createPayment(request.body, {
        customerName: getCustomerName(request.authUser),
        userId: request.authUser.id,
        idempotencyKey: request.get('Idempotency-Key'),
      })

      logger.info('bakong.payment_created', {
        requestId: request.requestId,
        transactionId: result.payment?.tranId,
        environment: result.environment,
        outcome: result.payment?.status,
      })

      response.status(201).json({
        message: 'Bakong KHQR created. Payment is not yet verified.',
        payment: result.payment,
        statusAccess: result.statusAccess,
      })
    } catch (error) {
      if (error instanceof BakongPaymentValidationError) {
        response.status(400).json({
          message: 'Validation failed.',
          errors: error.errors,
        })
        return
      }

      if (error instanceof BakongPaymentsUnavailableError) {
        response.status(503).json({ message: error.message })
        return
      }

      next(error)
    }
  }
}

// Create the Bakong payment status handler.
export function createBakongPaymentStatusHandler(
  getStatus = getBakongPaymentStatus,
  logger = operationalLogger,
) {
  return async function readPaymentStatus(request, response, next) {
    try {
      const payment = await getStatus(
        request.params.tranId,
        request.get('X-Payment-Status-Token'),
      )

      logger.info('bakong.payment_checked', {
        requestId: request.requestId,
        transactionId: payment?.tranId,
        outcome: payment?.status,
      })

      response.status(200).json({ payment })
    } catch (error) {
      if (error instanceof BakongPaymentNotFoundError) {
        response.status(404).json({ message: error.message })
        return
      }

      if (
        error instanceof BakongPaymentsUnavailableError
        || error instanceof BakongProviderUnavailableError
        || error instanceof BakongPaymentStorageError
      ) {
        response.status(503).json({ message: error.message })
        return
      }

      next(error)
    }
  }
}
