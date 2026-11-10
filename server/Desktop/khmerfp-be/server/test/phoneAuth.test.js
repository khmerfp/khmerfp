import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { test } from 'node:test'
import { createApp } from '../src/app.js'
import {
  hashOtpCode,
  requestPhoneOtp,
  verifyPhoneOtp,
} from '../src/services/phoneAuthService.js'
import { normalizePhoneNumber } from '../src/services/phoneAuthService.js'
import {
  closeTestDatabaseConnection,
  hasTestDatabaseConfiguration,
  openTestDatabaseConnection,
} from '../test-support/testDatabase.js'

const hasTestDb = hasTestDatabaseConfiguration()
const skip = hasTestDb ? false : 'TEST_DATABASE_URL is not configured'

function uniquePhone() {
  // a valid E.164 number inside a reserved test range
  return `+1555${String(randomInt(0, 10_000_000)).padStart(7, '0')}`
}

function sessionRequest(userAgent = 'phone-test') {
  return {
    ip: '127.0.0.1',
    get: (name) => (name === 'user-agent' ? userAgent : undefined),
  }
}

async function startApp(appOptions = {}) {
  const server = createApp({ databaseIsReady: () => true, ...appOptions }).listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

test('phone OTP request and verify signs in and enforces one-time use', { skip }, async (t) => {
  const pool = await openTestDatabaseConnection()
  const phone = uniquePhone()
  const fixedCode = '424242'

  t.after(async () => {
    await pool.query('DELETE FROM users WHERE phone_number = $1', [phone])
    await pool.query('DELETE FROM phone_otps WHERE phone_number = $1', [phone])
    await pool.query(
      "DELETE FROM auth_audit_logs WHERE event_type IN ('phone_otp_requested', 'phone_verified', 'phone_otp_request_failed', 'phone_otp_verify_failed')",
    )
    await closeTestDatabaseConnection()
  })

  await t.test('request stores only a hash and delivers the code', async () => {
    const sent = []
    const result = await requestPhoneOtp(phone, sessionRequest(), {
      pool,
      randomCode: () => fixedCode,
      sendMessage: async ({ to, message }) => {
        sent.push({ to, message })
        return { delivered: true }
      },
    })

    assert.equal(result.phoneNumber, phone)
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, phone)
    assert.match(sent[0].message, new RegExp(fixedCode))

    const stored = await pool.query(
      `SELECT code_hash, consumed_at FROM phone_otps
       WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 1`,
      [phone],
    )
    assert.equal(stored.rows[0].code_hash, hashOtpCode(fixedCode))
    assert.equal(stored.rows[0].consumed_at, null)
  })

  await t.test('a wrong code is rejected and counted', async () => {
    await assert.rejects(
      () => verifyPhoneOtp(phone, '000000', sessionRequest()),
      /incorrect/,
    )

    const stored = await pool.query(
      `SELECT attempts FROM phone_otps
       WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 1`,
      [phone],
    )
    assert.equal(stored.rows[0].attempts, 1)
  })

  await t.test('the correct code creates an account and a session', async () => {
    const { user, sessionToken } = await verifyPhoneOtp(
      phone,
      fixedCode,
      sessionRequest(),
      { language: 'en' },
    )

    assert.equal(user.email, `${phone.replace(/[^\d]/g, '')}@phone.local`)
    assert.ok(sessionToken)

    const stored = await pool.query(
      'SELECT phone_verified_at FROM users WHERE id = $1',
      [user.id],
    )
    assert.ok(stored.rows[0].phone_verified_at)
  })

  await t.test('the same code cannot be redeemed twice', async () => {
    await assert.rejects(
      () => verifyPhoneOtp(phone, fixedCode, sessionRequest()),
      /Request a new verification code/,
    )
  })

  await t.test('sign-in again reuses the same account', async () => {
    await requestPhoneOtp(phone, sessionRequest(), {
      pool,
      randomCode: () => '515151',
      sendMessage: async () => ({ delivered: true }),
    })

    const { user } = await verifyPhoneOtp(phone, '515151', sessionRequest())

    const accounts = await pool.query(
      'SELECT count(*)::int AS count FROM users WHERE phone_number = $1',
      [phone],
    )
    assert.equal(accounts.rows[0].count, 1)

    const stored = await pool.query(
      'SELECT id FROM users WHERE phone_number = $1',
      [phone],
    )
    assert.equal(String(stored.rows[0].id), user.id)
  })
})

test('phone sign-in never auto-links an existing email account', { skip }, async (t) => {
  const pool = await openTestDatabaseConnection()
  const phone = uniquePhone()
  const placeholderEmail = `${phone.replace(/[^\d]/g, '')}@phone.local`

  // pre-create an email/password account that already owns the placeholder row
  await pool.query(
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, 'Existing', 'scrypt$16384$8$1$abc$def')`,
    [placeholderEmail],
  )

  t.after(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [placeholderEmail])
    await pool.query('DELETE FROM phone_otps WHERE phone_number = $1', [phone])
    await pool.query(
      "DELETE FROM auth_audit_logs WHERE event_type = 'phone_otp_requested'",
    )
    await closeTestDatabaseConnection()
  })

  await requestPhoneOtp(phone, sessionRequest(), {
    pool,
    randomCode: () => '777888',
    sendMessage: async () => ({ delivered: true }),
  })

  await assert.rejects(
    () => verifyPhoneOtp(phone, '777888', sessionRequest()),
    /already exists and is not linked/,
  )
})

test('phone endpoints validate input through the HTTP layer', { skip }, async (t) => {
  await openTestDatabaseConnection()

  t.after(async () => {
    await closeTestDatabaseConnection()
  })

  // the rate limiter is exercised by its own tests; a no-op keeps this
  // integration test from racing other files on auth_rate_limits
  const noopRateLimiter = (_request, _response, next) => next()
  const app = await startApp({ authRateLimiter: noopRateLimiter })

  t.after(async () => {
    await app.close()
  })

  const response = await fetch(`${app.baseUrl}/api/auth/phone/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
    },
    body: JSON.stringify({ phoneNumber: 'not-a-number' }),
  })

  assert.equal(response.status, 400)
  assert.match((await response.json()).message, /valid phone number/)
})

test('phone endpoints reject a disallowed origin', { skip }, async (t) => {
  const app = await startApp()
  t.after(async () => {
    await app.close()
  })

  const response = await fetch(`${app.baseUrl}/api/auth/phone/request`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://evil.example',
    },
    body: JSON.stringify({ phoneNumber: '+15550000000' }),
  })

  assert.equal(response.status, 403)
})

test('normalizePhoneNumber round-trips a reserved test number', () => {
  const phone = '+15550000000'
  assert.equal(normalizePhoneNumber(phone), phone)
})
