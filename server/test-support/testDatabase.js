import dotenv from 'dotenv'
import {
  connectToDatabase,
  disconnectFromDatabase,
  getDatabasePool,
  initializeDatabase,
} from '../src/config/database.js'

export const TEST_DATABASE_NAME = 'angkor_payment_test'

dotenv.config({
  path: new URL('../.env.test', import.meta.url),
  quiet: true,
})

const approvedTestPools = new WeakSet()
let activeTestPool = null

// Check whether a dedicated test database URL is configured.
export function hasTestDatabaseConfiguration() {
  return (
    typeof process.env.TEST_DATABASE_URL === 'string' && process.env.TEST_DATABASE_URL.trim() !== ''
  )
}

// Validate the database name before connecting.
function getValidatedTestDatabaseUrl() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL

  if (typeof testDatabaseUrl !== 'string' || testDatabaseUrl.trim() === '') {
    throw new Error('TEST_DATABASE_URL is not configured.')
  }

  let databaseName
  let parsedUrl

  try {
    parsedUrl = new URL(testDatabaseUrl)
    databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ''))
  } catch {
    throw new Error('TEST_DATABASE_URL is invalid; connection details were not logged.')
  }

  if (databaseName !== TEST_DATABASE_NAME) {
    throw new Error(`TEST_DATABASE_URL must select ${TEST_DATABASE_NAME}.`)
  }

  if (
    !['postgres:', 'postgresql:'].includes(parsedUrl.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(parsedUrl.hostname) ||
    parsedUrl.search ||
    parsedUrl.hash
  ) {
    throw new Error('Only a loopback PostgreSQL test URL without options is allowed.')
  }
  if (
    process.env.TEST_DATABASE_DISPOSABLE !== 'true' ||
    ['production', 'staging'].includes(process.env.NODE_ENV)
  ) {
    throw new Error('Explicit disposable test database opt-in is required.')
  }

  return testDatabaseUrl
}

// Connect only to the designated isolated PostgreSQL test database.
export async function openTestDatabaseConnection() {
  const testDatabaseUrl = getValidatedTestDatabaseUrl()
  if (activeTestPool) {
    assertDesignatedTestDatabase(activeTestPool)
    if (activeTestPool.options.connectionString !== testDatabaseUrl) {
      throw new Error('Test database target changed while a pool is active.')
    }
    return activeTestPool
  }
  let existingPool
  try {
    existingPool = getDatabasePool()
  } catch {
    /* no application pool exists. */
  }
  if (existingPool) throw new Error('Refusing to replace an existing application database pool.')
  const pool = await connectToDatabase(testDatabaseUrl, {
    connectionTimeoutMillis: 5000,
    max: 5,
    statement_timeout: 10000,
    lock_timeout: 5000,
  })

  try {
    const result = await pool.query('SELECT current_database() AS name')
    const actualDatabaseName = result.rows[0]?.name

    if (actualDatabaseName !== TEST_DATABASE_NAME) {
      throw new Error('Connected database is not the designated test database.')
    }

    // initialize only after the explicit target and actual database are verified.
    await initializeDatabase()
    approvedTestPools.add(pool)
    activeTestPool = pool
    return pool
  } catch (error) {
    await disconnectFromDatabase().catch(() => {})
    throw error
  }
}

// Refuse cleanup operations on connections not approved by this helper.
export function assertDesignatedTestDatabase(connection) {
  if (!connection || !approvedTestPools.has(connection)) {
    throw new Error('Cleanup refused outside the designated test database.')
  }
}

// Close the test database connection pool.
export async function closeTestDatabaseConnection(connection = activeTestPool) {
  assertDesignatedTestDatabase(connection)
  if (connection !== activeTestPool) throw new Error('Cleanup refused for an inactive test pool.')
  if (getDatabasePool() !== connection) throw new Error('Cleanup refused after the application pool changed.')
  await disconnectFromDatabase()
  approvedTestPools.delete(connection)
  activeTestPool = null
}
