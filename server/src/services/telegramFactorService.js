import { createHmac, timingSafeEqual } from 'node:crypto'
import { getDatabasePool } from '../config/database.js'
import { recordAuthEvent } from './authAuditService.js'
import { createSession, getAuthenticatedUser } from './authSessionService.js'

const MAX_AUTH_AGE_SECONDS = 300
const MAX_CLOCK_SKEW_SECONDS = 60

export class FactorVerificationError extends Error {
  constructor(message = 'Telegram verification failed.') {
    super(message)
    this.name = 'FactorVerificationError'
  }
}

export function getTelegramBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured.')
  }

  return token
}

// Build the Telegram Login Widget HMAC over the sorted payload fields.
export function computeTelegramAuthHash(botToken, payload) {
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()

  const dataCheckString = Object.keys(payload)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('\n')

  return createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
}

// Verify a Telegram Login Widget payload: field shape, HMAC signature and
// auth_date freshness. Returns the stable Telegram id plus display fields.
export function verifyTelegramLogin(payload, { botToken, maxAgeSeconds = MAX_AUTH_AGE_SECONDS } = {}) {
  if (typeof payload !== 'object' || payload === null) {
    throw new FactorVerificationError('A Telegram login payload is required.')
  }

  const token = botToken || getTelegramBotToken()
  const { id, auth_date: authDate, hash } = payload

  const normalizedId = String(id ?? '')
  const normalizedAuthDate = Number(authDate)

  if (
    !/^\d{1,20}$/.test(normalizedId)
    || !Number.isFinite(normalizedAuthDate)
    || typeof hash !== 'string'
    || !/^[a-f0-9]{64}$/.test(hash)
  ) {
    throw new FactorVerificationError('The Telegram payload is malformed.')
  }

  const expectedHash = computeTelegramAuthHash(token, payload)

  const expectedBuffer = Buffer.from(expectedHash, 'hex')
  const providedBuffer = Buffer.from(hash, 'hex')

  if (
    expectedBuffer.length !== providedBuffer.length
    || !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new FactorVerificationError('The Telegram signature is invalid.')
  }

  const nowSeconds = Math.floor(Date.now() / 1000)

  if (
    normalizedAuthDate > nowSeconds + MAX_CLOCK_SKEW_SECONDS
    || normalizedAuthDate < nowSeconds - maxAgeSeconds
  ) {
    throw new FactorVerificationError('The Telegram login proof has expired.')
  }

  return {
    telegramId: normalizedId,
    displayName: typeof payload.first_name === 'string' && payload.first_name
      ? payload.first_name
      : null,
    username: typeof payload.username === 'string' && payload.username
      ? payload.username
      : null,
  }
}

// Read the enrollment state of the signed-in user's Telegram factor.
export async function getFactorStatus(userId, pool = getDatabasePool()) {
  const result = await pool.query(
    `SELECT identifier, verified_at
     FROM user_factors
     WHERE user_id = $1 AND factor_type = 'telegram'
     ORDER BY verified_at DESC NULLS LAST
     LIMIT 1`,
    [userId],
  )

  const row = result.rows[0]

  return {
    telegram: row
      ? {
          enrolled: Boolean(row.verified_at),
          identifier: row.identifier,
          verifiedAt: row.verified_at,
        }
      : { enrolled: false, identifier: null, verifiedAt: null },
  }
}

// Store the verified Telegram identifier for the signed-in user.
export async function enrollTelegramFactor(user, payload, request, pool = getDatabasePool()) {
  const verified = verifyTelegramLogin(payload)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO user_factors (user_id, factor_type, identifier, verified_at)
       VALUES ($1, 'telegram', $2, NOW())
       ON CONFLICT (user_id, factor_type, identifier)
         DO UPDATE SET verified_at = NOW()`,
      [user.id, verified.telegramId],
    )

    await recordAuthEvent(
      {
        userId: user.id,
        eventType: 'factor_enrolled',
        request,
        details: { factor_type: 'telegram', identifier: verified.telegramId },
      },
      client,
    )

    await client.query('COMMIT')

    return verified
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Confirm the Telegram factor right before a sensitive action and rotate the
// session token so the step-up proof is bound to a fresh credential.
export async function stepUpWithTelegram(user, request, payload, pool = getDatabasePool()) {
  const verified = verifyTelegramLogin(payload)
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const factorResult = await client.query(
      `SELECT id FROM user_factors
       WHERE user_id = $1 AND factor_type = 'telegram' AND identifier = $2
         AND verified_at IS NOT NULL`,
      [user.id, verified.telegramId],
    )

    if (factorResult.rowCount === 0) {
      throw new FactorVerificationError(
        'This Telegram account is not linked to your user.',
      )
    }

    const sessionToken = await createSession(
      client,
      user.id,
      request,
      'step_up',
      { revokePrevious: true, stepUp: true },
    )

    await client.query('COMMIT')

    return { sessionToken, verified }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Guard for money-moving routes: the signed-in user must have a verified
// Telegram factor before the first deposit can proceed. Resolves the session
// user itself so payment routes can mount it without an extra auth step.
export async function requireVerifiedFactor(request, response, next) {
  try {
    const user = request.authUser || await getAuthenticatedUser(request)

    if (!user) {
      response.status(401).json({ message: 'Authentication required.' })
      return
    }

    request.authUser = user

    const status = await getFactorStatus(user.id)

    if (!status.telegram.enrolled) {
      response.status(403).json({
        message: 'Verify your Telegram account before moving money.',
      })
      return
    }

    next()
  } catch (error) {
    next(error)
  }
}
