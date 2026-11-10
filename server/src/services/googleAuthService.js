
import { OAuth2Client } from 'google-auth-library'
import { getDatabasePool } from '../config/database.js'
import {
  AuthenticationError,
  createSession,
} from './authSessionService.js'
import { resolveProviderUser } from './providerAccountService.js'

const googleClient = new OAuth2Client()

export { AuthenticationError }

function getClientId() {
  const clientId = process.env.GOOGLE_CLIENT_ID

  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured.')
  }

  return clientId
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

  const pool = getDatabasePool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    // Update the account that already holds this Google identity. A matching
    // email without the Google sub is never linked here: linking another
    // sign-in method requires an explicit re-authentication flow.
    const { user } = await resolveProviderUser(client, {
      column: 'google_sub',
      identifier: payload.sub,
      email: payload.email,
      displayName: payload.name,
      avatarUrl: payload.picture || null,
      language,
      request,
    })

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
