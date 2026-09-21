import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hasTestDatabaseConfiguration,
  openTestDatabaseConnection,
} from '../test-support/testDatabase.js'

// restore one environment value after a test
function restoreEnvironmentValue(name, value) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

test('test database configuration never falls back to MONGODB_URI', () => {
  const originalTestUri = process.env.TEST_MONGODB_URI
  const originalApplicationUri = process.env.MONGODB_URI

  try {
    delete process.env.TEST_MONGODB_URI
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/angkor_payment'
    assert.equal(hasTestDatabaseConfiguration(), false)
  } finally {
    restoreEnvironmentValue('TEST_MONGODB_URI', originalTestUri)
    restoreEnvironmentValue('MONGODB_URI', originalApplicationUri)
  }
})

test('test database configuration rejects the application database before connecting', async () => {
  const originalTestUri = process.env.TEST_MONGODB_URI

  try {
    process.env.TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/angkor_payment'
    await assert.rejects(
      openTestDatabaseConnection(),
      /must select angkor_payment_test/,
    )
  } finally {
    restoreEnvironmentValue('TEST_MONGODB_URI', originalTestUri)
  }
})
