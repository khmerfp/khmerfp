import express from 'express'
import cors from 'cors'
import { isDatabaseReady } from './config/database.js'
import { prepareCheckout } from './services/checkoutPreparationService.js'
import { createPaymentRouter } from './routes/paymentRoutes.js'
import { createBakongPaymentRouter } from './routes/bakongPaymentRoutes.js'
import { createWalletRouter } from './routes/walletRoutes.js'
import { getPayWayConfig } from './config/payway.js'
import { operationalLogger } from './logging/operationalLogger.js'
import { createSecurityHeaders } from './middleware/securityHeaders.js'
import { createRequestIdMiddleware } from './middleware/requestId.js'
import { createAuthRouter } from './routes/authRoutes.js'
import {
  getBrowserOrigins,
  isBrowserOriginAllowed,
} from './config/origins.js'

export { getBrowserOrigins }

// Select bounded reverse proxy trust.
export function getTrustProxy(environmentVariables = process.env) {
  return environmentVariables.NODE_ENV === 'production'
    ? ['loopback', 'linklocal', 'uniquelocal']
    : false
}

// Create the Express application.
export function createApp({
  databaseIsReady = isDatabaseReady,
  checkoutPreparation = prepareCheckout,
  callbackSecret = getPayWayConfig().callback.secret,
  callbackSignatureVerifier,
  callbackPayloadValidator,
  callbackReconciliation,
  statusLookup,
  statusRateLimiter,
  checkoutRateLimiter,
  factorGuard,
  authRateLimiter,
  bakongCreatePayment,
  bakongGetStatus,
  bakongAuthGuard,
  bakongCreateRateLimiter,
  bakongStatusRateLimiter,
  walletGet,
  walletAuthGuard,
  trustProxy = getTrustProxy(),
  logger = operationalLogger,
  securityHeaders = createSecurityHeaders({
    isProduction: process.env.NODE_ENV === 'production',
  }),
  requestIdMiddleware = createRequestIdMiddleware(),
} = {}) {
  const app = express()

  // CORS: allow only explicitly configured browser origins.
  app.use(
    cors({
      origin(origin, callback) {
        // Allow non-browser requests without an Origin header.
        if (!origin) {
          return callback(null, true)
        }

        if (isBrowserOriginAllowed(origin)) {
          return callback(null, true)
        }

        // Do not return CORS headers for an unapproved origin.
        // This is not a substitute for authentication or authorization.
        logger.warn('cors.origin_blocked', { origin })

        return callback(null, false)
      },
      credentials: true,
      // Let browsers cache the CORS preflight so a sign-in does not pay an
      // extra OPTIONS round trip every time.
      maxAge: 86400,
      methods: [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS',
      ],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Payment-Status-Token',
        'Idempotency-Key',
      ],
      optionsSuccessStatus: 204,
    }),
  )

  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy)

  app.use(requestIdMiddleware)
  app.use(securityHeaders)
  app.use(express.json({ limit: '10kb' }))

  // Health endpoint.
  app.get('/api/health', (_request, response) => {
    response.status(200).json({ status: 'ok' })
  })

  // Database readiness endpoint.
  app.get('/api/ready', (_request, response) => {
    if (databaseIsReady()) {
      response.status(200).json({ status: 'ready' })
      return
    }

    response.status(503).json({ status: 'unavailable' })
  })

  // Mount Bakong Open API payment routes before the generic payment router.
  app.use(
    '/api/payments/bakong',
    createBakongPaymentRouter({
      createPayment: bakongCreatePayment,
      getStatus: bakongGetStatus,
      authGuard: bakongAuthGuard,
      createRateLimiter: bakongCreateRateLimiter,
      statusRateLimiter: bakongStatusRateLimiter,
      logger,
    }),
  )

  // Mount payment routes.
  app.use(
    '/api/payments',
    createPaymentRouter({
      checkoutPreparation,
      callbackSecret,
      callbackSignatureVerifier,
      callbackPayloadValidator,
      callbackReconciliation,
      statusLookup,
      statusRateLimiter,
      checkoutRateLimiter,
      factorGuard,
      logger,
    }),
  )

  // Mount authentication routes.
  app.use(
    '/api/auth',
    createAuthRouter({ authRateLimiter }),
  )

  // Mount the authenticated wallet balance route.
  app.use(
    '/api/wallet',
    createWalletRouter({
      getWallet: walletGet,
      authGuard: walletAuthGuard,
    }),
  )

  // API fallback.
  app.use('/api', (_request, response) => {
    response.status(404).json({
      message: 'API route not found.',
    })
  })

  // Global error handler.
  app.use((error, request, response, _next) => {
    if (error.type === 'entity.parse.failed') {
      response.status(400).json({
        message: 'Malformed JSON request body.',
      })
      return
    }

    if (error.type === 'entity.too.large') {
      response.status(413).json({
        message: 'JSON request body is too large.',
      })
      return
    }

    logger.error('http.unexpected_error', {
      requestId: request.requestId,
    })

    response.status(500).json({
      message: 'An unexpected server error occurred.',
    })
  })

  return app
}
