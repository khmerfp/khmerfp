import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isBrowserOriginAllowed } from '../src/config/origins.js'

const production = {
  NODE_ENV: 'production',
  APP_ORIGINS: 'https://khmerfp.com,http://localhost:5173',
}

test('allows configured origins and their www counterpart', () => {
  assert.equal(
    isBrowserOriginAllowed('https://khmerfp.com', production),
    true,
  )
  assert.equal(
    isBrowserOriginAllowed('https://www.khmerfp.com', production),
    true,
  )
})

test('rejects origins outside the allowlist in production', () => {
  assert.equal(isBrowserOriginAllowed('https://evil.example', production), false)
})

test('allows loopback origins only outside production', () => {
  const development = {
    NODE_ENV: 'development',
    APP_ORIGINS: 'https://khmerfp.com',
  }

  assert.equal(isBrowserOriginAllowed('http://localhost:5173', development), true)
  assert.equal(isBrowserOriginAllowed('http://127.0.0.1:4173', development), true)

  const unconfiguredLoopback = {
    NODE_ENV: 'production',
    APP_ORIGINS: 'https://khmerfp.com',
  }

  assert.equal(
    isBrowserOriginAllowed('http://localhost:5173', unconfiguredLoopback),
    false,
  )
})
