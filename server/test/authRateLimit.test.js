import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAuthRateLimiter } from '../src/middleware/authRateLimit.js'

// minimal request, response and next stand-ins
function createHarness(pool) {
  const state = { status: null, body: null, headers: new Map(), continued: false, error: null }

  const request = {
    method: 'POST',
    baseUrl: '/api/auth',
    path: '/google',
    ip: '203.0.113.10',
    get: (name) => (name === 'user-agent' ? 'test-agent' : undefined),
  }

  const response = {
    setHeader: (name, value) => state.headers.set(name, value),
    status(code) {
      state.status = code
      return this
    },
    json(body) {
      state.body = body
      return this
    },
  }

  const limiter = createAuthRateLimiter({ pool })

  return {
    state,
    request,
    async run() {
      await limiter(request, response, (error) => {
        if (error) state.error = error
        else state.continued = true
      })
    },
  }
}

function poolReturning(requestCount, blockedUntil = null) {
  return {
    async query(sql, _params) {
      if (sql.includes('RETURNING')) {
        return { rows: [{ request_count: requestCount, blocked_until: blockedUntil }] }
      }

      return { rows: [] }
    },
  }
}

test('auth rate limit continues under the allowed request count', async () => {
  const harness = createHarness(poolReturning(3))

  await harness.run()

  assert.equal(harness.state.continued, true)
  assert.equal(harness.state.status, null)
})

test('auth rate limit blocks when the window count exceeds the maximum', async () => {
  const harness = createHarness(poolReturning(11))

  await harness.run()

  assert.equal(harness.state.continued, false)
  assert.equal(harness.state.status, 429)
  assert.deepEqual(harness.state.body, {
    message: 'Too many attempts. Try again later.',
  })
  assert.equal(harness.state.headers.get('Retry-After'), '900')
})

test('auth rate limit honours an active blocked_until window', async () => {
  const activeBlock = new Date(Date.now() + 60_000).toISOString()
  const harness = createHarness(poolReturning(1, activeBlock))

  await harness.run()

  assert.equal(harness.state.continued, false)
  assert.equal(harness.state.status, 429)
})

test('auth rate limit allows traffic again after the block has expired', async () => {
  const expiredBlock = new Date(Date.now() - 60_000).toISOString()
  const harness = createHarness(poolReturning(1, expiredBlock))

  await harness.run()

  assert.equal(harness.state.continued, true)
  assert.equal(harness.state.status, null)
})

test('auth rate limit keys scope counters per client ip', async () => {
  const seenKeys = []
  const pool = {
    async query(sql, params) {
      if (sql.includes('RETURNING')) {
        seenKeys.push(params[0])
        return { rows: [{ request_count: 1, blocked_until: null }] }
      }

      return { rows: [] }
    },
  }

  const first = createHarness(pool)
  await first.run()

  const second = createHarness(pool)
  second.request.ip = '198.51.100.7'
  await second.run()

  assert.match(seenKeys[0], /203\.0\.113\.10/)
  assert.match(seenKeys[1], /198\.51\.100\.7/)
  assert.notEqual(seenKeys[0], seenKeys[1])
})
