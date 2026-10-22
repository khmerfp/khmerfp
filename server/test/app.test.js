import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createApp,
  FrontendBuildError,
  getTrustProxy,
} from '../src/app.js'
import { CheckoutUnavailableError } from '../src/services/checkoutPreparationService.js'
import { PaymentDetailsValidationError } from '../src/services/pendingTransactionService.js'
import { PaymentReconciliationError } from '../src/services/paymentReconciliationService.js'
import { PaymentStatusUnavailableError } from '../src/services/paymentStatusService.js'

const servers = new Set()
const frontendFixturePath = fileURLToPath(
  new URL('./fixtures/frontend-dist/', import.meta.url),
)

afterEach(async () => {
  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve)
        }),
    ),
  )
  servers.clear()
})

async function startTestApp(databaseIsReady, appOptions = {}) {
  const server = createApp({ databaseIsReady, ...appOptions }).listen(0)
  servers.add(server)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

// most checkout tests exercise the payment contract, not the Telegram gate
const allowVerifiedFactor = (_request, _response, next) => next()

test('health reports process health independently of database readiness', async () => {
  const baseUrl = await startTestApp(() => false)
  const response = await fetch(`${baseUrl}/api/health`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
  assert.match(response.headers.get('x-request-id'), /^[a-f0-9-]{36}$/)
})

test('preserves a valid request id on api responses', async () => {
  const baseUrl = await startTestApp(() => true)
  const response = await fetch(`${baseUrl}/api/health`, {
    headers: { 'X-Request-ID': 'client-request-123' },
  })

  assert.equal(response.headers.get('x-request-id'), 'client-request-123')
})

test('readiness reports ready when the database is connected', async () => {
  const baseUrl = await startTestApp(() => true)
  const response = await fetch(`${baseUrl}/api/ready`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ready' })
})

test('readiness reports unavailable when the database is disconnected', async () => {
  const baseUrl = await startTestApp(() => false)
  const response = await fetch(`${baseUrl}/api/ready`)

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { status: 'unavailable' })
})

test('unknown api routes return json instead of frontend html', async () => {
  const baseUrl = await startTestApp(() => true, {
    serveFrontend: true,
    frontendDistPath: frontendFixturePath,
  })
  const response = await fetch(`${baseUrl}/api/not-a-route`)

  assert.equal(response.status, 404)
  assert.match(response.headers.get('content-type'), /application\/json/)
  assert.deepEqual(await response.json(), { message: 'API route not found.' })
})

for (const path of ['/', '/login', '/register', '/security', '/payment/result', '/payment/cancel']) {
  test(`built frontend supports direct navigation to ${path}`, async () => {
    const baseUrl = await startTestApp(() => true, {
      serveFrontend: true,
      frontendDistPath: frontendFixturePath,
    })
    const response = await fetch(`${baseUrl}${path}`)

    assert.equal(response.status, 200)
    assert.match(await response.text(), /frontend fixture/)
  })
}

test('static serving returns assets but never falls back for missing or private paths', async () => {
  const baseUrl = await startTestApp(() => true, {
    serveFrontend: true,
    frontendDistPath: frontendFixturePath,
  })
  const asset = await fetch(`${baseUrl}/assets/app.css`)
  assert.equal(asset.status, 200)
  assert.match(await asset.text(), /color/)

  for (const path of ['/assets/missing.js', '/server/src/app.js', '/.env']) {
    const response = await fetch(`${baseUrl}${path}`)
    assert.equal(response.status, 404)
    assert.doesNotMatch(await response.text(), /frontend fixture/)
  }
})

test('static serving fails clearly when the frontend build is missing', () => {
  assert.throws(
    () => createApp({
      serveFrontend: true,
      frontendDistPath: `${frontendFixturePath}/missing`,
    }),
    FrontendBuildError,
  )
})

test('auth routes are reachable instead of falling through to the api 404', async () => {
  const baseUrl = await startTestApp(() => true)
  const config = await fetch(`${baseUrl}/api/auth/config`)

  assert.equal(config.status, 200)
  assert.equal(config.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await config.json(), {
    googleClientId: null,
    facebookAppId: null,
    telegramBotUsername: null,
  })

  const me = await fetch(`${baseUrl}/api/auth/me`)
  assert.equal(me.status, 401)
  assert.deepEqual(await me.json(), { message: 'Authentication required.' })
})

test('google sign-in rejects a disallowed origin and a missing credential', async () => {
  const baseUrl = await startTestApp(() => true)

  const blocked = await fetch(`${baseUrl}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ credential: 'token' }),
  })
  assert.equal(blocked.status, 403)

  const missing = await fetch(`${baseUrl}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({}),
  })
  assert.equal(missing.status, 401)
})

test('forged and malformed google id tokens are rejected with 401', async () => {
  const baseUrl = await startTestApp(() => true)

  const forgedTokens = [
    'not-a-jwt',
    'a.b.c',
    `${'x'.repeat(200)}.${'y'.repeat(200)}.${'z'.repeat(200)}`,
    'eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.',
  ]

  for (const credential of forgedTokens) {
    const response = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify({ credential }),
    })

    assert.equal(response.status, 401)
    const body = await response.json()
    assert.equal(body.message, 'Invalid or expired Google ID token.')
  }
})

