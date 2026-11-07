import { OAuth2Client } from 'google-auth-library'
import { getDatabasePool } from '../config/database.js'
import { operationalLogger } from '../logging/operationalLogger.js'
import {
  AuthenticationError,
  createSession,
} from './authSessionService.js'
import {
  linkProviderIdentity,
  resolveProviderUser,
} from './providerAccountService.js'

const googleClient = new OAuth2Client()

// A cold serverless instance has to download Google's signing keys before it
// can verify the first token. Bound that wait so a slow key fetch cannot hold
// the request open until the hosting proxy times out with a non-JSON error.
const VERIFY_TIMEOUT_MS = 10000

// Network failures while fetching Google's keys are transient and retryable;
// they must not be reported to the browser as an invalid credential.
const TRANSIENT_ERROR_CODES = new Set([
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
])

const MAX_SIGN_IN_ATTEMPTS = 2

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

// The server is missing its Google client id. This is a deployment problem,
// not a bad user credential, so it maps to a 503 instead of a 401.
export class GoogleAuthConfigurationError extends Error {
  constructor(message = 'Google sign-in is not configured on this server.') {
    super(message)
    this.name = 'GoogleAuthConfigurationError'
  }
}

// Google's verification endpoint or key set could not be reached. The user can
// safely retry, so this maps to a 503 instead of an authentication failure.
export class GoogleAuthUnavailableError extends Error {
  constructor(
    message = 'Google sign-in is temporarily unavailable. Please try again.',
  ) {
    super(message)
    this.name = 'GoogleAuthUnavailableError'
  }
}

function getClientId() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim()

  if (!clientId) {
    throw new GoogleAuthConfigurationError()
  }

  return clientId
}

function isTransientVerificationError(error) {
  if (!error) return false

  if (TRANSIENT_ERROR_CODES.has(error.code)) return true

  const message = typeof error.message === 'string' ? error.message : ''

  return /network|fetch|timeout|timed out|socket|getaddrinfo|temporar/i.test(
    message,
  )
}

function verifyIdTokenWithTimeout(idToken, audience) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('Google token verification timed out.')
      error.code = 'ETIMEDOUT'
      reject(error)
    }, VERIFY_TIMEOUT_MS)

    googleClient.verifyIdToken({ idToken, audience }).then(
      (ticket) => {
        clearTimeout(timer)
        resolve(ticket)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function logVerificationFailure(request, error, reason) {
  operationalLogger.warn('google.token_verification_failed', {
    requestId: request?.requestId,
    errorName: typeof error?.name === 'string' ? error.name : undefined,
    errorCode: typeof error?.code === 'string' ? error.code : undefined,
    reason,
  })
}

// Verify a Google ID token and return a normalized, trusted payload. Shared by
// both sign-in and explicit account linking so both paths enforce the same
// checks and the same retryable/configuration error mapping.
async function verifyGoogleIdentity(idToken, request) {
  if (typeof idToken !== 'string' || !idToken.trim()) {
    throw new AuthenticationError('A Google ID token is required.')
  }

  const audience = getClientId()

  let payload

  try {
    const ticket = await verifyIdTokenWithTimeout(
      idToken.trim(),
      audience,
    )
    payload = ticket.getPayload()
  } catch (error) {
    const transient = isTransientVerificationError(error)

    logVerificationFailure(
      request,
      error,
      transient ? 'verification_unavailable' : 'invalid_token',
    )

    if (transient) {
      throw new GoogleAuthUnavailableError()
    }

    throw new AuthenticationError('Invalid or expired Google ID token.')
  }

  if (
    !payload?.sub ||
    typeof payload.email !== 'string' ||
    !payload.email.trim() ||
    payload.email_verified !== true ||
    !['accounts.google.com', 'https://accounts.google.com'].includes(
      payload.iss,
    )
  ) {
    logVerificationFailure(request, null, 'unverified_profile')

    throw new AuthenticationError(
      'The Google account could not be verified.',
    )
  }

  return {
    ...payload,
    email: payload.email.trim().toLowerCase(),
  }
}

export async function linkGoogleAccount(idToken, user, request) {
  const payload = await verifyGoogleIdentity(idToken, request)

  if (
    typeof user?.email !== 'string'
    || payload.email !== user.email.toLowerCase()
  ) {
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

async function persistGoogleSignIn(payload, request, language, timings = {}) {
  const pool = getDatabasePool()
  const client = await measure(timings, 'dbConnectMs', () => pool.connect())

  try {
    await measure(timings, 'beginMs', () => client.query('BEGIN'))

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

    return {
      user,
      sessionToken,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

function retryDelayMs() {
  return 25 + Math.floor(Math.random() * 75)
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function signInWithGoogle(idToken, request, { language } = {}) {
  const totalStart = performance.now()
  const timings = {}

  let payload

  try {
    payload = await measure(timings, 'tokenVerificationMs', () =>
      verifyGoogleIdentity(idToken, request),
    )
  } catch (error) {
    timings.totalMs = elapsedMs(totalStart)
    timings.failed = true
    logGoogleTiming(request, timings)

    // Preserve the specific error type so the route can return 401 for a bad
    // credential and 503 for a missing configuration or transient outage.
    throw error
  }

  let lastError

  for (let attempt = 1; attempt <= MAX_SIGN_IN_ATTEMPTS; attempt += 1) {
    try {
      const result = await persistGoogleSignIn(
        payload,
        request,
        language,
        timings,
      )

      timings.totalMs = elapsedMs(totalStart)
      logGoogleTiming(request, timings)

      return result
    } catch (error) {
      lastError = error

      // Two first-time sign-ins for the same Google account can race: both
      // miss the lookup and one insert loses the unique constraint. Retrying
      // once resolves the winner's row instead of failing the login.
      if (error?.code === '23505' && attempt < MAX_SIGN_IN_ATTEMPTS) {
        operationalLogger.warn('google.sign_in_retry', {
          requestId: request?.requestId,
          reason: 'concurrent_account_creation',
        })

        await wait(retryDelayMs())
        continue
      }

      if (error instanceof AuthenticationError) {
        timings.totalMs = elapsedMs(totalStart)
        timings.failed = true
        logGoogleTiming(request, timings)
        throw error
      }

      operationalLogger.error('google.sign_in_failed', {
        requestId: request?.requestId,
        errorName: typeof error?.name === 'string' ? error.name : undefined,
        errorCode: typeof error?.code === 'string' ? error.code : undefined,
        reason: 'database_error',
      })

      timings.totalMs = elapsedMs(totalStart)
      timings.failed = true
      logGoogleTiming(request, timings)

      throw error
    }
  }

  throw lastError
}
