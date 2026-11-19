import { Router } from 'express'
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { getDatabasePool } from '../config/database.js'
import { createSession, createSessionCookie } from '../services/authSessionService.js'
import { createAuthRateLimiter } from '../middleware/authRateLimit.js'
import { recordAuthEventQuietly } from '../services/authAuditService.js'

const TELEGRAM_AUTH_URL = 'https://oauth.telegram.org/auth'
const TELEGRAM_TOKEN_URL = 'https://oauth.telegram.org/token'
const TELEGRAM_ISSUER = 'https://oauth.telegram.org'
const TELEGRAM_JWKS_URL = new URL(
  'https://oauth.telegram.org/.well-known/jwks.json',
)
const CALLBACK_PATH = '/api/auth/telegram/callback'
const STATE_COOKIE_NAME = 'telegram_oidc_state'
const STATE_COOKIE_PATH = '/'
const STATE_MAX_AGE_SECONDS = 600
const TOKEN_REQUEST_TIMEOUT_MS = 10000

export class TelegramAuthError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'TelegramAuthError'
    this.status = status
  }
}

function getConfig() {
  const clientId = process.env.TG_CLIENT_ID?.trim()
  const clientSecret = process.env.TG_CLIENT_SECRET?.trim()
  const redirectUri = process.env.TG_REDIRECT_URI?.trim()
  const frontendUrl = process.env.FRONTEND_URL?.trim()

  if (!clientId || !clientSecret || !redirectUri || !frontendUrl) {
    throw new TelegramAuthError(
      'Telegram sign-in is not configured on this server.',
      503,
    )
  }

  let parsedRedirect
  let parsedFrontend
  try {
    parsedRedirect = new URL(redirectUri)
    parsedFrontend = new URL(frontendUrl)
  } catch {
    throw new TelegramAuthError(
      'Telegram sign-in URLs are not configured correctly.',
      503,
    )
  }

  if (
    parsedRedirect.pathname !== CALLBACK_PATH
    || parsedRedirect.search
    || parsedRedirect.hash
    || parsedRedirect.username
    || parsedRedirect.password
    || parsedFrontend.username
    || parsedFrontend.password
    || !['https:', 'http:'].includes(parsedFrontend.protocol)
    || (process.env.NODE_ENV === 'production'
      && (parsedRedirect.protocol !== 'https:' || parsedFrontend.protocol !== 'https:'))
  ) {
    throw new TelegramAuthError(
      'Telegram sign-in URLs are not configured correctly.',
      503,
    )
  }

  return {
    clientId,
    clientSecret,
    redirectUri: parsedRedirect.toString(),
    frontendUrl: parsedFrontend.toString(),
  }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left))
  const rightBuffer = Buffer.from(String(right))
  return leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer)
}

function stateCookieName() {
  return process.env.NODE_ENV === 'production'
    ? `__Host-${STATE_COOKIE_NAME}`
    : STATE_COOKIE_NAME
}

function buildStateCookie(value, { clear = false, secure = false } = {}) {
  const attributes = [
    `${stateCookieName()}=${value}`,
    `Path=${STATE_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${clear ? 0 : STATE_MAX_AGE_SECONDS}`,
  ]

  if (secure || process.env.NODE_ENV === 'production') {
    attributes.push('Secure')
  }
  if (clear) {
    attributes.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
  }

  return attributes.join('; ')
}

function readCookie(request, name) {
  for (const item of (request.headers.cookie || '').split(';')) {
    const separator = item.indexOf('=')
    if (separator < 0) continue
    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim()
    }
  }
  return null
}

