import { Router } from 'express'
import {
  createPrepareCheckoutHandler,
  validatePayment,
} from '../controllers/paymentController.js'

// create payment routes with injectable services
export function createPaymentRouter(options = {}) {
  const router = Router()
  router.post('/validate', validatePayment)
  router.post(
    '/checkout/prepare',
    createPrepareCheckoutHandler(options.checkoutPreparation),
  )
  return router
}

export const paymentRouter = createPaymentRouter()
