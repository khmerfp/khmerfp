import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

import { createApp } from './app.js'

import {
  connectToDatabase,
  DATABASE_CONNECTION_TIMEOUT_MS,
  disconnectFromDatabase,
  initializeDatabase,
} from './config/database.js'

import {
  getPayWayConfig,
  PayWayConfigurationError,
} from './config/payway.js'

import { logStartupDiagnostics } from './logging/startupDiagnostics.js'
import { isBrowserOriginAllowed } from './config/origins.js'

const environmentFile = fileURLToPath(
  new URL('../.env', import.meta.url),
)

dotenv.config({
  path: environmentFile,
  quiet: true,
})

const DEFAULT_PORT = 3000
const isVercel = Boolean(process.env.VERCEL)
const isLocalDevelopment =
  !isVercel && process.env.NODE_ENV !== 'production'

const rawPort = process.env.PORT ?? String(DEFAULT_PORT)
const port = Number(rawPort)
const databaseUrl = process.env.DATABASE_URL?.trim()

class SafeStartupError extends Error { }

let httpServer
let app
let runtimeInitialization
let runtimeRetryNotBefore = 0
let shuttingDown = false

// A cold serverless instance can fail its first database connection. Caching
// that rejected promise would make every later request on the instance fail
// until it was recycled, turning a transient blip into an intermittent outage.
const RUNTIME_RETRY_COOLDOWN_MS = 5000

// Validate application configuration.
function validateConfiguration() {
  if (!databaseUrl) {
    throw new SafeStartupError(
      'DATABASE_URL is required. Configure it in the hosting environment.',
    )
  }

  try {
    getPayWayConfig(process.env)
  } catch (error) {
    if (error instanceof PayWayConfigurationError) {
      throw new SafeStartupError(error.message)
    }

    throw error
  }
}

// Validate PORT only for a traditional HTTP server.
function validatePort() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SafeStartupError(
      `PORT must be an integer from 1 to 65535; received "${rawPort}".`,
    )
  }
}

// Initialize PostgreSQL and configuration once per runtime. A failed attempt
// is cleared so the next request can retry after a short cooldown.
function initializeRuntime() {
  if (runtimeInitialization) {
    return runtimeInitialization
  }

  if (Date.now() < runtimeRetryNotBefore) {
    return Promise.reject(
      new SafeStartupError(
        'Application initialization is retrying. Please try again shortly.',
      ),
    )
  }

  const attempt = (async () => {
    validateConfiguration()

    try {
      await connectToDatabase(databaseUrl)
    } catch {
      throw new SafeStartupError(
        `Unable to connect to PostgreSQL within ${DATABASE_CONNECTION_TIMEOUT_MS}ms. Check database configuration and availability.`,
      )
    }

    try {
      await initializeDatabase()
    } catch {
      throw new SafeStartupError(
        'Unable to initialize PostgreSQL tables. Check database permissions and schema configuration.',
      )
    }
  })()

  runtimeInitialization = attempt

  attempt.catch(() => {
    if (runtimeInitialization === attempt) {
      runtimeInitialization = null
      runtimeRetryNotBefore = Date.now() + RUNTIME_RETRY_COOLDOWN_MS
    }
  })

  return attempt
}

// Return the CORS headers the Express app would have set, so a startup failure
// on a separately hosted frontend still produces a readable JSON error body.
function setFallbackCorsHeaders(request, response) {
  const origin = request.headers.origin

  if (!origin || !isBrowserOriginAllowed(origin)) return

  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Credentials', 'true')
  response.setHeader('Vary', 'Origin')
  response.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  )
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization,X-Payment-Status-Token,Idempotency-Key',
  )
  response.setHeader('Access-Control-Max-Age', '600')
}

// Create the Express application once.
function getApp() {
  if (!app) {
    app = createApp()
  }

  return app
}

// Vercel serverless entry point.
export default async function handler(req, res) {
  try {
    await initializeRuntime()

    const expressApp = getApp()
    return expressApp(req, res)
  } catch (error) {
    if (error instanceof SafeStartupError) {
      console.error(
        `Application initialization failed: ${error.message}`,
      )
    } else if (isLocalDevelopment) {
      logStartupDiagnostics(error)
    } else {
      console.error(
        'Application initialization failed unexpectedly; sensitive details have been redacted.',
      )
    }

    if (!res.headersSent) {
      setFallbackCorsHeaders(req, res)

      // A successful preflight lets the browser send the real request, which
      // then receives the readable JSON 503 above instead of a CORS error.
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        return res.end()
      }

      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Retry-After', '5')
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again shortly.',
      })
    }
  }
}

// Start a traditional HTTP listener for local development or Render.
function listen(expressApp, selectedPort) {
  return new Promise((resolve, reject) => {
    const server = expressApp.listen(
      selectedPort,
      '0.0.0.0',
    )

    server.once('listening', () => resolve(server))
    server.once('error', reject)
  })
}

function closeHttpServer(server) {
  if (!server) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

// Gracefully shut down the HTTP server and database connection.
async function shutdown(signal) {
  if (shuttingDown) return

  shuttingDown = true
  console.info(`${signal} received; shutting down.`)

  try {
    await closeHttpServer(httpServer)
    await disconnectFromDatabase()
    console.info('Shutdown complete.')
  } catch {
    console.error(
      'Shutdown failed; connection details have been redacted.',
    )
    process.exitCode = 1
  }
}

async function start() {
  try {
    validatePort()
    await initializeRuntime()

    httpServer = await listen(getApp(), port)

    console.info(`Web service listening on 0.0.0.0:${port}`)

    process.once('SIGINT', () => void shutdown('SIGINT'))
    process.once('SIGTERM', () => void shutdown('SIGTERM'))
  } catch (error) {
    if (error instanceof SafeStartupError) {
      console.error(`Server startup failed: ${error.message}`)
    } else if (isLocalDevelopment) {
      logStartupDiagnostics(error)
    } else {
      console.error(
        'Server startup failed unexpectedly; sensitive details have been redacted.',
      )
    }
    

    await closeHttpServer(httpServer).catch(() => { })
    await disconnectFromDatabase().catch(() => { })

    process.exitCode = 1
  }
}

// Do not start a persistent HTTP listener inside Vercel.
if (!isVercel) {
  await start()
}