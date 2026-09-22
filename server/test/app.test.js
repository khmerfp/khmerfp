import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createApp } from '../src/app.js'
import { CheckoutUnavailableError } from '../src/services/checkoutPreparationService.js'
import { PaymentDetailsValidationError } from '../src/services/pendingTransactionService.js'

const servers = new Set()

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

test('health reports process health independently of database readiness', async () => {
  const baseUrl = await startTestApp(() => false)
  const response = await fetch(`${baseUrl}/api/health`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
})

test('readiness reports ready when MongoDB is connected', async () => {
  const baseUrl = await startTestApp(() => true)
  const response = await fetch(`${baseUrl}/api/ready`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ready' })
})

test('readiness reports unavailable when MongoDB is disconnected', async () => {
  const baseUrl = await startTestApp(() => false)
  const response = await fetch(`${baseUrl}/api/ready`)

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { status: 'unavailable' })
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

test('checkout preparation reports disabled sandbox checkout', async () => {
  const baseUrl = await startTestApp(() => true, {
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
  assert.deepEqual(await response.json(), { message: 'Sandbox checkout is disabled.' })
})

test('checkout preparation returns field validation errors', async () => {
  const baseUrl = await startTestApp(() => true, {
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

test('checkout preparation hides database failures', async () => {
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    const baseUrl = await startTestApp(() => true, {
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
  const baseUrl = await startTestApp(() => false, {
    callbackSecret: 'fictional-callback-secret',
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
})

test('authenticated callback returns temporary non-success without processing', async () => {
  const baseUrl = await startTestApp(() => false, {
    callbackSecret: 'fictional-callback-secret',
  })
  const response = await postCallback(baseUrl, callbackPayload)

  assert.equal(response.status, 501)
  assert.deepEqual(await response.json(), {
    message: 'Callback authenticated, but payment processing is not implemented.',
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