test('email password register and login endpoints are available', async () => {
  const baseUrl = await startTestApp(() => true)

  for (const path of ['/api/auth/register', '/api/auth/login']) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ email: 'a@example.com', password: 'password123' }),
    })
    // the endpoints exist (not a 404); the real credential checks live in
    // authPersistence.test.js where a test database is available.
    assert.notEqual(response.status, 404, `${path} should exist`)
  }
})

test('session identity comes only from the cookie, never from request parameters', async () => {
  const baseUrl = await startTestApp(() => true)

  const me = await fetch(`${baseUrl}/api/auth/me?user_id=999&market_id=1`)
  assert.equal(me.status, 401)

  const forgedCookie = await fetch(`${baseUrl}/api/auth/me?user_id=999`, {
    headers: { Cookie: 'angkor_session=forged-token-from-an-attacker' },
  })
  // without a matching session row the request can never resolve a user
  assert.notEqual(forgedCookie.status, 200)
})

test('auth post endpoints reject a disallowed origin before doing any work', async () => {
  const baseUrl = await startTestApp(() => true)

  for (const path of [
    '/api/auth/google',
    '/api/auth/facebook',
    '/api/auth/facebook/code',
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/factors/telegram',
    '/api/auth/step-up',
    '/api/auth/logout',
  ]) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({}),
    })
    assert.equal(response.status, 403, `${path} should reject the origin`)
  }
})

test('production proxy trust is limited to private proxy ranges', () => {
  assert.deepEqual(getTrustProxy({ NODE_ENV: 'production' }), [
    'loopback', 'linklocal', 'uniquelocal',
  ])
  assert.equal(getTrustProxy({ NODE_ENV: 'development' }), false)
})

for (const amount of [1, 2000]) {
  test(`payment details validate for the exam amount ${amount} KHR`, async () => {
    const baseUrl = await startTestApp(() => false)
    const response = await fetch(`${baseUrl}/api/payments/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'សុខា ឧទាហរណ៍',
        accountNumber: '0012345678',
        amount,
      }),
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      message: 'Validation passed. No payment was initiated.',
      details: { amount, currency: 'KHR' },
    })
  })
}

test('payment validation returns consistent field errors', async () => {
  const baseUrl = await startTestApp(() => false)
  const response = await fetch(`${baseUrl}/api/payments/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ' ', accountNumber: 123, amount: '2000', status: 'PAID' }),
  })
  const body = await response.json()

  assert.equal(response.status, 400)
  assert.equal(body.message, 'Validation failed.')
  assert.deepEqual(Object.keys(body.errors).sort(), [
    'accountNumber',
    'amount',
    'name',
    'status',
  ])
})

test('payment validation rejects malformed JSON with a useful JSON response', async () => {
  const baseUrl = await startTestApp(() => false)
  const response = await fetch(`${baseUrl}/api/payments/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"name":',
  })

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { message: 'Malformed JSON request body.' })
})

test('payment validation rejects oversized JSON with a useful JSON response', async () => {
  const baseUrl = await startTestApp(() => false)
  const response = await fetch(`${baseUrl}/api/payments/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'a'.repeat(11 * 1024), accountNumber: '001', amount: 1 }),
  })

  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { message: 'JSON request body is too large.' })
})

test('checkout preparation requires an authenticated session', async () => {
  const baseUrl = await startTestApp(() => true)
  const response = await fetch(`${baseUrl}/api/payments/checkout/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Example', accountNumber: '0001', amount: 1 }),
  })

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { message: 'Authentication required.' })
})

test('checkout preparation reports disabled checkout', async () => {
  const baseUrl = await startTestApp(() => true, {
    factorGuard: allowVerifiedFactor,
    checkoutPreparation: async () => {
      throw new CheckoutUnavailableError()
    },
  })
  const response = await fetch(`${baseUrl}/api/payments/checkout/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Example', accountNumber: '0001', amount: 1 }),
  })

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { message: 'Checkout is disabled.' })
})

