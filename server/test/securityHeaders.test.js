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

test('allows google sign-in while keeping other sources self-hosted', () => {
  const { headers } = collectHeaders(false)
  const policy = headers.get('Content-Security-Policy')

  assert.match(policy, /script-src 'self' https:\/\/accounts\.google\.com/)
  assert.match(policy, /connect-src 'self' https:\/\/accounts\.google\.com/)
  assert.match(policy, /frame-src 'self' https:\/\/accounts\.google\.com/)
  assert.match(policy, /img-src 'self' data: https:\/\/\*\.googleusercontent\.com/)
  assert.equal(
    headers.get('Cross-Origin-Opener-Policy'),
    'same-origin-allow-popups',
  )
})

test('allows the telegram login widget and nothing wider', () => {
  const { headers } = collectHeaders(false)
  const policy = headers.get('Content-Security-Policy')

  assert.match(policy, /script-src [^;]*https:\/\/telegram\.org/)
  assert.match(policy, /frame-src [^;]*https:\/\/oauth\.telegram\.org/)
  assert.doesNotMatch(policy, /script-src [^;]*https:\/\/evil\.example/)
})

test('sets hsts only for production runtime', () => {
  const { headers } = collectHeaders(true)

  assert.equal(
    headers.get('Strict-Transport-Security'),
    'max-age=31536000; includeSubDomains',
  )
})
