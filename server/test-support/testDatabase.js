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

// Check whether the PostgreSQL test database is configured.
export function hasTestDatabaseConfiguration() {
  return (
    typeof process.env.TEST_DATABASE_URL === 'string' &&
    process.env.TEST_DATABASE_URL.trim() !== ''
  )
}

// Validate the test database URL without exposing credentials.
function getValidatedTestDatabaseUrl() {
  const databaseUrl = process.env.TEST_DATABASE_URL

  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') {
    throw new Error('TEST_DATABASE_URL is not configured.')
  }

  let parsedUrl

  try {
    parsedUrl = new URL(databaseUrl)
  } catch {
    throw new Error(
      'TEST_DATABASE_URL is invalid; connection details were not logged.',
    )
  }

  if (!['postgres:', 'postgresql:'].includes(parsedUrl.protocol)) {
    throw new Error('TEST_DATABASE_URL must use PostgreSQL.')
  }

  const databaseName = decodeURIComponent(
    parsedUrl.pathname.replace(/^\//, ''),
  )

  if (databaseName !== TEST_DATABASE_NAME) {
    throw new Error(
      `TEST_DATABASE_URL must select ${TEST_DATABASE_NAME}.`,
    )
  }

  return databaseUrl
}

// Connect only to the designated PostgreSQL test database.
export async function openTestDatabaseConnection() {
  const databaseUrl = getValidatedTestDatabaseUrl()

  await connectToDatabase(databaseUrl)

  const pool = getDatabasePool()

  try {
    await assertDesignatedTestDatabase(pool)
    await initializeDatabase()

    return pool
  } catch (error) {
    await disconnectFromDatabase()
    throw error
  }
}

// Check the actual connected database before any cleanup.
export async function assertDesignatedTestDatabase(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new Error(
      'Cleanup refused without a valid PostgreSQL connection pool.',
    )
  }

  const { rows } = await pool.query('SELECT current_database() AS name')

  if (rows[0]?.name !== TEST_DATABASE_NAME) {
    throw new Error(
      'Cleanup refused outside the designated PostgreSQL test database.',
    )
  }
}

// Close the test connection.
export async function closeTestDatabaseConnection() {
  await disconnectFromDatabase()
}
