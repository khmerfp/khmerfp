import dotenv from 'dotenv'
import pg from 'pg'

const { Pool } = pg

export const TEST_DATABASE_NAME = 'angkor_payment_test'

dotenv.config({
  path: new URL('../.env.test', import.meta.url),
  quiet: true,
})

const approvedTestPools = new WeakSet()

// Check whether a dedicated test database URL is configured.
export function hasTestDatabaseConfiguration() {
  return (
    typeof process.env.TEST_DATABASE_URL === 'string' &&
    process.env.TEST_DATABASE_URL.trim() !== ''
  )
}

// Validate the database name before connecting.
function getValidatedTestDatabaseUrl() {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL

  if (
    typeof testDatabaseUrl !== 'string' ||
    testDatabaseUrl.trim() === ''
  ) {
    throw new Error('TEST_DATABASE_URL is not configured.')
  }

  let databaseName

  try {
    const parsedUrl = new URL(testDatabaseUrl)
    databaseName = decodeURIComponent(
      parsedUrl.pathname.replace(/^\//, ''),
    )
  } catch {
    throw new Error(
      'TEST_DATABASE_URL is invalid; connection details were not logged.',
    )
  }

  if (databaseName !== TEST_DATABASE_NAME) {
    throw new Error(
      `TEST_DATABASE_URL must select ${TEST_DATABASE_NAME}.`,
    )
  }

  return testDatabaseUrl
}

// Connect only to the designated isolated PostgreSQL test database.
export async function openTestDatabaseConnection() {
  const testDatabaseUrl = getValidatedTestDatabaseUrl()

  const pool = new Pool({
    connectionString: testDatabaseUrl,
    connectionTimeoutMillis: 5000,
    max: 5,
  })

  try {
    const result = await pool.query('SELECT current_database() AS name')
    const actualDatabaseName = result.rows[0]?.name

    if (actualDatabaseName !== TEST_DATABASE_NAME) {
      throw new Error(
        'Connected database is not the designated test database.',
      )
    }

    approvedTestPools.add(pool)
    return pool
  } catch (error) {
    await pool.end().catch(() => {})
    throw error
  }
}

// Refuse cleanup operations on connections not approved by this helper.
export function assertDesignatedTestDatabase(connection) {
  if (!connection || !approvedTestPools.has(connection)) {
    throw new Error(
      'Cleanup refused outside the designated test database.',
    )
  }
}

// Close the test database connection pool.
export async function closeTestDatabaseConnection(connection) {
  assertDesignatedTestDatabase(connection)
  approvedTestPools.delete(connection)
  await connection.end()
}