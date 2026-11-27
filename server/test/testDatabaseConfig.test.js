
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hasTestDatabaseConfiguration,
  openTestDatabaseConnection,
} from '../test-support/testDatabase.js'

// Restore an environment value after a test.
function restoreEnvironmentValue(name, value) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

test('test database configuration never falls back to DATABASE_URL', () => {
  const originalTestUri = process.env.TEST_DATABASE_URL
  const originalApplicationUri = process.env.DATABASE_URL

  try {
    delete process.env.TEST_DATABASE_URL
    process.env.DATABASE_URL =
      'postgresql://localhost:5432/payway'

    assert.equal(hasTestDatabaseConfiguration(), false)
  } finally {
    restoreEnvironmentValue('TEST_DATABASE_URL', originalTestUri)
    restoreEnvironmentValue('DATABASE_URL', originalApplicationUri)
  }
})

test('test database configuration rejects the application database before connecting', async () => {
  const originalTestUri = process.env.TEST_DATABASE_URL

  try {
    process.env.TEST_DATABASE_URL =
      'postgresql://localhost:5432/payway'

    await assert.rejects(
      openTestDatabaseConnection(),
      /must select angkor_payment_test/,
    )
  } finally {
    restoreEnvironmentValue('TEST_DATABASE_URL', originalTestUri)
  }
})
