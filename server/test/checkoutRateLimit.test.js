import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCheckoutRateLimiter } from '../src/middleware/checkoutRateLimit.js'

// run one limiter request
function runRequest(limiter, ip) {
  const headers = new Map()
  let statusCode
  let body
  let continued = false
  limiter(
    { ip },
    {
      set: (name, value) => headers.set(name, value),
      status(code) {
        statusCode = code
        return this
      },
      json(value) { body = value },
    },
    () => { continued = true },
  )
  return { body, continued, headers, statusCode }
}

test('limits checkout preparation per client without affecting another client', () => {
  const limiter = createCheckoutRateLimiter({ limit: 2, windowMs: 60_000, now: () => 1_000 })

  assert.equal(runRequest(limiter, '192.0.2.1').continued, true)
  assert.equal(runRequest(limiter, '192.0.2.1').continued, true)
  const blocked = runRequest(limiter, '192.0.2.1')
  assert.equal(blocked.statusCode, 429)
  assert.deepEqual(blocked.body, { message: 'Too many checkout preparation requests.' })
  assert.equal(blocked.headers.get('Cache-Control'), 'no-store')
  assert.equal(blocked.headers.get('Retry-After'), '60')
  assert.equal(runRequest(limiter, '192.0.2.2').continued, true)
})

test('resets checkout limits after the configured window', () => {
  let currentTime = 1_000
  const limiter = createCheckoutRateLimiter({
    limit: 1,
    windowMs: 1_000,
    now: () => currentTime,
  })

  assert.equal(runRequest(limiter, '192.0.2.1').continued, true)
  assert.equal(runRequest(limiter, '192.0.2.1').statusCode, 429)
  currentTime = 2_000
  assert.equal(runRequest(limiter, '192.0.2.1').continued, true)
})
