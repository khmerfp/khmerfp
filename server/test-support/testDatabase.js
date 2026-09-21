import dotenv from 'dotenv'
import mongoose from 'mongoose'

export const TEST_DATABASE_NAME = 'angkor_payment_test'

dotenv.config({
  path: new URL('../.env.test', import.meta.url),
  quiet: true,
})

// report whether private test configuration exists
export function hasTestDatabaseConfiguration() {
  return typeof process.env.TEST_MONGODB_URI === 'string'
    && process.env.TEST_MONGODB_URI.trim() !== ''
}

// validate the configured database without exposing its uri
function getValidatedTestMongoUri() {
  const testMongoUri = process.env.TEST_MONGODB_URI

  if (typeof testMongoUri !== 'string' || testMongoUri.trim() === '') {
    throw new Error('TEST_MONGODB_URI is not configured.')
  }

  let databaseName

  try {
    const parsedUri = new URL(testMongoUri)
    databaseName = decodeURIComponent(parsedUri.pathname.replace(/^\//, ''))
  } catch {
    throw new Error('TEST_MONGODB_URI is invalid; connection details were not logged.')
  }

  if (databaseName !== TEST_DATABASE_NAME) {
    throw new Error(`TEST_MONGODB_URI must select ${TEST_DATABASE_NAME}.`)
  }

  return testMongoUri
}

// open only the designated isolated test database
export async function openTestDatabaseConnection() {
  const testMongoUri = getValidatedTestMongoUri()
  const connection = await mongoose
    .createConnection(testMongoUri, {
      dbName: TEST_DATABASE_NAME,
      serverSelectionTimeoutMS: 5000,
    })
    .asPromise()

  if (connection.name !== TEST_DATABASE_NAME) {
    await connection.close()
    throw new Error('Connected database is not the designated test database.')
  }

  return connection
}

// guard every targeted cleanup operation
export function assertDesignatedTestDatabase(connection) {
  if (connection?.name !== TEST_DATABASE_NAME) {
    throw new Error('Cleanup refused outside the designated test database.')
  }
}
