// test wallet-link api access rules and authenticated requests.
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createWalletLinkRouter } from '../src/routes/walletLinkRoutes.js'
import { createRequireAuth } from '../src/middleware/requireAuth.js'
import { hashSessionToken } from '../src/services/authSessionService.js'
import { WalletLinkError } from '../src/walletLinking/service.js'
import { createWalletLinkRepository } from '../src/walletLinking/repository.js'

test('wallet-link routes preserve existing auth, reject CSRF and derive user/session on the server', async () => {
  const previous = process.env.WALLET_LINK_APP_ORIGIN
  process.env.WALLET_LINK_APP_ORIGIN = 'http://127.0.0.1:5173'
  const seen = [],
    app = express()
  app.use(express.json())
  const guard = createRequireAuth(async (req) => (req.headers.cookie ? { id: '41' } : null))
  app.use(
    '/api/wallet-links',
    createWalletLinkRouter({
      enabled: () => true,
      authGuard: guard,
      service: {
        issue: async (actor, body) => {
          seen.push({ actor, body })
          return { challengeId: 'test' }
        },
        list: async () => [],
      },
    }),
  )
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}/api/wallet-links/challenges`
  const post = (headers) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ walletAddress: 'test', chainId: 84532, action: 'LINK' }),
    })
  try {
    assert.equal((await post({ Origin: 'http://127.0.0.1:5173' })).status, 401)
    assert.equal(
      (await post({ Cookie: 'angkor_session=test', Origin: 'https://evil.example' })).status,
      403,
    )
    assert.equal((await post({ Cookie: 'angkor_session=test' })).status, 403)
    assert.equal(
      (await post({ Cookie: 'angkor_session=test', Origin: 'http://127.0.0.1:5173' })).status,
      201,
    )
    assert.deepEqual(seen[0].actor, { userId: '41', sessionHash: hashSessionToken('test') })
  } finally {
    await new Promise((resolve) => server.close(resolve))
    if (previous === undefined) {
      delete process.env.WALLET_LINK_APP_ORIGIN
    } else {
      process.env.WALLET_LINK_APP_ORIGIN = previous
    }
  }
})

test('missing proposed challenge table fails closed and releases its dedicated transaction client', async () => {
  const queries = []
  let released = false
  const client = {
    query: async (sql) => {
      queries.push(sql)
      return { rows: [{ challenges: null, wallets: 'user_wallets' }] }
    },
    release: () => {
      released = true
    },
  }
  const repository = createWalletLinkRepository(() => ({ connect: async () => client }))
  await assert.rejects(
    repository.transaction(async () => {
      throw new Error('Must not run')
    }),
    (err) => err.status === 503,
  )
  assert.equal(queries[0], 'BEGIN')
  assert.equal(queries.at(-1), 'ROLLBACK')
  assert.equal(released, true)
  assert.equal(
    queries.some((sql) => /CREATE TABLE|ALTER TABLE|INSERT/.test(sql)),
    false,
  )
})

test('production refuses wallet linking even with the opt-in set; injected test evidence is unreachable', async () => {
  const previousMode = process.env.NODE_ENV
  const previousFlag = process.env.WALLET_LINK_ENABLED
  process.env.NODE_ENV = 'production'
  process.env.WALLET_LINK_ENABLED = 'true'
  let called = false
  const app = express()
  app.use(express.json())
  app.use('/api/wallet-links', createWalletLinkRouter({
    service: { verify: async () => { called = true; return {} } },
  }))
  const http = app.listen(0, '127.0.0.1')
  await new Promise(resolve => http.once('listening', resolve))
  try {
    const response = await fetch(`http://127.0.0.1:${http.address().port}/api/wallet-links/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.status, 503)
    assert.equal(called, false)
  } finally {
    await new Promise(resolve => http.close(resolve))
    if (previousMode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousMode
    if (previousFlag === undefined) delete process.env.WALLET_LINK_ENABLED
    else process.env.WALLET_LINK_ENABLED = previousFlag
  }
})

test('wallet list identifies its authenticated owner and unknown errors never expose details', async () => {
  const previous = process.env.WALLET_LINK_APP_ORIGIN
  process.env.WALLET_LINK_APP_ORIGIN = 'http://127.0.0.1:5173'
  let failure = null
  const app = express()
  app.use('/api/wallet-links', createWalletLinkRouter({ enabled: () => true,
    authGuard: createRequireAuth(async () => ({ id: '41' })),
    service: { list: async () => { if (failure) throw failure; return [] } },
  }))
  const http = app.listen(0, '127.0.0.1')
  await new Promise(resolve => http.once('listening', resolve))
  const read = () => fetch(`http://127.0.0.1:${http.address().port}/api/wallet-links`, {
    headers: { Cookie: 'angkor_session=isolated-test-session' }, signal: AbortSignal.timeout(5000),
  })
  try {
    assert.deepEqual(await (await read()).json(), { userId: '41', wallets: [] })
    for (const status of [401, 500, 503, 999]) {
      failure = Object.assign(new Error('sensitive-upstream-marker'), { status })
      const response = await read()
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { message: 'Wallet linking unavailable.' })
    }
    failure = new WalletLinkError('Challenge expired.', 410)
    const response = await read()
    assert.equal(response.status, 410)
    assert.deepEqual(await response.json(), { message: 'Challenge expired.' })
  } finally {
    await new Promise(resolve => http.close(resolve))
    if (previous === undefined) delete process.env.WALLET_LINK_APP_ORIGIN
    else process.env.WALLET_LINK_APP_ORIGIN = previous
  }
})
