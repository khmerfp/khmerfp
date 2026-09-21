import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import {
  connectToDatabase,
  DATABASE_CONNECTION_TIMEOUT_MS,
  disconnectFromDatabase,
} from './config/database.js'
import { Transaction } from './models/transaction.js'

const environmentFile = fileURLToPath(new URL('../.env', import.meta.url))
dotenv.config({ path: environmentFile, quiet: true })

const DEFAULT_PORT = 3000
const rawPort = process.env.PORT ?? String(DEFAULT_PORT)
const port = Number(rawPort)
const mongoUri = process.env.MONGODB_URI?.trim()

class SafeStartupError extends Error {}

function listen(app, selectedPort) {
  return new Promise((resolve, reject) => {
    const server = app.listen(selectedPort)
    server.once('listening', () => resolve(server))
    server.once('error', reject)
  })
}

function closeHttpServer(server) {
  if (!server) return Promise.resolve()

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function validateConfiguration() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new SafeStartupError(`PORT must be an integer from 1 to 65535; received "${rawPort}".`)
  }

  if (!mongoUri) {
    throw new SafeStartupError(
      'MONGODB_URI is required. Configure it in server/.env or the process environment.',
    )
  }
}

let httpServer
let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  console.info(`${signal} received; shutting down.`)

  try {
    await closeHttpServer(httpServer)
    await disconnectFromDatabase()
    console.info('Shutdown complete.')
  } catch {
    console.error('Shutdown failed; connection details have been redacted.')
    process.exitCode = 1
  }
}

async function start() {
  try {
    validateConfiguration()

    try {
      await connectToDatabase(mongoUri)
    } catch {
      throw new SafeStartupError(
        `unable to connect to MongoDB within ${DATABASE_CONNECTION_TIMEOUT_MS}ms. Check the server configuration and database availability.`,
      )
    }

    // Explicitly create indexes before accepting requests, including tranId's unique index.
    try {
      await Transaction.init()
    } catch {
      throw new SafeStartupError(
        'unable to initialize MongoDB indexes. Check database availability and permissions.',
      )
    }

    try {
      httpServer = await listen(createApp(), port)
    } catch {
      throw new SafeStartupError('unable to start the HTTP listener. Check PORT availability.')
    }
    console.log(`API server listening on http://localhost:${port}`)

    process.once('SIGINT', () => void shutdown('SIGINT'))
    process.once('SIGTERM', () => void shutdown('SIGTERM'))
  } catch (error) {
    if (error instanceof SafeStartupError) {
      console.error(`Server startup failed: ${error.message}`)
    } else {
      console.error('Server startup failed unexpectedly; sensitive details have been redacted.')
    }

    await closeHttpServer(httpServer).catch(() => {})
    await disconnectFromDatabase().catch(() => {})
    process.exitCode = 1
  }
}

await start()
