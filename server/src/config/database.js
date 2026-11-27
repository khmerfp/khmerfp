// SQL workflow: Legacy startup DDL and connection management. This is not the restricted ledger runtime migration path.
import dns from 'node:dns'
import net from 'node:net'

import pg from 'pg'
import { verifyDatabaseCompatibility } from '../db/schemaCompatibility.js'

const { Pool } = pg

export const DATABASE_CONNECTION_TIMEOUT_MS = 15000

function preferIpv4Connections() {
  dns.setDefaultResultOrder('ipv4first')

  if (typeof net.setDefaultAutoSelectFamily === 'function') {
    net.setDefaultAutoSelectFamily(false)
  }
}

preferIpv4Connections()

let pool = null

// Connect to the configured PostgreSQL database
export async function connectToDatabase(uri, options = {}) {
  if (typeof uri !== 'string' || uri.trim() === '') {
    throw new Error('DATABASE_URL is required.')
  }

  if (pool) {
    return pool
  }

  const newPool = new Pool({
    connectionString: uri,
    connectionTimeoutMillis: DATABASE_CONNECTION_TIMEOUT_MS,
    // Keep a small number of warm connections for five minutes so repeated
    // sign-ins do not pay the Neon TLS/handshake cost every time.
    max: 5,
    idleTimeoutMillis: 300000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
    ...options,
  })

  newPool.on('error', () => {
    console.error(
      'PostgreSQL connection error; connection details have been redacted.'
    )
  })

  try {
    await newPool.query('SELECT 1')
    pool = newPool

    console.info('PostgreSQL connected successfully.')

    return pool
  } catch (error) {
    await newPool.end()
    throw error
  }
}

// Get the PostgreSQL connection pool
export function getDatabasePool() {
  if (!pool) {
    throw new Error('PostgreSQL database is not connected.')
  }

  return pool
}

// Verify the canonical schema without creating, repairing, or backfilling data.
export async function initializeDatabase() {
  await verifyDatabaseCompatibility(getDatabasePool(), { mode: 'http' })
  console.info('PostgreSQL schema and runtime privileges verified.')
}

// Check database readiness
export async function isDatabaseReady() {
  if (!pool) {
    return false
  }

  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}

// Disconnect PostgreSQL
export async function disconnectFromDatabase() {
  if (pool) {
    const currentPool = pool
    pool = null

    await currentPool.end()

    console.info('PostgreSQL disconnected.')
  }
}
