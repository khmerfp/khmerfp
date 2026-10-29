
import express from 'express'
import cors from 'cors'
import { isDatabaseReady } from './config/database.js'
import { prepareCheckout } from './services/checkoutPreparationService.js'
import { createPaymentRouter } from './routes/paymentRoutes.js'
import { getPayWayConfig } from './config/payway.js'
import { operationalLogger } from './logging/operationalLogger.js'
import { createSecurityHeaders } from './middleware/securityHeaders.js'
import { createRequestIdMiddleware } from './middleware/requestId.js'
import { createAuthRouter } from './routes/authRoutes.js'
import {
  connectToDatabase,
  initializeDatabase,
} from './config/database.js'

let databaseInitialization

// Serverless instances can receive concurrent requests during startup. Share
// one connection and schema initialization promise within each warm instance.
async function ensureDatabaseReady() {
  if (!databaseInitialization) {
    databaseInitialization = (async () => {
      const databaseUrl = process.env.DATABASE_URL?.trim()

      if (!databaseUrl) {
        throw new Error('DATABASE_URL is required.')
      }

      await connectToDatabase(databaseUrl)
      await initializeDatabase()
    })().catch((error) => {
      databaseInitialization = undefined
      throw error
    })
  }

  await databaseInitialization
}

// Select bounded reverse proxy trust
export function getTrustProxy(environmentVariables = process.env) {
  return environmentVariables.NODE_ENV === 'production'
    ? ['loopback', 'linklocal', 'uniquelocal']
    : false
}

// Create the Express application
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
  trustProxy = getTrustProxy(),
  logger = operationalLogger,
  securityHeaders = createSecurityHeaders({
    isProduction: process.env.NODE_ENV === 'production',
  }),
  requestIdMiddleware = createRequestIdMiddleware(),
} = {}) {
  const app = express()

  // Vercel invokes the app as a function, so initialize PostgreSQL lazily
  // before each request; the database module reuses the pool per warm instance.
  app.use(async (_request, _response, next) => {
    try {
      await ensureDatabaseReady()
      next()
    } catch (error) {
      next(error)
    }
  })

  // CORS: allow the production frontend and local development
  app.use(
    cors({
      origin(origin, callback) {
        const allowedOrigins = (process.env.APP_ORIGINS || 'http://localhost:5173')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
        callback(null, !origin || allowedOrigins.includes(origin))
      },
      credentials: true,
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
      ],
    }),
  )

  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy)
  app.use(requestIdMiddleware)
  app.use(securityHeaders)
  app.use(express.json({ limit: '10kb' }))

  // Health endpoint
  app.get('/api/health', (_request, response) => {
    response.status(200).json({ status: 'ok' })
  })

  // Readiness endpoint
  app.get('/api/ready', (_request, response) => {
    if (databaseIsReady()) {
      response.status(200).json({ status: 'ready' })
      return
    }

    response.status(503).json({ status: 'unavailable' })
  })

  // Mount payment routes
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

  // Mount authentication routes
  app.use(
    '/api/auth',
    createAuthRouter({ authRateLimiter }),
  )

  // API fallback
  app.use('/api', (_request, response) => {
    response.status(404).json({
      message: 'API route not found.',
    })
  })

  // Global error handler
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
