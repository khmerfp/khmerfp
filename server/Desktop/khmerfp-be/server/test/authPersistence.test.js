import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import { createSession, hashSessionToken } from '../src/services/authSessionService.js'
import { computeTelegramAuthHash } from '../src/services/telegramFactorService.js'
import {
  closeTestDatabaseConnection,
  hasTestDatabaseConfiguration,
  openTestDatabaseConnection,
} from '../test-support/testDatabase.js'

const hasTestDb = hasTestDatabaseConfiguration()
const skip = hasTestDb ? false : 'TEST_DATABASE_URL is not configured'

function uniqueSuffix() {
  return `${randomInt(1_000_000, 10_000_000)}${randomInt(1_000_000, 10_000_000)}`
}

async function startApp(appOptions = {}) {
  const server = createApp({ databaseIsReady: () => true, ...appOptions }).listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function sessionRequest(userAgent = 'persistence-test') {
  return { ip: '127.0.0.1', get: (name) => (name === 'user-agent' ? userAgent : undefined) }
}

test(
  'session ownership, rate limiting, step-up rotation and audits',
  { skip },
  async (t) => {
    const pool = await openTestDatabaseConnection()
    const suffix = uniqueSuffix()
    const emailA = `owner-a-${suffix}@example.com`
    const emailB = `owner-b-${suffix}@example.com`
    const previousGoogleClientId = process.env.GOOGLE_CLIENT_ID
    const previousTelegramToken = process.env.TELEGRAM_BOT_TOKEN
    const previousTelegramUsername = process.env.TELEGRAM_BOT_USERNAME
    const previousMaxRequests = process.env.AUTH_RATE_LIMIT_MAX_REQUESTS

    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
    process.env.TELEGRAM_BOT_TOKEN = `123456:test-token-${suffix}`
    process.env.TELEGRAM_BOT_USERNAME = `test_bot_${suffix}`
    process.env.AUTH_RATE_LIMIT_MAX_REQUESTS = '3'

    let app

    t.after(async () => {
      await pool.query('DELETE FROM users WHERE email = ANY($1)', [[emailA, emailB]])
      await pool.query(
        "DELETE FROM auth_audit_logs WHERE event_type IN ('google_login_failed', 'factor_enrolled', 'step_up', 'auth_rate_limited', 'origin_blocked')",
      )
      await pool.query("DELETE FROM auth_rate_limits WHERE rate_limit_key LIKE 'auth:%'")
      await closeTestDatabaseConnection()

      delete process.env.__TEST_ENROLLED_TOKEN
      delete process.env.__TEST_ROTATED_TOKEN
      delete process.env.__TEST_TELEGRAM_ID
      process.env.GOOGLE_CLIENT_ID = previousGoogleClientId
      process.env.TELEGRAM_BOT_TOKEN = previousTelegramToken
      process.env.TELEGRAM_BOT_USERNAME = previousTelegramUsername
      process.env.AUTH_RATE_LIMIT_MAX_REQUESTS = previousMaxRequests

      if (app) await app.close()
    })

    const userA = (
      await pool.query(
        `INSERT INTO users (google_sub, email, display_name)
         VALUES ($1, $2, 'Owner A')
         RETURNING id, email, display_name, avatar_url, language`,
        [`sub-a-${suffix}`, emailA],
      )
    ).rows[0]

    const userB = (
      await pool.query(
        `INSERT INTO users (google_sub, email, display_name)
         VALUES ($1, $2, 'Owner B')
         RETURNING id`,
        [`sub-b-${suffix}`, emailB],
      )
    ).rows[0]

    const tokenA = await createSession(pool, userA.id, sessionRequest(), 'google_login')

    await t.test('me returns only the session user and ignores id parameters', async () => {
      app = await startApp()

      const response = await fetch(
        `${app.baseUrl}/api/auth/me?user_id=${userB.id}&market_id=${userB.id}`,
        { headers: { Cookie: `angkor_session=${tokenA}` } },
      )

      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.user.id, String(userA.id))
      assert.equal(body.user.email, emailA)
    })

    await t.test('a revoked session is rejected', async () => {
      await pool.query(
        'UPDATE sessions SET revoked_at = NOW() WHERE token_hash = $1',
        [hashSessionToken(tokenA)],
      )

      const response = await fetch(`${app.baseUrl}/api/auth/me`, {
        headers: { Cookie: `angkor_session=${tokenA}` },
      })

      assert.equal(response.status, 401)
    })

    await t.test('a forged session token is rejected', async () => {
      const response = await fetch(`${app.baseUrl}/api/auth/me`, {
        headers: { Cookie: `angkor_session=definitely-not-a-real-token-${suffix}` },
      })

      assert.equal(response.status, 401)
    })

    await t.test('failed google logins are audited with a null user', async () => {
      const response = await fetch(`${app.baseUrl}/api/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
        },
        body: JSON.stringify({ credential: 'not-a-jwt' }),
      })

      assert.equal(response.status, 401)

      const audit = await pool.query(
        `SELECT user_id, details
         FROM auth_audit_logs
         WHERE event_type = 'google_login_failed'
         ORDER BY created_at DESC
         LIMIT 1`,
      )

      assert.equal(audit.rows[0].user_id, null)
      assert.match(audit.rows[0].details.reason, /Invalid or expired/)
    })

    await t.test('auth endpoints return 429 once the postgres rate limit is exceeded', async () => {
      let lastStatus

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await fetch(`${app.baseUrl}/api/auth/google`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://localhost:5173',
          },
          body: JSON.stringify({ credential: 'not-a-jwt' }),
        })

        lastStatus = response.status
      }

      assert.equal(lastStatus, 429)

      const limited = await pool.query(
        `SELECT request_count FROM auth_rate_limits
         WHERE rate_limit_key LIKE 'auth:POST:/api/auth/google:%'`,
      )
      assert.ok(limited.rows[0])

      // release the test ip so the remaining subtests can reach the routes
      await pool.query("DELETE FROM auth_rate_limits WHERE rate_limit_key LIKE 'auth:%'")
    })

    await t.test('telegram enrollment stores the factor and writes an audit row', async () => {
      const telegramId = String(900000000 + randomInt(1, 99999))
      const authDate = Math.floor(Date.now() / 1000) - 10
      const payload = {
        id: telegramId,
        first_name: 'Step',
        auth_date: authDate,
      }
      payload.hash = computeTelegramAuthHash(process.env.TELEGRAM_BOT_TOKEN, payload)

      // rotate in a fresh session for user A after the earlier revoke
      const freshToken = await createSession(pool, userA.id, sessionRequest(), 'google_login')

      const response = await fetch(`${app.baseUrl}/api/auth/factors/telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
          Cookie: `angkor_session=${freshToken}`,
        },
        body: JSON.stringify(payload),
      })

      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.factors.telegram.enrolled, true)
      assert.equal(body.factors.telegram.identifier, telegramId)

      const audit = await pool.query(
        `SELECT user_id FROM auth_audit_logs
         WHERE event_type = 'factor_enrolled' AND user_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [userA.id],
      )
      assert.equal(audit.rows[0].user_id, userA.id)

      // keep the fresh token for the step-up test below
      process.env.__TEST_ENROLLED_TOKEN = freshToken
      process.env.__TEST_TELEGRAM_ID = telegramId
    })

    await t.test('step-up verifies the factor and rotates the session token', async () => {
      const enrolledToken = process.env.__TEST_ENROLLED_TOKEN
      const telegramId = process.env.__TEST_TELEGRAM_ID
      const authDate = Math.floor(Date.now() / 1000) - 5
      const payload = { id: telegramId, first_name: 'Step', auth_date: authDate }
      payload.hash = computeTelegramAuthHash(process.env.TELEGRAM_BOT_TOKEN, payload)

      const response = await fetch(`${app.baseUrl}/api/auth/step-up`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
          Cookie: `angkor_session=${enrolledToken}`,
        },
        body: JSON.stringify(payload),
      })

      assert.equal(response.status, 200)

      const setCookie = response.headers.get('set-cookie') || ''
      assert.match(setCookie, /angkor_session=/)
      assert.match(setCookie, /HttpOnly/)
      assert.match(setCookie, /SameSite=Lax/)

      const rotatedToken = setCookie.match(/angkor_session=([^;]+)/)[1]
      assert.notEqual(rotatedToken, enrolledToken)
      process.env.__TEST_ROTATED_TOKEN = rotatedToken

      // the old token must be dead and the new one alive
      const oldResponse = await fetch(`${app.baseUrl}/api/auth/me`, {
        headers: { Cookie: `angkor_session=${enrolledToken}` },
      })
      assert.equal(oldResponse.status, 401)

      const newResponse = await fetch(`${app.baseUrl}/api/auth/me`, {
        headers: { Cookie: `angkor_session=${rotatedToken}` },
      })
      assert.equal(newResponse.status, 200)
      assert.equal((await newResponse.json()).user.id, String(userA.id))

      const stepUpSession = await pool.query(
        'SELECT step_up_at FROM sessions WHERE token_hash = $1',
        [hashSessionToken(rotatedToken)],
      )
      assert.ok(stepUpSession.rows[0].step_up_at)

      const audit = await pool.query(
        `SELECT user_id FROM auth_audit_logs
         WHERE event_type = 'step_up' AND user_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [userA.id],
      )
      assert.equal(audit.rows[0].user_id, userA.id)
    })

    await t.test('logout-all revokes every session for the user', async () => {
      const lastToken = process.env.__TEST_ROTATED_TOKEN

      const response = await fetch(`${app.baseUrl}/api/auth/logout-all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:5173',
          Cookie: `angkor_session=${lastToken}`,
        },
      })

      assert.equal(response.status, 200)

      const active = await pool.query(
        'SELECT count(*)::int AS count FROM sessions WHERE user_id = $1 AND revoked_at IS NULL',
        [userA.id],
      )
      assert.equal(active.rows[0].count, 0)
    })
  },
)

test('checkout preparation requires a verified Telegram factor', { skip }, async (t) => {
  const pool = await openTestDatabaseConnection()
  const suffix = uniqueSuffix()
  const email = `checkout-gate-${suffix}@example.com`
  const previousTelegramToken = process.env.TELEGRAM_BOT_TOKEN

  process.env.TELEGRAM_BOT_TOKEN = `123456:test-token-${suffix}`

  const checkoutFixture = {
    environment: 'sandbox',
    action: 'https://checkout-sandbox.payway.com.kh/api/payment-gateway/v1/payments/purchase',
    method: 'POST',
    fields: { tran_id: `gate-${suffix}`, amount: '1', currency: 'KHR' },
    transaction: { tranId: `gate-${suffix}`, amount: 1, currency: 'KHR', status: 'PENDING' },
    statusAccess: { tranId: `gate-${suffix}`, token: `token-${suffix}` },
  }

  let app

  t.after(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [email])
    await pool.query(
      "DELETE FROM auth_audit_logs WHERE event_type IN ('google_login', 'factor_enrolled')",
    )
    await pool.query("DELETE FROM auth_rate_limits WHERE rate_limit_key LIKE 'auth:%'")
    await closeTestDatabaseConnection()
    process.env.TELEGRAM_BOT_TOKEN = previousTelegramToken

    if (app) await app.close()
  })

  const user = (
    await pool.query(
      `INSERT INTO users (google_sub, email, display_name)
       VALUES ($1, $2, 'Gate User')
       RETURNING id`,
      [`sub-gate-${suffix}`, email],
    )
  ).rows[0]

  const sessionToken = await createSession(pool, user.id, sessionRequest(), 'google_login')

  const prepareCheckout = (cookie) =>
    fetch(`${app.baseUrl}/api/payments/checkout/prepare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: `angkor_session=${cookie}` } : {}),
      },
      body: JSON.stringify({ name: 'Gate User', accountNumber: '0001', amount: 1 }),
    })

  app = await startApp({
    checkoutPreparation: async () => checkoutFixture,
  })

  await t.test('an anonymous checkout is rejected with 401', async () => {
    const response = await prepareCheckout(null)

    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { message: 'Authentication required.' })
  })

  await t.test('a signed-in user without the factor is rejected with 403', async () => {
    const response = await prepareCheckout(sessionToken)

    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), {
      message: 'Verify your Telegram account before moving money.',
    })
  })

  await t.test('checkout succeeds once the Telegram factor is enrolled', async () => {
    const telegramId = String(800000000 + randomInt(1, 99999))
    const authDate = Math.floor(Date.now() / 1000) - 10
    const payload = { id: telegramId, first_name: 'Gate', auth_date: authDate }
    payload.hash = computeTelegramAuthHash(process.env.TELEGRAM_BOT_TOKEN, payload)

    const enroll = await fetch(`${app.baseUrl}/api/auth/factors/telegram`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        Cookie: `angkor_session=${sessionToken}`,
      },
      body: JSON.stringify(payload),
    })
    assert.equal(enroll.status, 200)

    const response = await prepareCheckout(sessionToken)

    assert.equal(response.status, 201)
    const body = await response.json()
    assert.deepEqual(body.checkout, checkoutFixture)
  })
})

