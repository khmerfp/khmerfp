import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hasTestDatabaseConfiguration,
  openTestDatabaseConnection,
  closeTestDatabaseConnection,
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
    process.env.DATABASE_URL = 'postgresql://localhost:5432/payway'

    assert.equal(hasTestDatabaseConfiguration(), false)
  } finally {
    restoreEnvironmentValue('TEST_DATABASE_URL', originalTestUri)
    restoreEnvironmentValue('DATABASE_URL', originalApplicationUri)
  }
})

test('test database setup rejects hosted, production and unapproved targets before connecting', async () => {
  const names = ['TEST_DATABASE_URL', 'TEST_DATABASE_DISPOSABLE', 'NODE_ENV']
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  try {
    for (const patch of [
      { url: 'postgresql://example.com/angkor_payment_test', optIn: 'true', mode: 'test' },
      {
        url: 'postgresql://127.0.0.1/angkor_payment_test?options=anything',
        optIn: 'true',
        mode: 'test',
      },
      { url: 'postgresql://127.0.0.1/angkor_payment_test', optIn: 'false', mode: 'test' },
      { url: 'postgresql://127.0.0.1/angkor_payment_test', optIn: 'true', mode: 'production' },
    ]) {
      process.env.TEST_DATABASE_URL = patch.url
      process.env.TEST_DATABASE_DISPOSABLE = patch.optIn
      process.env.NODE_ENV = patch.mode
      await assert.rejects(openTestDatabaseConnection())
    }
    await assert.rejects(closeTestDatabaseConnection({}), /Cleanup refused/)
  } finally {
    for (const name of names) restoreEnvironmentValue(name, previous[name])
  }
})

test('test database configuration rejects the application database before connecting', async () => {
  const originalTestUri = process.env.TEST_DATABASE_URL

  try {
    process.env.TEST_DATABASE_URL = 'postgresql://localhost:5432/payway'

    await assert.rejects(openTestDatabaseConnection(), /must select angkor_payment_test/)
  } finally {
    restoreEnvironmentValue('TEST_DATABASE_URL', originalTestUri)
  }
})