test('checkout preparation returns field validation errors', async () => {
  const baseUrl = await startTestApp(() => true, {
    factorGuard: allowVerifiedFactor,
    checkoutPreparation: async () => {
      throw new PaymentDetailsValidationError({ amount: 'Invalid amount.' })
    },
  })
  const response = await fetch(`${baseUrl}/api/payments/checkout/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Example', accountNumber: '0001', amount: 2 }),
  })

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    message: 'Validation failed.',
    errors: { amount: 'Invalid amount.' },
  })
})

test('checkout preparation returns a minimal signed form contract', async () => {
  const checkout = {
    environment: 'sandbox',
    action: 'https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/purchase',
    method: 'POST',
    fields: {
      req_time: '20260921123456',
      merchant_id: 'fictional-merchant',
      tran_id: '12345678901234567890',
      amount: '1',
      currency: 'KHR',
      hash: 'fictional-signature',
    },
  }
  const baseUrl = await startTestApp(() => true, {
    factorGuard: allowVerifiedFactor,
    checkoutPreparation: async () => checkout,
  })
  const response = await fetch(`${baseUrl}/api/payments/checkout/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Example', accountNumber: '0001', amount: 1 }),
  })
  const body = await response.json()

  assert.equal(response.status, 201)
  assert.deepEqual(body.checkout, checkout)
  assert.equal(JSON.stringify(body).includes('apiKey'), false)
  assert.equal(JSON.stringify(body).includes('privateKey'), false)
})

test('protected status endpoint returns only safe fields without caching', async () => {
  const payment = {
    tranId: '12345678901234567890',
    amount: 2000,
    currency: 'KHR',
    status: 'PAID',
    paidAt: '2026-09-22T00:00:00.000Z',
  }
  let received
  const baseUrl = await startTestApp(() => true, {
    statusLookup: async (...args) => {
      received = args
      return payment
    },
  })
  const response = await fetch(`${baseUrl}/api/payments/${payment.tranId}/status`, {
    headers: { 'X-Payment-Status-Token': 'A'.repeat(43) },
  })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(received, [payment.tranId, 'A'.repeat(43)])
  assert.deepEqual(await response.json(), { payment })
})

test('missing, incorrect, and unknown protected status access look identical', async () => {
  const baseUrl = await startTestApp(() => true, {
    statusLookup: async () => { throw new PaymentStatusUnavailableError() },
  })

  for (const headers of [{}, { 'X-Payment-Status-Token': 'B'.repeat(43) }]) {
    const response = await fetch(`${baseUrl}/api/payments/123/status`, { headers })
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { message: 'Payment status is unavailable.' })
  }
})

test('protected status endpoint applies a bounded request rate', async () => {
  const baseUrl = await startTestApp(() => true, {
    statusLookup: async () => ({
      tranId: '123', amount: 1, currency: 'KHR', status: 'PENDING', paidAt: null,
    }),
  })

  let response
  for (let index = 0; index < 31; index += 1) {
    response = await fetch(`${baseUrl}/api/payments/123/status`, {
      headers: { 'X-Payment-Status-Token': 'A'.repeat(43) },
    })
  }
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('checkout preparation hides database failures', async () => {
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    const baseUrl = await startTestApp(() => true, {
      factorGuard: allowVerifiedFactor,
      checkoutPreparation: async () => {
        throw new Error('database connection details')
      },
    })
    const response = await fetch(`${baseUrl}/api/payments/checkout/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Example', accountNumber: '0001', amount: 1 }),
    })

    assert.equal(response.status, 500)
    assert.deepEqual(await response.json(), {
      message: 'An unexpected server error occurred.',
    })
  } finally {
    console.error = originalConsoleError
  }
})

const callbackPayload = Object.freeze({
  tran_id: '000123456789',
  status: '0',
  original_amount: 2000,
  original_currency: 'KHR',
  payment_amount: 2000,
  payment_currency: 'KHR',
  total_amount: 2000,
  discount_amount: 0,
  transaction_date: '2026-09-22 10:20:30',
  apv: '123456',
})
const callbackSignature =
  '5iLXxgTk9CLQxnf+k6fv7wOm1VFbIUItYsuD+mxHM9Bl/81Yu+NKH/pTq87U5AJKik5RXxy8LGp7CsfB9UAWPg=='

// post one fictional callback
async function postCallback(baseUrl, body, signature = callbackSignature) {
  return fetch(`${baseUrl}/api/payments/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signature === null
        ? {}
        : { 'X-PayWay-HMAC-SHA512': signature }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

test('callback rejects processing while its secret is missing', async () => {
  const baseUrl = await startTestApp(() => false, { callbackSecret: null })
  const response = await postCallback(baseUrl, callbackPayload)

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    message: 'PayWay callback verification is not configured.',
  })
})

test('callback rejects missing malformed and incorrect signatures', async () => {
  let reconciliationCalls = 0
  const baseUrl = await startTestApp(() => false, {
    callbackSecret: 'fictional-callback-secret',
    callbackReconciliation: async () => {
      reconciliationCalls += 1
    },
  })

  for (const signature of [null, 'not-base64', callbackSignature]) {
    const body = signature === callbackSignature
      ? { ...callbackPayload, total_amount: 1 }
      : callbackPayload
    const response = await postCallback(baseUrl, body, signature)

    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), {
      message: 'Invalid callback signature.',
    })
  }

  assert.equal(reconciliationCalls, 0)
})

test('authenticated callback acknowledges durable reconciliation', async () => {
  const baseUrl = await startTestApp(() => false, {
    callbackSecret: 'fictional-callback-secret',
    callbackReconciliation: async () => ({
      acknowledged: true,
      duplicate: false,
      status: 'PAID',
    }),
  })
  const response = await postCallback(baseUrl, callbackPayload)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    message: 'Callback handled durably.',
    status: 'paid',
  })
})

