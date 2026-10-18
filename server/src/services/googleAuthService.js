
import { OAuth2Client } from 'google-auth-library'
import { getDatabasePool } from '../config/database.js'
import {
  AuthenticationError,
  createSession,
} from './authSessionService.js'

const googleClient = new OAuth2Client()

export { AuthenticationError }

function getClientId() {
  const clientId = process.env.GOOGLE_CLIENT_ID

  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured.')
  }

  return clientId
}

function normalizeLanguage(language) {
  return language === 'km' ? 'km' : 'en'
}

export async function signInWithGoogle(idToken, request, { language } = {}) {
  if (typeof idToken !== 'string' || !idToken.trim()) {
    throw new AuthenticationError('A Google ID token is required.')
  }

  let payload

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: getClientId(),
    })
    payload = ticket.getPayload()
  } catch {
    throw new AuthenticationError('Invalid or expired Google ID token.')
  }

  if (
    !payload?.sub ||
    !payload.email ||
    payload.email_verified !== true ||
    !['accounts.google.com', 'https://accounts.google.com'].includes(
      payload.iss,
    )
  ) {
    throw new AuthenticationError(
      'The Google account could not be verified.',
    )
  }

  const preferredLanguage = normalizeLanguage(language)
  const pool = getDatabasePool()
  const client = await pool.connect()
  const loginContext = [
    request.ip || null,
    (request.get('user-agent') || '').slice(0, 1000) || null,
  ]

  try {
    await client.query('BEGIN')

    // Update the account that already holds this Google identity. A matching
    // email without the Google sub is never linked here: linking another
    // sign-in method requires an explicit re-authentication flow.
    let userResult = await client.query(
      `UPDATE users
       SET email = $2,
           display_name = $3,
           avatar_url = $4,
           language = $5,
           last_login_at = NOW(),
           last_login_ip = $6,
           last_login_user_agent = $7,
           updated_at = NOW()
       WHERE google_sub = $1
       RETURNING id, email, display_name, avatar_url, language`,
      [
        payload.sub,
        payload.email,
        payload.name || payload.email,
        payload.picture || null,
        preferredLanguage,
        ...loginContext,
      ],
    )

    if (userResult.rowCount === 0) {
      const emailOwner = await client.query(
        'SELECT id FROM users WHERE email = $1',
        [payload.email],
      )

      if (emailOwner.rowCount > 0) {
        throw new AuthenticationError(
          'An account with this email already exists and is not linked to this Google sign-in. Sign in with the original method first to link it.',
        )
      }

      userResult = await client.query(
        `INSERT INTO users (
           google_sub, email, display_name, avatar_url, language,
           last_login_at, last_login_ip, last_login_user_agent
         )
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
         RETURNING id, email, display_name, avatar_url, language`,
        [
          payload.sub,
          payload.email,
          payload.name || payload.email,
          payload.picture || null,
          preferredLanguage,
          ...loginContext,
        ],
      )
    }

    const user = userResult.rows[0]

    await client.query(
      `INSERT INTO wallets (user_id, balance_minor, currency)
       VALUES ($1, 0, 'KHR')
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id],
    )

    const sessionToken = await createSession(
      client,
      user.id,
      request,
      'google_login',
    )

    await client.query('COMMIT')

    return {
      user,
      sessionToken,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
