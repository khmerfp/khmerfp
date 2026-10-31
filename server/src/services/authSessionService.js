import { createHash, randomBytes } from 'node:crypto'
import { getDatabasePool } from '../config/database.js'

const IDLE_TIMEOUT_MINUTES = Number(
  process.env.SESSION_IDLE_TIMEOUT_MINUTES || 30,
)
const ABSOLUTE_TIMEOUT_DAYS = Number(
  process.env.SESSION_ABSOLUTE_TIMEOUT_DAYS || 7,
)

export class AuthenticationError extends Error {
  constructor(message = 'Authentication failed.') {
    super(message)
    this.name = 'AuthenticationError'
  }
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function getSessionCookieName() {
  return process.env.NODE_ENV === 'production'
    ? '__Host-angkor_session'
    : 'angkor_session'
}

function cookieOptions(maxAgeSeconds) {
  const isProduction = process.env.NODE_ENV === 'production'
  const parts = [
    `${getSessionCookieName()}=`,
    'Path=/',
    'HttpOnly',
    isProduction ? 'SameSite=None' : 'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]

  if (isProduction) {
    parts.push('Secure')
  }

  return parts
}

export function createSessionCookie(token) {
  const maxAgeSeconds = ABSOLUTE_TIMEOUT_DAYS * 24 * 60 * 60
  const options = cookieOptions(maxAgeSeconds)
  options[0] = `${getSessionCookieName()}=${token}`
  return options.join('; ')
}

export function clearSessionCookie() {
  const options = cookieOptions(0)
  options[0] = `${getSessionCookieName()}=`
  options.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  return options.join('; ')
}

export function readSessionToken(request) {
  const cookieHeader = request.headers.cookie || ''
  const cookieName = getSessionCookieName()

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')

    if (separator < 0) continue

    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()

    if (name === cookieName && value) {
      return value
    }
  }

  return null
}

// Persist one session and its audit record inside an open transaction.
// With revokePrevious the caller's current session row is revoked first, so
// step-up rotation never leaves the old token usable.
export async function createSession(
  client,
  userId,
  request,
  eventType,
  { revokePrevious = false, stepUp = false } = {},
) {
  const sessionToken = randomBytes(32).toString('base64url')
  const sessionHash = hashSessionToken(sessionToken)

  if (revokePrevious) {
    const previousToken = readSessionToken(request)

    if (previousToken) {
      await client.query(
        `UPDATE sessions
         SET revoked_at = NOW()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashSessionToken(previousToken)],
      )
    }
  }

  // Insert the session and its audit record in one round trip. The audit CTE
  // reads the inserted session row, so it cannot run before the insert.
  await client.query(
    `WITH created AS (
       INSERT INTO sessions (
         token_hash, user_id, idle_expires_at, expires_at, step_up_at,
         ip_address, user_agent
       )
       VALUES (
         $1, $2,
         NOW() + ($3 * INTERVAL '1 minute'),
         NOW() + ($4 * INTERVAL '1 day'),
         $5, $6, $7
       )
       RETURNING user_id
     )
     INSERT INTO auth_audit_logs (
       user_id, event_type, ip_address, user_agent
     )
     SELECT user_id, $8, $6, $7 FROM created`,
    [
      sessionHash,
      userId,
      IDLE_TIMEOUT_MINUTES,
      ABSOLUTE_TIMEOUT_DAYS,
      stepUp ? new Date() : null,
      request.ip || null,
      (request.get('user-agent') || '').slice(0, 1000) || null,
      eventType,
    ],
  )

  return sessionToken
}

export async function getAuthenticatedUser(request) {
  const token = readSessionToken(request)

  if (!token) return null

  const sessionHash = hashSessionToken(token)
  const pool = getDatabasePool()

  const result = await pool.query(
    `UPDATE sessions
     SET last_seen_at = NOW(),
         idle_expires_at = LEAST(
           NOW() + ($2 * INTERVAL '1 minute'),
           expires_at
         )
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND idle_expires_at > NOW()
       AND expires_at > NOW()
     RETURNING user_id`,
    [sessionHash, IDLE_TIMEOUT_MINUTES],
  )

  if (result.rowCount === 0) return null

  const userResult = await pool.query(
    `SELECT id, email, display_name, avatar_url, language
     FROM users
     WHERE id = $1`,
    [result.rows[0].user_id],
  )

  return userResult.rows[0] || null
}

export async function revokeCurrentSession(request) {
  const token = readSessionToken(request)
  if (!token) return

  const pool = getDatabasePool()

  await pool.query(
    `UPDATE sessions
     SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashSessionToken(token)],
  )
}

export async function revokeAllUserSessions(userId) {
  const pool = getDatabasePool()

  await pool.query(
    `UPDATE sessions
     SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  )
}
