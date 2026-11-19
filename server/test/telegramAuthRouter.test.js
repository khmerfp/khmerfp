import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import express from 'express'
import { createTelegramAuthRouter } from '../src/routes/telegramAuthRouter.js'

const originalEnvironment = {
  TG_CLIENT_ID: process.env.TG_CLIENT_ID,
  TG_CLIENT_SECRET: process.env.TG_CLIENT_SECRET,
  TG_REDIRECT_URI: process.env.TG_REDIRECT_URI,
  FRONTEND_URL: process.env.FRONTEND_URL,
  NODE_ENV: process.env.NODE_ENV,
}

function restoreEnvironment() {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function createTestServer() {
  const app = express()
  app.use('/api/auth/telegram', createTelegramAuthRouter({
    authRateLimiter: (_request, _response, next) => next(),
    jwks: async () => { throw new Error('JWKS should not be requested') },
  }))
  return app.listen(0)
}

afterEach(restoreEnvironment)

test('Telegram login starts OIDC with PKCE and a short-lived HttpOnly state cookie', async (context) => {
  process.env.NODE_ENV = 'development'
  process.env.TG_CLIENT_ID = 'telegram-client-id'
  process.env.TG_CLIENT_SECRET = 'telegram-client-secret'
  process.env.TG_REDIRECT_URI = 'http://localhost:3000/api/auth/telegram/callback'
  process.env.FRONTEND_URL = 'http://localhost:5173'

  const server = createTestServer()
  context.after(() => server.close())
  const address = server.address()
  const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/telegram/login`, {
    redirect: 'manual',
  })

  assert.equal(response.status, 302)
  const authorizationUrl = new URL(response.headers.get('location'))
  assert.equal(authorizationUrl.origin, 'https://oauth.telegram.org')
  assert.equal(authorizationUrl.pathname, '/auth')
  assert.equal(authorizationUrl.searchParams.get('client_id'), 'telegram-client-id')
  assert.equal(authorizationUrl.searchParams.get('redirect_uri'), process.env.TG_REDIRECT_URI)
  assert.equal(authorizationUrl.searchParams.get('scope'), 'openid profile')
  assert.equal(authorizationUrl.searchParams.get('response_type'), 'code')
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256')
  assert.match(authorizationUrl.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/)
  assert.match(authorizationUrl.searchParams.get('state'), /^[A-Za-z0-9_-]{43}$/)
  assert.match(authorizationUrl.searchParams.get('nonce'), /^[A-Za-z0-9_-]{43}$/)
  const cookie = response.headers.get('set-cookie')
  assert.match(cookie, /^telegram_oidc_state=/)
  assert.match(cookie, /HttpOnly/i)
  assert.match(cookie, /SameSite=Lax/i)
  assert.match(cookie, /Max-Age=600/i)
})

test('Telegram login reports missing OIDC configuration without exposing secrets', async (context) => {
  process.env.NODE_ENV = 'development'
  delete process.env.TG_CLIENT_ID
  delete process.env.TG_CLIENT_SECRET
  delete process.env.TG_REDIRECT_URI
  delete process.env.FRONTEND_URL

  const server = createTestServer()
  context.after(() => server.close())
  const address = server.address()
  const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/telegram/login`)
  const body = await response.json()

  assert.equal(response.status, 503)
  assert.match(body.message, /Telegram sign-in is not configured/)
})
