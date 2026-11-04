
import { OAuth2Client } from 'google-auth-library'
import { getDatabasePool } from '../config/database.js'
import {
  AuthenticationError,
  createSession,
} from './authSessionService.js'
import {
  linkProviderIdentity,
  resolveProviderUser,
} from './providerAccountService.js'

const googleClient = new OAuth2Client()

function elapsedMs(start) {
  return Math.round((performance.now() - start) * 10) / 10
}

async function measure(timings, key, operation) {
  const start = performance.now()

  try {
    return await operation()
  } finally {
    timings[key] = elapsedMs(start)
  }
}

// Durations and request ids are safe operational metadata. Never include the
// ID token, Google profile, email address, or session token in this record.
function logGoogleTiming(request, timings) {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'auth.google_timing',
      requestId: request?.requestId ?? null,
      ...timings,
    }),
  )
}

export { AuthenticationError }

function getClientId() {
  const clientId = process.env.GOOGLE_CLIENT_ID

  if (!clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured.')
  }

  return clientId
}

async function verifyGoogleIdentity(idToken) {
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
    !payload?.sub
    || !payload.email
    || payload.email_verified !== true
    || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)
  ) {
    throw new AuthenticationError('The Google account could not be verified.')
  }

  return payload
}

export async function linkGoogleAccount(idToken, user, request) {
  const payload = await verifyGoogleIdentity(idToken)

  if (payload.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new AuthenticationError(
      'Choose the Google account with the same email as your signed-in account.',
    )
  }

  const pool = getDatabasePool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    const linkedUser = await linkProviderIdentity(client, {
      userId: user.id,
      column: 'google_sub',
      identifier: payload.sub,
      eventType: 'google_linked',
      request,
    })
    await client.query('COMMIT')
    return linkedUser
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export async function signInWithGoogle(idToken, request, { language } = {}) {
  if (typeof idToken !== 'string' || !idToken.trim()) {
    throw new AuthenticationError('A Google ID token is required.')
  }

  const totalStart = performance.now()
  const timings = {}
  let payload
  let client = null
  let transactionOpen = false

  try {
    payload = await measure(timings, 'tokenVerificationMs', () =>
      verifyGoogleIdentity(idToken),
    )
  } catch {
    timings.totalMs = elapsedMs(totalStart)
    timings.failed = true
    logGoogleTiming(request, timings)
    throw new AuthenticationError('Invalid or expired Google ID token.')
  }

  const pool = getDatabasePool()

  try {
    client = await measure(timings, 'dbConnectMs', () => pool.connect())
    await measure(timings, 'beginMs', () => client.query('BEGIN'))
    transactionOpen = true

    // Update the account that already holds this Google identity. A matching
    // email without the Google sub is never linked here: linking another
    // sign-in method requires an explicit re-authentication flow.
    const { user } = await measure(timings, 'userResolveMs', () =>
      resolveProviderUser(client, {
        column: 'google_sub',
        identifier: payload.sub,
        email: payload.email,
        displayName: payload.name,
        avatarUrl: payload.picture || null,
        language,
        request,
      }),
    )

    const sessionToken = await measure(timings, 'sessionMs', () =>
      createSession(client, user.id, request, 'google_login'),
    )

    await measure(timings, 'commitMs', () => client.query('COMMIT'))
    transactionOpen = false
    timings.totalMs = elapsedMs(totalStart)
    logGoogleTiming(request, timings)

    return {
      user,
      sessionToken,
    }
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => {})
    }

    timings.totalMs = elapsedMs(totalStart)
    timings.failed = true
    logGoogleTiming(request, timings)
    throw error
  } finally {
    client?.release()
  }
}