test('authenticated durable duplicate receives successful acknowledgement', async () => {
  const baseUrl = await startTestApp(() => false, {
    callbackSecret: 'fictional-callback-secret',
    callbackReconciliation: async () => ({
      acknowledged: true,
      duplicate: true,
      status: 'PAID',
    }),
  })
  const response = await postCallback(baseUrl, callbackPayload)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    message: 'Callback handled durably.',
    status: 'already_processed',
  })
})

test('transient reconciliation failure is not acknowledged', async () => {
  const baseUrl = await startTestApp(() => false, {
    callbackSecret: 'fictional-callback-secret',
    callbackReconciliation: async () => {
      throw new PaymentReconciliationError(
        'Payment status verification is temporarily unavailable.',
        'CHECK_TIMEOUT',
        503,
      )
    },
  })
  const response = await postCallback(baseUrl, callbackPayload)

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    message: 'Payment status verification is temporarily unavailable.',
    code: 'CHECK_TIMEOUT',
  })
})

test('callback validates fields only after authentication', async () => {
  const originalPayload = { tran_id: '0001' }
  let verifierPayload
  let validatorPayload
  const baseUrl = await startTestApp(() => false, {
    callbackSecret: 'fictional-callback-secret',
    callbackSignatureVerifier: (payload) => {
      verifierPayload = payload
      return true
    },
    callbackPayloadValidator: (payload) => {
      validatorPayload = payload
      return { isValid: false, errors: { status: 'This field is required.' } }
    },
  })
  const response = await postCallback(baseUrl, originalPayload, callbackSignature)

  assert.equal(response.status, 400)
  assert.deepEqual(verifierPayload, originalPayload)
  assert.equal(validatorPayload, verifierPayload)
  assert.deepEqual(await response.json(), {
    message: 'Callback validation failed.',
    errors: { status: 'This field is required.' },
  })
})

test('callback rejects malformed and oversized json before verification', async () => {
  let verifierCalls = 0
  const baseUrl = await startTestApp(() => false, {
    callbackSecret: 'fictional-callback-secret',
    callbackSignatureVerifier: () => {
      verifierCalls += 1
      return true
    },
  })

  const malformed = await postCallback(baseUrl, '{"tran_id":', callbackSignature)
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), {
    message: 'Malformed JSON request body.',
  })

  const oversized = await postCallback(
    baseUrl,
    { tran_id: '1', padding: 'a'.repeat(11 * 1024) },
    callbackSignature,
  )
  assert.equal(oversized.status, 413)
  assert.deepEqual(await oversized.json(), {
    message: 'JSON request body is too large.',
  })
  assert.equal(verifierCalls, 0)
})

test('callback rejects unsupported serialization and non-json content', async () => {
  const baseUrl = await startTestApp(() => false, {
    callbackSecret: 'fictional-callback-secret',
  })

  const unsupported = await postCallback(
    baseUrl,
    { amount: 1e-7 },
    callbackSignature,
  )
  assert.equal(unsupported.status, 422)
  assert.deepEqual(await unsupported.json(), {
    message: 'Callback payload uses unsupported serialization.',
  })

  const wrongContentType = await fetch(`${baseUrl}/api/payments/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'X-PayWay-HMAC-SHA512': callbackSignature,
    },
    body: JSON.stringify(callbackPayload),
  })
  assert.equal(wrongContentType.status, 415)
  assert.deepEqual(await wrongContentType.json(), {
    message: 'PayWay callbacks require application/json.',
  })
})
