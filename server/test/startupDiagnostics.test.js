import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatStartupDiagnostics,
  logStartupDiagnostics,
  redactSensitiveText,
} from '../src/logging/startupDiagnostics.js'

const environmentVariables = {
  DATABASE_URL:
    'postgres://app:database-password@db.example.com:5432/angkor',
  PAYWAY_SANDBOX_API_KEY: 'hidden-api-key',
  FACEBOOK_APP_SECRET: 'hidden-facebook-secret',
  APP_ORIGINS: 'http://localhost:5173',
}

test('reports the error name, message, stack, code, and cause', () => {
  const cause = new Error('connection refused for hidden-api-key')
  cause.code = 'ECONNREFUSED'

  const error = new Error(
    'Could not start with postgres://app:database-password@db.example.com/angkor',
  )
  error.code = 'EADDRINUSE'
  error.stack = 'Error: startup failed\n    at start (server.js:1:1)'
  error.cause = cause

  const report = formatStartupDiagnostics(error, environmentVariables)

  assert.match(report, /error name: Error/)
  assert.match(report, /error message: Could not start/)
  assert.match(report, /error code: EADDRINUSE/)
  assert.match(report, /at start \(server\.js:1:1\)/)
  assert.match(report, /error cause name: Error/)
  assert.match(report, /error cause message: connection refused/)
  assert.match(report, /error cause code: ECONNREFUSED/)
})

test('redacts configured secrets and credential-shaped text', () => {
  const text = [
    'DATABASE_URL=postgres://app:database-password@db.example.com/angkor',
    'api_key=hidden-api-key',
    'password=hidden-facebook-secret',
    'APP_ORIGINS=http://localhost:5173',
  ].join('\n')

  const redacted = redactSensitiveText(text, environmentVariables)

  assert.equal(redacted.includes('database-password'), false)
  assert.equal(redacted.includes('hidden-api-key'), false)
  assert.equal(redacted.includes('hidden-facebook-secret'), false)
  assert.match(redacted, /postgres:\/\/\[REDACTED\]@db\.example\.com/)
  assert.match(redacted, /APP_ORIGINS=http:\/\/localhost:5173/)
})

test('formats thrown values that are not Error instances', () => {
  assert.match(
    formatStartupDiagnostics('hidden-api-key', environmentVariables),
    /error: \[REDACTED\]/,
  )
})

test('logs diagnostics through the error channel', () => {
  const records = []
  const writer = { error: (record) => records.push(record) }

  logStartupDiagnostics(new Error('listen EADDRINUSE'), {
    environmentVariables,
    writer,
  })

  assert.equal(records.length, 1)
  assert.match(records[0], /error message: listen EADDRINUSE/)
})
