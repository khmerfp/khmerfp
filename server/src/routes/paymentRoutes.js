import { Router } from 'express'
import { validatePayment } from '../controllers/paymentController.js'

export const paymentRouter = Router()

// ==> POST /validate
paymentRouter.post('/validate', validatePayment)

