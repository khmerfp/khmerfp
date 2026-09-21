import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createApp } from '../src/app.js'

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

async function startTestApp(databaseIsReady) {
  const server = createApp({ databaseIsReady }).listen(0)
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

