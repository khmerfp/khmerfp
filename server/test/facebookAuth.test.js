import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createApp } from '../src/app.js'
import {
  exchangeFacebookAuthorizationCode,
  resolveFacebookEmail,
  signInWithFacebook,
} from '../src/services/facebookAuthService.js'

const APP_ID = '1234567890'
const APP_SECRET = 'facebook-app-secret'
const ALLOWED_ORIGIN = 'http://localhost:5173'

const servers = new Set()
const originalFetch = globalThis.fetch

afterEach(async () => {
  globalThis.fetch = originalFetch

  await Promise.all(
    [...servers].map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve)
        }),
    ),
  )
  servers.clear()

  delete process.env.FACEBOOK_APP_ID
  delete process.env.FACEBOOK_APP_SECRET
})

async function startTestApp() {
  const server = createApp({ databaseIsReady: () => true }).listen(0)
  servers.add(server)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address()
  return `http://127.0.0.1:${port}`
}

function configureFacebookCredentials() {
  process.env.FACEBOOK_APP_ID = APP_ID
  process.env.FACEBOOK_APP_SECRET = APP_SECRET
}

// Intercept only the Graph API calls; the local test server still uses the
// real fetch implementation.
function mockFacebookGraph({ debugToken, profile, accessToken }) {
  globalThis.fetch = async (url, options) => {
    const href = typeof url === 'string' ? url : String(url)

    if (href.startsWith('https://graph.facebook.com/debug_token')) {
      return { ok: true, json: async () => ({ data: debugToken }) }
    }

    if (href.startsWith('https://graph.facebook.com/oauth/access_token')) {
      return {
        ok: true,
        json: async () => ({ access_token: accessToken }),
      }
    }

    if (href.startsWith('https://graph.facebook.com/me')) {
      return { ok: true, json: async () => profile }
    }

    return originalFetch(url, options)
  }
}

function postFacebookSignIn(baseUrl, body, origin = ALLOWED_ORIGIN) {
  return fetch(`${baseUrl}/api/auth/facebook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify(body),
  })
}

test('the auth config exposes the public Facebook app id', async () => {
  configureFacebookCredentials()
  const baseUrl = await startTestApp()

  const response = await fetch(`${baseUrl}/api/auth/config`)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.facebookAppId, APP_ID)
})

test('the auth config never exposes an invalid app id such as the app secret', async () => {
  process.env.FACEBOOK_APP_ID = APP_SECRET
  process.env.FACEBOOK_APP_SECRET = APP_ID
  const baseUrl = await startTestApp()

  const response = await fetch(`${baseUrl}/api/auth/config`)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.facebookAppId, null)
})

test('facebook sign-in reports an invalid app id as a configuration error', async () => {
  process.env.FACEBOOK_APP_ID = APP_SECRET
  process.env.FACEBOOK_APP_SECRET = APP_ID
  const baseUrl = await startTestApp()

  const response = await postFacebookSignIn(baseUrl, { accessToken: 'token' })

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    message:
      'FACEBOOK_APP_ID must be the numeric App ID from the Facebook app dashboard.',
  })
})

test('facebook sign-in rejects a disallowed origin', async () => {
  configureFacebookCredentials()
  const baseUrl = await startTestApp()

  const response = await postFacebookSignIn(
    baseUrl,
    { accessToken: 'token' },
    'https://evil.example',
  )

  assert.equal(response.status, 403)
})

test('facebook sign-in rejects a missing access token', async () => {
  configureFacebookCredentials()
  const baseUrl = await startTestApp()

  const response = await postFacebookSignIn(baseUrl, {})

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), {
    message: 'A Facebook access token is required.',
  })
})

test('facebook sign-in rejects an invalid token', async () => {
  configureFacebookCredentials()
  mockFacebookGraph({ debugToken: { is_valid: false } })
  const baseUrl = await startTestApp()

  const response = await postFacebookSignIn(baseUrl, { accessToken: 'bad-token' })

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), {
    message: 'The Facebook token is invalid or expired.',
  })
})

test('facebook sign-in rejects a token issued for another app', async () => {
  configureFacebookCredentials()
  mockFacebookGraph({
    debugToken: { is_valid: true, app_id: '9999999999', user_id: '42' },
  })
  const baseUrl = await startTestApp()

  const response = await postFacebookSignIn(baseUrl, { accessToken: 'foreign-token' })

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), {
    message: 'The Facebook token was issued for another app.',
  })
})

test('facebook sign-in reports a missing server configuration', async () => {
  const baseUrl = await startTestApp()

  const response = await postFacebookSignIn(baseUrl, { accessToken: 'token' })

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), {
    message: 'FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be configured.',
  })
})

test('signInWithFacebook rejects a missing token before touching the database', async () => {
  await assert.rejects(
    () => signInWithFacebook('', { ip: '127.0.0.1', get: () => '' }),
    /access token is required/,
  )
})

test('a shared Facebook email is normalized and used as the account address', () => {
  assert.equal(
    resolveFacebookEmail({ email: '  Person@Example.COM ' }, '42'),
    'person@example.com',
  )
})

test('a Facebook account without a shared email gets a reserved placeholder', () => {
  assert.equal(resolveFacebookEmail({}, '42'), 'facebook-42@facebook.local')
  assert.equal(
    resolveFacebookEmail({ email: '   ' }, '42'),
    'facebook-42@facebook.local',
  )
  assert.equal(resolveFacebookEmail(null, '42'), 'facebook-42@facebook.local')
})

test('the code exchange returns a user access token', async () => {
  configureFacebookCredentials()
  mockFacebookGraph({ accessToken: 'exchanged-token' })

  assert.equal(
    await exchangeFacebookAuthorizationCode('auth-code', 'http://localhost:5173/'),
    'exchanged-token',
  )
})

test('the code exchange rejects a missing or refused code', async () => {
  configureFacebookCredentials()

  await assert.rejects(
    () => exchangeFacebookAuthorizationCode('', 'http://localhost:5173/'),
    /authorization code is required/,
  )

  mockFacebookGraph({ accessToken: undefined })

  await assert.rejects(
    () => exchangeFacebookAuthorizationCode('bad-code', 'http://localhost:5173/'),
    /invalid or expired/,
  )
})

test('the code sign-in route rejects a redirect uri outside the allowed origins', async () => {
  configureFacebookCredentials()
  const baseUrl = await startTestApp()

  const response = await fetch(`${baseUrl}/api/auth/facebook/code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
    },
    body: JSON.stringify({
      code: 'auth-code',
      redirectUri: 'https://evil.example/steal',
    }),
  })

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    message: 'The Facebook redirect URI is not allowed.',
  })
})

test('the code sign-in route rejects a disallowed origin', async () => {
  configureFacebookCredentials()
  const baseUrl = await startTestApp()

  const response = await fetch(`${baseUrl}/api/auth/facebook/code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil.example',
    },
    body: JSON.stringify({
      code: 'auth-code',
      redirectUri: 'http://localhost:5173/',
    }),
  })

  assert.equal(response.status, 403)
})