function serializeState(state, secret) {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

function deserializeState(cookieValue, secret) {
  if (typeof cookieValue !== 'string') {
    throw new TelegramAuthError('Telegram sign-in expired. Please try again.')
  }

  const separator = cookieValue.lastIndexOf('.')
  if (separator < 1) {
    throw new TelegramAuthError('Telegram sign-in expired. Please try again.')
  }

  const payload = cookieValue.slice(0, separator)
  const suppliedSignature = cookieValue.slice(separator + 1)
  const expectedSignature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url')
  if (!safeEqual(suppliedSignature, expectedSignature)) {
    throw new TelegramAuthError('Telegram sign-in could not be verified.')
  }

  let state
  try {
    state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    throw new TelegramAuthError('Telegram sign-in could not be verified.')
  }

  if (
    !state
    || typeof state.state !== 'string'
    || typeof state.nonce !== 'string'
    || typeof state.codeVerifier !== 'string'
    || !Number.isFinite(state.createdAt)
    || Date.now() - state.createdAt > STATE_MAX_AGE_SECONDS * 1000
  ) {
    throw new TelegramAuthError('Telegram sign-in expired. Please try again.')
  }

  return state
}

function getTelegramJwks(jwks) {
  return jwks || createRemoteJWKSet(TELEGRAM_JWKS_URL)
}

async function exchangeCode(code, codeVerifier, config, fetchImplementation) {
  let response
  try {
    response = await fetchImplementation(TELEGRAM_TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        code_verifier: codeVerifier,
      }),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new TelegramAuthError('Telegram sign-in is temporarily unavailable.', 503)
  }

  let tokenResponse
  try {
    tokenResponse = await response.json()
  } catch {
    throw new TelegramAuthError('Telegram returned an invalid token response.')
  }

  if (!response.ok || !tokenResponse || typeof tokenResponse.id_token !== 'string') {
    throw new TelegramAuthError('Telegram could not complete sign-in. Please try again.')
  }

  return tokenResponse.id_token
}

async function verifyIdToken(idToken, state, config, jwks) {
  let payload
  try {
    ({ payload } = await jwtVerify(idToken, jwks, {
      issuer: TELEGRAM_ISSUER,
      audience: config.clientId,
      algorithms: ['RS256'],
    }))
  } catch {
    throw new TelegramAuthError('Telegram identity token could not be verified.')
  }

  if (
    typeof payload.sub !== 'string'
    || !/^\d{1,20}$/.test(payload.sub)
    || typeof payload.nonce !== 'string'
    || !safeEqual(payload.nonce, state.nonce)
  ) {
    throw new TelegramAuthError('Telegram identity token could not be verified.')
  }

  return payload
}

function getDisplayName(payload) {
  const name = typeof payload.name === 'string' ? payload.name.trim() : ''
  if (name) return name.slice(0, 255)

  const fullName = [payload.given_name, payload.family_name]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ')
  if (fullName) return fullName.slice(0, 255)

  if (typeof payload.preferred_username === 'string' && payload.preferred_username.trim()) {
    return payload.preferred_username.trim().slice(0, 255)
  }

  return `Telegram ${payload.sub}`
}

