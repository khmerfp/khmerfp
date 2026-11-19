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

function traceGoogleStep(request, step, details = {}) {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'auth.google_trace',
      scope: 'googleAuthService',
      step,
      requestId: request?.requestId ?? null,
      ...details,
    }),
  )
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
  constructor(
    message = 'Google sign-in is not configured on this server.',
    code = 'GOOGLE_NOT_CONFIGURED',
  ) {
    super(message)
    this.name = 'GoogleAuthConfigurationError'
    this.code = code
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
    this.code = 'GOOGLE_UNAVAILABLE'
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

// google-auth-library reports an audience mismatch when the token was issued
// for a different OAuth client. That is a server/client configuration problem,
// not a bad user credential, so it must not be shown as "invalid token".
function isAudienceMismatchError(error) {
  const message = typeof error?.message === 'string' ? error.message : ''

  return /wrong recipient|payload audience|requiredAudience|audience mismatch|aud mismatch/i.test(
    message,
  )
}

export function classifyGoogleVerificationError(error) {
  if (isTransientVerificationError(error)) return 'verification_unavailable'
  if (isAudienceMismatchError(error)) return 'audience_mismatch'
  return 'invalid_token'
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
  traceGoogleStep(request, 'service.verify.start', {
    hasIdToken: typeof idToken === 'string' && idToken.trim().length > 0,
  })

  if (typeof idToken !== 'string' || !idToken.trim()) {
    traceGoogleStep(request, 'service.verify.missing_token')
    throw new AuthenticationError(
      'A Google ID token is required.',
      'GOOGLE_TOKEN_MISSING',
    )
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
    const reason = classifyGoogleVerificationError(error)

    traceGoogleStep(request, 'service.verify.token_rejected', {
      reason,
      errorName: typeof error?.name === 'string' ? error.name : undefined,
      errorCode: typeof error?.code === 'string' ? error.code : undefined,
    })

    logVerificationFailure(request, error, reason)

    if (reason === 'verification_unavailable') {
      throw new GoogleAuthUnavailableError()
    }

    if (reason === 'audience_mismatch') {
      throw new GoogleAuthConfigurationError(
        'Google sign-in is misconfigured on this server.',
        'GOOGLE_CLIENT_ID_MISMATCH',
      )
    }

    throw new AuthenticationError(
      'Invalid or expired Google ID token.',
      'GOOGLE_TOKEN_INVALID',
    )
  }

  traceGoogleStep(request, 'service.verify.payload', {
    hasSub: Boolean(payload?.sub),
    hasEmail:
      typeof payload?.email === 'string' && Boolean(payload.email.trim()),
    emailVerified: payload?.email_verified === true,
    issuer: typeof payload?.iss === 'string' ? payload.iss : undefined,
  })

  if (
    !payload?.sub ||
    typeof payload.email !== 'string' ||
    !payload.email.trim() ||
    payload.email_verified !== true ||
    !['accounts.google.com', 'https://accounts.google.com'].includes(
      payload.iss,
    )
  ) {
    traceGoogleStep(request, 'service.verify.unverified_profile')

    logVerificationFailure(request, null, 'unverified_profile')

    throw new AuthenticationError(
      'The Google account could not be verified.',
      'GOOGLE_ACCOUNT_UNVERIFIED',
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

  traceGoogleStep(request, 'service.sign_in.start', {
    language,
    hasIdToken: typeof idToken === 'string' && Boolean(idToken.trim()),
  })

  let payload

  try {
    payload = await measure(timings, 'tokenVerificationMs', () =>
      verifyGoogleIdentity(idToken, request),
    )

    traceGoogleStep(request, 'service.sign_in.verified', {
      verificationMs: timings.tokenVerificationMs,
    })
  } catch (error) {
    timings.totalMs = elapsedMs(totalStart)
    timings.failed = true
    logGoogleTiming(request, timings)

    traceGoogleStep(request, 'service.sign_in.verification_failed', {
      errorName: typeof error?.name === 'string' ? error.name : undefined,
      errorCode: typeof error?.code === 'string' ? error.code : undefined,
      message: error?.message,
    })

    // Preserve the specific error type so the route can return 401 for a bad
    // credential and 503 for a missing configuration or transient outage.
    throw error
  }

  let lastError

  for (let attempt = 1; attempt <= MAX_SIGN_IN_ATTEMPTS; attempt += 1) {
    try {
      traceGoogleStep(request, 'service.sign_in.persist_attempt', { attempt })

      const result = await persistGoogleSignIn(
        payload,
        request,
        language,
        timings,
      )

      timings.totalMs = elapsedMs(totalStart)
      logGoogleTiming(request, timings)

      traceGoogleStep(request, 'service.sign_in.success', {
        attempt,
        userId: result?.user?.id,
        totalMs: timings.totalMs,
      })

      return result
    } catch (error) {
      lastError = error

      // Two first-time sign-ins for the same Google account can race: both
      // miss the lookup and one insert loses the unique constraint. Retrying
      // once resolves the winner's row instead of failing the login.
      if (error?.code === '23505' && attempt < MAX_SIGN_IN_ATTEMPTS) {
        traceGoogleStep(request, 'service.sign_in.retry', {
          attempt,
          reason: 'concurrent_account_creation',
        })

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

        traceGoogleStep(request, 'service.sign_in.authentication_failed', {
          attempt,
          message: error?.message,
        })

        throw error
      }

      traceGoogleStep(request, 'service.sign_in.persist_failed', {
        attempt,
        errorName: typeof error?.name === 'string' ? error.name : undefined,
        errorCode: typeof error?.code === 'string' ? error.code : undefined,
        reason: 'database_error',
      })

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
