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
const rawPort = process.env.PORT ?? String(DEFAULT_PORT)
const port = Number(rawPort)
const databaseUrl = process.env.DATABASE_URL?.trim()

class SafeStartupError extends Error {}

// Start the HTTP listener
function listen(app, selectedPort) {
  return new Promise((resolve, reject) => {
    const server = app.listen(selectedPort, '0.0.0.0')

    server.once('listening', () => resolve(server))
    server.once('error', reject)
  })
}

// Close the HTTP server
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

// Validate startup configuration
function validateConfiguration() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SafeStartupError(
      `PORT must be an integer from 1 to 65535; received "${rawPort}".`
    )
  }

  if (!databaseUrl) {
    throw new SafeStartupError(
      'DATABASE_URL is required. Configure it in your .env file.'
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

let httpServer
let shuttingDown = false

// Gracefully shut down the application
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

// Start the application
async function start() {
  try {
    validateConfiguration()

    // Connect to PostgreSQL
    try {
      await connectToDatabase(databaseUrl)
    } catch {
      throw new SafeStartupError(
        `Unable to connect to PostgreSQL within ${DATABASE_CONNECTION_TIMEOUT_MS}ms. Check the database configuration and availability.`
      )
    }

    // Initialize database tables
    try {
      await initializeDatabase()
    } catch {
      throw new SafeStartupError(
        'Unable to initialize PostgreSQL tables. Check database permissions and schema configuration.'
      )
    }

    // Create the Express app
    let app

    try {
      app = createApp()
    } catch (error) {
      if (error instanceof FrontendBuildError) {
        throw new SafeStartupError(error.message)
      }

      throw error
    }

    // Start HTTP server
    try {
      httpServer = await listen(app, port)
    } catch {
      throw new SafeStartupError(
        'Unable to start the HTTP listener. Check PORT availability.'
      )
    }

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

await start()