async function createOrUpdateTelegramSession(pool, payload, request) {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const userResult = await client.query(
      `INSERT INTO users (
         telegram_sub, email, display_name, avatar_url,
         last_login_at, last_login_ip, last_login_user_agent
       )
       VALUES ($1, $2, $3, $4, NOW(), $5, $6)
       ON CONFLICT (telegram_sub) WHERE telegram_sub IS NOT NULL
       DO UPDATE SET
         last_login_at = NOW(),
         last_login_ip = EXCLUDED.last_login_ip,
         last_login_user_agent = EXCLUDED.last_login_user_agent,
         updated_at = NOW()
       RETURNING id, email, display_name, avatar_url, language`,
      [
        payload.sub,
        `telegram-${payload.sub}@telegram.local`,
        getDisplayName(payload),
        typeof payload.picture === 'string' ? payload.picture : null,
        request.ip || null,
        (request.get('user-agent') || '').slice(0, 1000) || null,
      ],
    )

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
      'telegram_login',
    )

    await client.query('COMMIT')
    return { user, sessionToken }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export function createTelegramAuthRouter({
  authRateLimiter = createAuthRateLimiter(),
  pool = getDatabasePool,
  fetchImplementation = (...args) => fetch(...args),
  jwks,
} = {}) {
  const router = Router()
  const signingKeys = getTelegramJwks(jwks)

  router.get('/login', authRateLimiter, (request, response) => {
    try {
      const config = getConfig()
      const state = randomBytes(32).toString('base64url')
      const nonce = randomBytes(32).toString('base64url')
      const codeVerifier = randomBytes(32).toString('base64url')
      const codeChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url')
      const transaction = {
        state,
        nonce,
        codeVerifier,
        createdAt: Date.now(),
      }

      const authorizationUrl = new URL(TELEGRAM_AUTH_URL)
      authorizationUrl.searchParams.set('client_id', config.clientId)
      authorizationUrl.searchParams.set('redirect_uri', config.redirectUri)
      authorizationUrl.searchParams.set('response_type', 'code')
      authorizationUrl.searchParams.set('scope', 'openid profile')
      authorizationUrl.searchParams.set('state', state)
      authorizationUrl.searchParams.set('nonce', nonce)
      authorizationUrl.searchParams.set('code_challenge', codeChallenge)
      authorizationUrl.searchParams.set('code_challenge_method', 'S256')

      response.setHeader('Set-Cookie', buildStateCookie(
        serializeState(transaction, config.clientSecret),
        { secure: config.redirectUri.startsWith('https:') },
      ))
      response.setHeader('Cache-Control', 'no-store')
      response.redirect(302, authorizationUrl.toString())
    } catch (error) {
      response.setHeader('Cache-Control', 'no-store')
      response.status(error instanceof TelegramAuthError ? error.status : 500)
        .json({ message: error.message || 'Unable to start Telegram sign-in.' })
    }
  })

  router.get('/callback', authRateLimiter, async (request, response) => {
    let config
    let transaction
    let secureCookie = process.env.NODE_ENV === 'production'

    try {
      config = getConfig()
      secureCookie = config.redirectUri.startsWith('https:')
      transaction = deserializeState(
        readCookie(request, stateCookieName()),
        config.clientSecret,
      )

      if (typeof request.query.state !== 'string'
        || !safeEqual(request.query.state, transaction.state)) {
        throw new TelegramAuthError('Telegram sign-in state did not match.')
      }
      if (request.query.error) {
        throw new TelegramAuthError('Telegram sign-in was cancelled.')
      }
      if (typeof request.query.code !== 'string'
        || !request.query.code
        || request.query.code.length > 4096) {
        throw new TelegramAuthError('Telegram did not return an authorization code.')
      }

      const idToken = await exchangeCode(
        request.query.code,
        transaction.codeVerifier,
        config,
        fetchImplementation,
      )
      const payload = await verifyIdToken(idToken, transaction, config, signingKeys)
      const { sessionToken } = await createOrUpdateTelegramSession(
        typeof pool === 'function' ? pool() : pool,
        payload,
        request,
      )

      response.setHeader('Set-Cookie', [
        buildStateCookie('', { clear: true, secure: secureCookie }),
        createSessionCookie(sessionToken),
      ])
      response.setHeader('Cache-Control', 'no-store')
      response.redirect(303, config.frontendUrl)
      return
    } catch (error) {
      await recordAuthEventQuietly({
        eventType: 'telegram_login_failed',
        request,
        details: {
          reason: error instanceof TelegramAuthError
            ? error.message
            : 'oidc_callback_failed',
        },
      })
      response.setHeader('Set-Cookie', buildStateCookie('', {
        clear: true,
        secure: secureCookie,
      }))
      response.setHeader('Cache-Control', 'no-store')
      response.status(error instanceof TelegramAuthError ? error.status : 500)
        .type('text')
        .send('Telegram sign-in failed. Return to KhmerFP and try again.')
    }
  })

  return router
}
