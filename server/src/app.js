import express from 'express'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isDatabaseReady } from './config/database.js'
import { prepareCheckout } from './services/checkoutPreparationService.js'
import { createPaymentRouter } from './routes/paymentRoutes.js'
import { getPayWayConfig } from './config/payway.js'
import { operationalLogger } from './logging/operationalLogger.js'

export const DEFAULT_FRONTEND_DIST_PATH = fileURLToPath(
  new URL('../../client/dist/', import.meta.url),
)

export class FrontendBuildError extends Error {
  // create one safe frontend build error
  constructor() {
    super('Frontend static serving is enabled, but client/dist/index.html is missing. Run the frontend build before starting the server.')
    this.name = 'FrontendBuildError'
  }
}

// select bounded reverse proxy trust
export function getTrustProxy(environmentVariables = process.env) {
  return environmentVariables.NODE_ENV === 'production'
    ? ['loopback', 'linklocal', 'uniquelocal']
    : false
}

// mount only the built frontend files
function serveBuiltFrontend(app, frontendDistPath) {
  const indexPath = `${frontendDistPath}/index.html`
  if (!existsSync(indexPath)) throw new FrontendBuildError()

  app.use(express.static(frontendDistPath, {
    dotfiles: 'deny',
    fallthrough: true,
    index: false,
  }))

  // serve only known browser routes
  app.get(['/', '/payment/result', '/payment/cancel'], (_request, response) => {
    response.sendFile(indexPath)
  })
}

// create the express application
export function createApp({
  databaseIsReady = isDatabaseReady,
  checkoutPreparation = prepareCheckout,
  callbackSecret = getPayWayConfig().callback.secret,
  callbackSignatureVerifier,
  callbackPayloadValidator,
  callbackReconciliation,
  statusLookup,
  statusRateLimiter,
  serveFrontend = process.env.NODE_ENV === 'production',
  frontendDistPath = DEFAULT_FRONTEND_DIST_PATH,
  trustProxy = getTrustProxy(),
  logger = operationalLogger,
} = {}) {
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy)
  app.use(express.json({ limit: '10kb' }))

  app.get('/api/health', (_request, response) => {
    response.status(200).json({ status: 'ok' })
  })

  app.get('/api/ready', (_request, response) => {
    if (databaseIsReady()) {
      response.status(200).json({ status: 'ready' })
      return
    }

    response.status(503).json({ status: 'unavailable' })
  })

  app.use('/api/payments', createPaymentRouter({
    checkoutPreparation,
    callbackSecret,
    callbackSignatureVerifier,
    callbackPayloadValidator,
    callbackReconciliation,
    statusLookup,
    statusRateLimiter,
    logger,
  }))

  app.use('/api', (_request, response) => {
    response.status(404).json({ message: 'API route not found.' })
  })

  if (serveFrontend) serveBuiltFrontend(app, frontendDistPath)

  app.use((error, _request, response, _next) => {
    if (error.type === 'entity.parse.failed') {
      response.status(400).json({ message: 'Malformed JSON request body.' })
      return
    }

    if (error.type === 'entity.too.large') {
      response.status(413).json({ message: 'JSON request body is too large.' })
      return
    }

    logger.error('http.unexpected_error')
    response.status(500).json({ message: 'An unexpected server error occurred.' })
  })

  return app
}
