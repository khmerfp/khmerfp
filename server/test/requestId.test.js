import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createRequestIdMiddleware,
  isValidRequestId,
} from '../src/middleware/requestId.js'

// run one request id middleware call
function runMiddleware(providedId) {
  const responseHeaders = new Map()
  const request = { get: () => providedId }
  let continued = false
  createRequestIdMiddleware(() => 'generated-request-id')(
    request,
    { set: (name, value) => responseHeaders.set(name, value) },
    () => { continued = true },
  )
  return { continued, request, responseHeaders }
}

test('preserves a valid incoming request id', () => {
  const result = runMiddleware('client-request-123')

  assert.equal(result.continued, true)
  assert.equal(result.request.requestId, 'client-request-123')
  assert.equal(result.responseHeaders.get('X-Request-ID'), 'client-request-123')
})

test('replaces missing or malformed request ids', () => {
  for (const value of [undefined, '', 'short', 'bad\r\nheader', 'a'.repeat(65)]) {
    const result = runMiddleware(value)
    assert.equal(result.request.requestId, 'generated-request-id')
    assert.equal(result.responseHeaders.get('X-Request-ID'), 'generated-request-id')
  }
})

test('accepts only bounded log-safe request ids', () => {
  assert.equal(isValidRequestId('550e8400-e29b-41d4-a716-446655440000'), true)
  assert.equal(isValidRequestId('bad request id'), false)
})
