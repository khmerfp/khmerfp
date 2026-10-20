import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { getDatabasePool } from '../config/database.js'
import {
  AuthenticationError,
  createSession,
} from './authSessionService.js'
import { recordAuthEventQuietly } from './authAuditService.js'
import { resolveProviderUser } from './providerAccountService.js'
import { sendSms } from './smsDeliveryService.js'

const OTP_LENGTH = 6
const OTP_TTL_MINUTES = Number(process.env.PHONE_OTP_TTL_MINUTES || 5)
const OTP_MAX_ATTEMPTS = Number(process.env.PHONE_OTP_MAX_ATTEMPTS || 5)

export { AuthenticationError }

export class PhoneOtpError extends Error {
  constructor(message = 'Phone verification failed.') {
    super(message)
    this.name = 'PhoneOtpError'
  }
}

// Keep a single canonical phone form so "+855 12 345 678" and "+85512345678"
// resolve to the same identity.
export function normalizePhoneNumber(value) {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/[^\d]/g, '')

  if (digits.length < 7 || digits.length > 15) return null

  // Require an explicit country code so numbers are unambiguous.
  if (!hasPlus) return null

  return `+${digits}`
}

export function hashOtpCode(code) {
  return createHash('sha256').update(String(code)).digest('hex')
}

// Hash a freshly generated code once; nothing about the code is stored in
// clear text.
function generateOtpCode(randomCode) {
  if (typeof randomCode === 'function') return String(randomCode())

  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0')
}

// Issue a one-time code for a phone number and deliver it over SMS.
export async function requestPhoneOtp(
  phoneNumber,
  request,
  { pool = getDatabasePool(), sendMessage = sendSms, randomCode } = {},
) {
  const normalized = normalizePhoneNumber(phoneNumber)

  if (!normalized) {
    throw new PhoneOtpError('Enter a valid phone number with a country code.')
  }

  const code = generateOtpCode(randomCode)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Invalidate any earlier unused codes for this number so only the newest
    // one can be redeemed.
    await client.query(
      `UPDATE phone_otps
       SET consumed_at = NOW()
       WHERE phone_number = $1 AND consumed_at IS NULL`,
      [normalized],
    )

    await client.query(
      `INSERT INTO phone_otps (phone_number, code_hash, expires_at, ip_address)
       VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 minute'), $4)`,
      [normalized, hashOtpCode(code), OTP_TTL_MINUTES, request.ip || null],
    )

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  // Audit outside the transaction so a shared test database is not held on the
  // audit table while the phone_otps rows are locked.
  recordAuthEventQuietly({
    eventType: 'phone_otp_requested',
    request,
    details: { phone_number: normalized },
  })

  const delivery = await sendMessage({
    to: normalized,
    message: `Your Angkor Payment verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
  })

  // Surface delivery problems to the caller without ever returning the code.
  if (!delivery.delivered && delivery.reason !== 'not_configured') {
    throw new PhoneOtpError('Could not send the verification code. Try again.')
  }

  return { phoneNumber: normalized, delivered: delivery.delivered }
}

// Redeem a code and return the account for this verified phone number,
// creating one on first use.
export async function verifyPhoneOtp(phoneNumber, code, request, { language } = {}) {
  const normalized = normalizePhoneNumber(phoneNumber)

  if (!normalized) {
    throw new PhoneOtpError('Enter a valid phone number with a country code.')
  }

  if (typeof code !== 'string' || !/^\d{4,8}$/.test(code.trim())) {
    throw new PhoneOtpError('Enter the verification code that was sent to you.')
  }

  const pool = getDatabasePool()
  const client = await pool.connect()
  let wrongAttemptId = null

  try {
    await client.query('BEGIN')

    // Lock the newest live code for this number so two concurrent attempts
    // cannot both redeem it.
    const otpResult = await client.query(
      `SELECT id, code_hash, attempts, expires_at
       FROM phone_otps
       WHERE phone_number = $1 AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [normalized],
    )

    const otp = otpResult.rows[0]

    if (!otp) {
      throw new PhoneOtpError('Request a new verification code.')
    }

    if (new Date(otp.expires_at) <= new Date()) {
      await client.query(
        'UPDATE phone_otps SET consumed_at = NOW() WHERE id = $1',
        [otp.id],
      )
      throw new PhoneOtpError('The verification code has expired.')
    }

    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      await client.query(
        'UPDATE phone_otps SET consumed_at = NOW() WHERE id = $1',
        [otp.id],
      )
      throw new PhoneOtpError('Too many attempts. Request a new code.')
    }

    const providedHash = Buffer.from(hashOtpCode(code.trim()), 'hex')
    const expectedHash = Buffer.from(otp.code_hash, 'hex')

    const matches =
      providedHash.length === expectedHash.length
      && timingSafeEqual(providedHash, expectedHash)

    if (!matches) {
      // Flag the attempt so the counter is incremented after the transaction
      // rolls back; otherwise the rollback would erase it and brute force
      // would never be limited.
      wrongAttemptId = otp.id
      throw new PhoneOtpError('The verification code is incorrect.')
    }

    await client.query(
      'UPDATE phone_otps SET consumed_at = NOW() WHERE id = $1',
      [otp.id],
    )

    const { user } = await resolveProviderUser(client, {
      column: 'phone_number',
      identifier: normalized,
      // Phone-only accounts still need a unique email; use a reserved,
      // non-routable placeholder derived from the number.
      email: `${normalized.replace(/[^\d]/g, '')}@phone.local`,
      displayName: normalized,
      language,
      request,
    })

    await client.query(
      `UPDATE users
       SET phone_verified_at = NOW(),
           last_login_at = NOW()
       WHERE id = $1`,
      [user.id],
    )

    const sessionToken = await createSession(
      client,
      user.id,
      request,
      'phone_login',
    )

    await client.query('COMMIT')

    recordAuthEventQuietly({
      userId: user.id,
      eventType: 'phone_verified',
      request,
      details: { phone_number: normalized },
    })

    return { user, sessionToken }
  } catch (error) {
    await client.query('ROLLBACK')

    if (wrongAttemptId !== null) {
      // Persist the failed attempt outside the aborted transaction.
      await pool
        .query('UPDATE phone_otps SET attempts = attempts + 1 WHERE id = $1', [
          wrongAttemptId,
        ])
        .catch(() => {})
    }

    throw error
  } finally {
    client.release()
  }
}
