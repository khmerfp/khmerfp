
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

import { createApp, FrontendBuildError } from './app.js'

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

const environmentFile = fileURLToPath(
  new URL('../.env', import.meta.url)
)

dotenv.config({
  path: environmentFile,
  quiet: true,
})

const DEFAULT_PORT = 3000
const isVercel = Boolean(process.env.VERCEL)

const rawPort = process.env.PORT ?? String(DEFAULT_PORT)
const port = Number(rawPort)
const databaseUrl = process.env.DATABASE_URL?.trim()

class SafeStartupError extends Error {}

let httpServer
let app
let runtimeInitialization
let shuttingDown = false

// Validate application configuration
function validateConfiguration() {
  if (!databaseUrl) {
    throw new SafeStartupError(
      'DATABASE_URL is required. Configure it in the hosting environment.'
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

// Validate PORT only for a traditional local server
function validatePort() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SafeStartupError(
      `PORT must be an integer from 1 to 65535; received "${rawPort}".`
    )
  }
}

// Initialize PostgreSQL and configuration once per runtime instance
function initializeRuntime() {
  if (!runtimeInitialization) {
    runtimeInitialization = (async () => {
      validateConfiguration()

      try {
        await connectToDatabase(databaseUrl)
      } catch {
        throw new SafeStartupError(
          `Unable to connect to PostgreSQL within ${DATABASE_CONNECTION_TIMEOUT_MS}ms. Check database configuration and availability.`
        )
      }

      try {
        await initializeDatabase()
      } catch {
        throw new SafeStartupError(
          'Unable to initialize PostgreSQL tables. Check database permissions and schema configuration.'
        )
      }
    })()
  }

  return runtimeInitialization
}

// Create the Express application once
function getApp() {
  if (!app) {
    try {
      app = createApp()
    } catch (error) {
      if (error instanceof FrontendBuildError) {
        throw new SafeStartupError(error.message)
      }

      throw error
    }
  }

  return app
}

// Vercel serverless entry point
export default async function handler(req, res) {
  try {
    await initializeRuntime()

    const expressApp = getApp()
    return expressApp(req, res)
  } catch (error) {
    if (error instanceof SafeStartupError) {
      console.error(`Application initialization failed: ${error.message}`)
    } else {
      console.error(
        'Application initialization failed unexpectedly; sensitive details have been redacted.'
      )
    }

    if (!res.headersSent) {
      return res.status(503).json({
        error: 'Service temporarily unavailable',
      })
    }
  }
}

// Traditional HTTP listener for local development
function listen(expressApp, selectedPort) {
  return new Promise((resolve, reject) => {
    const server = expressApp.listen(selectedPort, '0.0.0.0')

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
      if (error) reject(error)
      else resolve()
    })
  })
}

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
      'Shutdown failed; connection details have been redacted.'
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
    } else {
      console.error(
        'Server startup failed unexpectedly; sensitive details have been redacted.'
      )
    }

    await closeHttpServer(httpServer).catch(() => {})
    await disconnectFromDatabase().catch(() => {})

    process.exitCode = 1
  }
}

// Do not start a persistent HTTP listener inside Vercel
if (!isVercel) {
  await start()
}
