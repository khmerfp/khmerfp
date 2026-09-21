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

