import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createWalletLinkRouter } from '../src/routes/walletLinkRoutes.js'
import { createRequireAuth } from '../src/middleware/requireAuth.js'
import { hashSessionToken } from '../src/services/authSessionService.js'
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
