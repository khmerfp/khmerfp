import { Router } from 'express'

import { createGetWalletHandler } from '../controllers/walletController.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { preventStatusCaching } from '../middleware/statusRateLimit.js'

// Create wallet routes with injectable services.
export function createWalletRouter({ authGuard = requireAuth, getWallet } = {}) {
  const router = Router()

  router.get(
    '/',
    preventStatusCaching,
    authGuard,
    createGetWalletHandler(getWallet),
  )

  return router
}
