import { getDatabasePool } from '../config/database.js'
import {
  AuthenticationError,
  createSession,
} from './authSessionService.js'
import {
  PasswordPolicyError,
  assertPasswordPolicy,
  hashPassword,
  verifyPassword,
} from './passwordService.js'

export { AuthenticationError, PasswordPolicyError }

// A single generic message is used for every failed sign-in so the response
// never reveals whether an account exists.
const INVALID_CREDENTIALS_MESSAGE =
  'Incorrect email or password. Please try again.'

const EMAIL_MAX_LENGTH = 320
const DISPLAY_NAME_MAX_LENGTH = 255

function normalizeEmail(email) {
  if (typeof email !== 'string') return null

  const trimmed = email.trim().toLowerCase()

  if (!trimmed || trimmed.length > EMAIL_MAX_LENGTH) return null

  // Conservative check: something@something.tld with no spaces.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null

  return trimmed
}

function normalizeLanguage(language) {
  return language === 'km' ? 'km' : 'en'
}

function defaultDisplayName(email) {
  const localPart = email.split('@')[0]

  return localPart.slice(0, DISPLAY_NAME_MAX_LENGTH) || email
}

function buildLoginContext(request) {
  return [
    request.ip || null,
    (request.get('user-agent') || '').slice(0, 1000) || null,
  ]
}

async function loadUserForEmail(client, email) {
  const result = await client.query(
    `SELECT id, email, display_name, avatar_url, language, password_hash
     FROM users
     WHERE email = $1`,
    [email],
  )

  return result.rows[0] || null
}

async function ensureWallet(client, userId) {
  await client.query(
    `INSERT INTO wallets (user_id, balance_minor, currency)
     VALUES ($1, 0, 'KHR')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  )
}

// Sign in with an email and password that were registered with this app.
export async function signInWithEmail(
  email,
  password,
  request,
  { language } = {},
) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    throw new AuthenticationError(INVALID_CREDENTIALS_MESSAGE)
  }

  if (typeof password !== 'string' || !password) {
    throw new AuthenticationError(INVALID_CREDENTIALS_MESSAGE)
  }

  const pool = getDatabasePool()
  const client = await pool.connect()
  const loginContext = buildLoginContext(request)
  const preferredLanguage = normalizeLanguage(language)

  try {
    await client.query('BEGIN')

    const user = await loadUserForEmail(client, normalizedEmail)

    // Treat a missing account and a Google-only account the same way.
    if (!user || !user.password_hash) {
      await client.query('ROLLBACK')
      throw new AuthenticationError(INVALID_CREDENTIALS_MESSAGE)
    }

    const passwordMatches = await verifyPassword(password, user.password_hash)

    if (!passwordMatches) {
      await client.query('ROLLBACK')
      throw new AuthenticationError(INVALID_CREDENTIALS_MESSAGE)
    }

    const updated = await client.query(
      `UPDATE users
       SET language = COALESCE($2, language),
           last_login_at = NOW(),
           last_login_ip = $3,
           last_login_user_agent = $4,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, display_name, avatar_url, language`,
      [user.id, preferredLanguage, ...loginContext],
    )

    const safeUser = updated.rows[0]

    await ensureWallet(client, safeUser.id)

    const sessionToken = await createSession(
      client,
      safeUser.id,
      request,
      'email_login',
    )

    await client.query('COMMIT')

    return {
      user: safeUser,
      sessionToken,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

// Register a new email/password account and start a session immediately.
export async function registerWithEmail(
  email,
  password,
  displayName,
  request,
  { language } = {},
) {
  const normalizedEmail = normalizeEmail(email)

  if (!normalizedEmail) {
    throw new AuthenticationError('Enter a valid email address.')
  }

  assertPasswordPolicy(password)

  const name =
    typeof displayName === 'string' && displayName.trim()
      ? displayName.trim().slice(0, DISPLAY_NAME_MAX_LENGTH)
      : defaultDisplayName(normalizedEmail)

  const pool = getDatabasePool()
  const client = await pool.connect()
  const loginContext = buildLoginContext(request)
  const preferredLanguage = normalizeLanguage(language)

  try {
    await client.query('BEGIN')

    const passwordHash = await hashPassword(password)

    const existing = await client.query(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [normalizedEmail],
    )

    // The email is taken. If it already has a password the user should sign
    // in instead; if it is a Google-only account, they must link through
    // Google rather than this form.
    if (existing.rowCount > 0) {
      throw new AuthenticationError(
        'An account with this email already exists. Sign in instead.',
      )
    }

    const inserted = await client.query(
      `INSERT INTO users (
         password_hash, email, display_name, language,
         last_login_at, last_login_ip, last_login_user_agent
       )
       VALUES ($1, $2, $3, $4, NOW(), $5, $6)
       RETURNING id, email, display_name, avatar_url, language`,
      [
        passwordHash,
        normalizedEmail,
        name,
        preferredLanguage,
        ...loginContext,
      ],
    )

    const safeUser = inserted.rows[0]

    await ensureWallet(client, safeUser.id)

    const sessionToken = await createSession(
      client,
      safeUser.id,
      request,
      'email_register',
    )

    await client.query('COMMIT')

    return {
      user: safeUser,
      sessionToken,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
