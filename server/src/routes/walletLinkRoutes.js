import { Router } from 'express'
import { requireAuth } from '../middleware/requireAuth.js'
import { readSessionToken, hashSessionToken } from '../services/authSessionService.js'
import {
  createFixedWindowRateLimiter,
  preventStatusCaching,
} from '../middleware/statusRateLimit.js'
import { createWalletLinkService, walletLinkConfig } from '../walletLinking/service.js'
import { createWalletLinkRepository } from '../walletLinking/repository.js'

export function createWalletLinkRouter({
  enabled = () =>
    process.env.WALLET_LINK_ENABLED === 'true' &&
    ['development', 'test'].includes(process.env.NODE_ENV),
  authGuard = requireAuth,
  service,
} = {}) {
  const router = Router()
  router.use(preventStatusCaching)
  router.use((_req, res, next) =>
    enabled()
      ? next()
      : res
          .status(503)
          .json({ message: 'Wallet linking is disabled pending schema and security approval.' }),
  )
  router.use(authGuard)
  router.use(
    createFixedWindowRateLimiter({
      limit: 30,
      windowMs: 60000,
      message: 'Too many wallet-link requests.',
    }),
  )
  router.use((req, res, next) => {
    try {
      const config = walletLinkConfig()
      if (req.method !== 'GET' && req.get('origin') !== config.origin) {
        return res.status(403).json({ message: 'Wallet-link origin rejected.' })
      }
      const token = readSessionToken(req)
      if (!token) {
        return res.status(401).json({ message: 'Application session required.' })
      }
      req.walletLinkActor = { userId: req.authUser.id, sessionHash: hashSessionToken(token) }
      req.walletLinkService =
        service || createWalletLinkService({ repository: createWalletLinkRepository(), config })
      next()
    } catch (error) {
      next(error)
    }
  })
  router.get('/', async (req, res) =>
    res.json({ wallets: await req.walletLinkService.list(req.walletLinkActor) }),
  )
  router.post('/challenges', async (req, res) =>
    res.status(201).json(await req.walletLinkService.issue(req.walletLinkActor, req.body)),
  )
  router.post('/verify', async (req, res) =>
    res.json(await req.walletLinkService.verify(req.walletLinkActor, req.body)),
  )
  router.use((error, _req, res, _next) =>
    res
      .status(error.status || 503)
      .json({ message: error.status ? error.message : 'Wallet linking unavailable.' }),
  )
  return router
}
