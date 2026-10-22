import { Router } from 'express'
import {
  createCallbackHandler,
  createPaymentStatusHandler,
  createPrepareCheckoutHandler,
  validatePayment,
} from '../controllers/paymentController.js'
import {
  createStatusRateLimiter,
  preventStatusCaching,
} from '../middleware/statusRateLimit.js'
import { createCheckoutRateLimiter } from '../middleware/checkoutRateLimit.js'
import { requireVerifiedFactor } from '../services/telegramFactorService.js'

// create payment routes with injectable services
export function createPaymentRouter(options = {}) {
  const router = Router()
  const statusRateLimiter = options.statusRateLimiter
    ?? createStatusRateLimiter()
  const checkoutRateLimiter = options.checkoutRateLimiter
    ?? createCheckoutRateLimiter()
  const factorGuard = options.factorGuard ?? requireVerifiedFactor

  router.post('/validate', validatePayment)

  router.post('/callback', createCallbackHandler({
    callbackSecret: options.callbackSecret,
    signatureVerifier: options.callbackSignatureVerifier,
    payloadValidator: options.callbackPayloadValidator,
    callbackReconciliation: options.callbackReconciliation,
    logger: options.logger,
  }))

  router.get(
    '/:tranId/status',
    preventStatusCaching,
    statusRateLimiter,
    createPaymentStatusHandler(options.statusLookup),
  )

  router.post(
    '/checkout/prepare',
    preventStatusCaching,
    checkoutRateLimiter,
    factorGuard,
    createPrepareCheckoutHandler(options.checkoutPreparation, options.logger),
  )
  return router
}
