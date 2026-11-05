import { Router } from 'express'

import {
  createBakongPaymentHandler,
  createBakongPaymentStatusHandler,
} from '../controllers/bakongPaymentController.js'
import { createCheckoutRateLimiter } from '../middleware/checkoutRateLimit.js'
import { requireAuth } from '../middleware/requireAuth.js'
import {
  createStatusRateLimiter,
  preventStatusCaching,
} from '../middleware/statusRateLimit.js'

// Create Bakong payment routes with injectable services.
export function createBakongPaymentRouter(options = {}) {
  const router = Router()
  const createRateLimiter = options.createRateLimiter
    ?? createCheckoutRateLimiter()
  const statusRateLimiter = options.statusRateLimiter
    ?? createStatusRateLimiter()
  const authGuard = options.authGuard ?? requireAuth

  router.post(
    '/',
    preventStatusCaching,
    createRateLimiter,
    authGuard,
    createBakongPaymentHandler(options.createPayment, options.logger),
  )

  router.get(
    '/:tranId/status',
    preventStatusCaching,
    statusRateLimiter,
    createBakongPaymentStatusHandler(options.getStatus, options.logger),
  )

  return router
}
