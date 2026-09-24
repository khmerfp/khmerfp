import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSecurityHeaders } from '../src/middleware/securityHeaders.js'

// run one middleware configuration
function collectHeaders(isProduction) {
  const headers = new Map()
  let continued = false
  createSecurityHeaders({ isProduction })(
    {},
    { setHeader: (name, value) => headers.set(name, value) },
    () => { continued = true },
  )
  return { headers, continued }
}

test('sets restrictive headers with sandbox checkout form access', () => {
  const { headers, continued } = collectHeaders(false)
  const policy = headers.get('Content-Security-Policy')

  assert.equal(continued, true)
  assert.match(policy, /default-src 'self'/)
  assert.match(policy, /form-action 'self' https:\/\/checkout-sandbox\.payway\.com\.kh/)
  assert.match(policy, /frame-ancestors 'none'/)
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(headers.get('X-Frame-Options'), 'DENY')
  assert.equal(headers.has('Access-Control-Allow-Origin'), false)
  assert.equal(headers.has('Strict-Transport-Security'), false)
})

test('sets hsts only for production runtime', () => {
  const { headers } = collectHeaders(true)

  assert.equal(
    headers.get('Strict-Transport-Security'),
    'max-age=31536000; includeSubDomains',
  )
})