test('email/password register and login issue sessions', { skip }, async (t) => {
  const pool = await openTestDatabaseConnection()
  const suffix = uniqueSuffix()
  const email = `email-user-${suffix}@example.com`
  const password = `correct-horse-${suffix}`
  const previousMaxRequests = process.env.AUTH_RATE_LIMIT_MAX_REQUESTS

  process.env.AUTH_RATE_LIMIT_MAX_REQUESTS = '50'

  let app

  t.after(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [email])
    await pool.query(
      "DELETE FROM auth_audit_logs WHERE event_type IN ('email_login_failed', 'email_register_failed', 'email_login', 'email_register')",
    )
    await pool.query("DELETE FROM auth_rate_limits WHERE rate_limit_key LIKE 'auth:%'")
    await closeTestDatabaseConnection()
    process.env.AUTH_RATE_LIMIT_MAX_REQUESTS = previousMaxRequests

    if (app) await app.close()
  })

  app = await startApp()

  const register = async (body) =>
    fetch(`${app.baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify(body),
    })

  const login = async (body) =>
    fetch(`${app.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
      },
      body: JSON.stringify(body),
    })

  await t.test('register creates an account and returns a session cookie', async () => {
    const response = await register({ email, password })

    assert.equal(response.status, 201)
    const body = await response.json()
    assert.equal(body.user.email, email)

    const setCookie = response.headers.get('set-cookie') || ''
    assert.match(setCookie, /angkor_session=/)
    assert.match(setCookie, /HttpOnly/)

    const stored = await pool.query(
      'SELECT password_hash FROM users WHERE email = $1',
      [email],
    )
    assert.ok(stored.rows[0].password_hash)
    assert.notEqual(stored.rows[0].password_hash, password)
  })

  await t.test('register rejects a duplicate email with 409', async () => {
    const response = await register({ email, password })
    assert.equal(response.status, 409)
  })

  await t.test('login succeeds with the correct credentials', async () => {
    const response = await login({ email, password })

    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.user.email, email)

    const setCookie = response.headers.get('set-cookie') || ''
    assert.match(setCookie, /angkor_session=/)
  })

  await t.test('login fails with a wrong password', async () => {
    const response = await login({ email, password: 'definitely-wrong' })

    assert.equal(response.status, 401)
    const body = await response.json()
    assert.equal(body.message, 'Incorrect email or password. Please try again.')
  })

  await t.test('login fails for an unknown email', async () => {
    const response = await login({
      email: `nobody-${suffix}@example.com`,
      password,
    })

    assert.equal(response.status, 401)
  })

  await t.test('login fails when the account has no password (google-only)', async () => {
    const googleOnlyEmail = `google-only-${suffix}@example.com`
    await pool.query(
      `INSERT INTO users (google_sub, email, display_name)
       VALUES ($1, $2, 'Google Only')`,
      [`sub-${suffix}`, googleOnlyEmail],
    )

    const response = await login({
      email: googleOnlyEmail,
      password: 'whatever123',
    })

    assert.equal(response.status, 401)
  })

  await t.test('register rejects a weak password with 400', async () => {
    const response = await register({
      email: `weak-${suffix}@example.com`,
      password: 'short',
    })

    assert.equal(response.status, 400)
  })
})
