
import { Router } from 'express'
import {
  AuthenticationError,
  clearSessionCookie,
  createSessionCookie,
  getAuthenticatedUser,
  revokeAllUserSessions,
  revokeCurrentSession,
} from '../services/authSessionService.js'
import { signInWithGoogle } from '../services/googleAuthService.js'
import {
  FacebookAuthConfigurationError,
  signInWithFacebook,
} from '../services/facebookAuthService.js'

import { signInWithTelegram } from '../services/telegramLoginService.js'
import {
  PhoneOtpError,
  requestPhoneOtp,
  verifyPhoneOtp,
} from '../services/phoneAuthService.js'
import {
  PasswordPolicyError,
  registerWithEmail,
  signInWithEmail,
} from '../services/emailAuthService.js'
import {
  recordAuthEvent,
  recordAuthEventQuietly,
} from '../services/authAuditService.js'
import {
  FactorVerificationError,
  enrollTelegramFactor,
  getFactorStatus,
  stepUpWithTelegram,
} from '../services/telegramFactorService.js'
import { createAuthRateLimiter } from '../middleware/authRateLimit.js'

function allowedOrigins() {
  return (process.env.APP_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function isAllowedOrigin(request) {
  const origin = request.get('origin')

  if (!origin) return false

  return allowedOrigins().includes(origin)
}

// The redirect URI is sent back to Facebook during the code exchange, so it
// must belong to an origin this deployment already trusts.
function isAllowedRedirectUri(value) {
  if (typeof value !== 'string' || !value.trim()) return false

  let parsed

  try {
    parsed = new URL(value.trim())
  } catch {
    return false
  }

  return allowedOrigins().includes(parsed.origin)
}

function requireAllowedOrigin(request, response, next) {
  if (!isAllowedOrigin(request)) {
    recordAuthEventQuietly({
      eventType: 'origin_blocked',
      request,
      details: { origin: (request.get('origin') || '').slice(0, 200) },
    })

    response.status(403).json({ message: 'Request origin is not allowed.' })
    return
  }

  next()
}

async function requireUser(request, response, next) {
  try {
    const user = await getAuthenticatedUser(request)

    if (!user) {
      response.status(401).json({ message: 'Authentication required.' })
      return
    }

    request.authUser = user
    next()
  } catch (error) {
    next(error)
  }
}

export function createAuthRouter({
  authRateLimiter = createAuthRateLimiter(),
} = {}) {
  const router = Router()

  router.get('/config', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.status(200).json({
      googleClientId: process.env.GOOGLE_CLIENT_ID || null,
      facebookAppId: process.env.FACEBOOK_APP_ID || null,
      telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || null,
    })
  })

  router.post(
    '/google',
    requireAllowedOrigin,
    authRateLimiter,
    async (request, response, next) => {
      try {
        const credential = request.body?.credential
        const language = request.body?.language

        const { user, sessionToken } = await signInWithGoogle(
          credential,
          request,
          { language },
        )

        response.setHeader('Set-Cookie', createSessionCookie(sessionToken))
        response.setHeader('Cache-Control', 'no-store')
        response.status(200).json({ user })
      } catch (error) {
        if (error instanceof AuthenticationError) {
          await recordAuthEventQuietly({
            eventType: 'google_login_failed',
            request,
            details: { reason: error.message },
          })

          response.status(401).json({ message: error.message })
          return
        }

        next(error)
      }
    },
  )

  router.post(
    '/facebook',
    requireAllowedOrigin,
    authRateLimiter,
    async (request, response, next) => {
      try {
        const { accessToken, language } = request.body ?? {}

        const { user, sessionToken } = await signInWithFacebook(
          accessToken,
          request,
          { language },
        )

        response.setHeader('Set-Cookie', createSessionCookie(sessionToken))
        response.setHeader('Cache-Control', 'no-store')
        response.status(200).json({ user })
      } catch (error) {
        if (error instanceof AuthenticationError) {
          await recordAuthEventQuietly({
            eventType: 'facebook_login_failed',
            request,
            details: { reason: error.message },
          })

          response.status(401).json({ message: error.message })
          return
        }

        if (error instanceof FacebookAuthConfigurationError) {
          response.status(503).json({ message: error.message })
          return
        }

        next(error)
      }
    },
  )

  router.post(
    '/facebook/code',
    requireAllowedOrigin,
    authRateLimiter,
    async (request, response, next) => {
      try {
        const { code, redirectUri, language } = request.body ?? {}

        if (!isAllowedRedirectUri(redirectUri)) {
          response.status(400).json({
            message: 'The Facebook redirect URI is not allowed.',
          })
          return
        }

        const { user, sessionToken } = await signInWithFacebookCode(
          code,
          redirectUri,
          request,
          { language },
        )

        response.setHeader('Set-Cookie', createSessionCookie(sessionToken))
        response.setHeader('Cache-Control', 'no-store')
        response.status(200).json({ user })
      } catch (error) {
        if (error instanceof AuthenticationError) {
          await recordAuthEventQuietly({
            eventType: 'facebook_login_failed',
            request,
            details: { reason: error.message },
          })

          response.status(401).json({ message: error.message })
          return
        }

        if (error instanceof FacebookAuthConfigurationError) {
          response.status(503).json({ message: error.message })
          return
        }

        next(error)
      }
    },
  )

  router.post(
    '/telegram',
    requireAllowedOrigin,
    authRateLimiter,
    async (request, response, next) => {
      try {
        const { language } = request.body ?? {}

        const { user, sessionToken } = await signInWithTelegram(
          request.body,
          request,
          { language },
        )

        response.setHeader('Set-Cookie', createSessionCookie(sessionToken))
        response.setHeader('Cache-Control', 'no-store')
        response.status(200).json({ user })
      } catch (error) {
        if (error instanceof AuthenticationError) {
          await recordAuthEventQuietly({
            eventType: 'telegram_login_failed',
            request,
            details: { reason: error.message },
          })

          response.status(401).json({ message: error.message })
          return
        }

        next(error)
      }
    },
  )

  router.post(
    '/phone/request',
    requireAllowedOrigin,
    authRateLimiter,
    async (request, response, next) => {
      try {
        const { phoneNumber } = request.body ?? {}

        const result = await requestPhoneOtp(phoneNumber, request)

        response.setHeader('Cache-Control', 'no-store')
        response.status(200).json({
          message: 'A verification code has been sent.',
          phoneNumber: result.phoneNumber,
        })
      } catch (error) {
        if (error instanceof PhoneOtpError) {
          await recordAuthEventQuietly({
            eventType: 'phone_otp_request_failed',
            request,
            details: { reason: error.message },
          })

          response.status(400).json({ message: error.message })
          return
        }

        next(error)
      }
    },
  )

  router.post(
    '/phone/verify',
    requireAllowedOrigin,
    authRateLimiter,
    async (request, response, next) => {
      try {
        const { phoneNumber, code, language } = request.body ?? {}

        const { user, sessionToken } = await verifyPhoneOtp(
          phoneNumber,
          code,
          request,
          { language },
        )

        response.setHeader('Set-Cookie', createSessionCookie(sessionToken))
        response.setHeader('Cache-Control', 'no-store')
        response.status(200).json({ user })
      } catch (error) {
        if (error instanceof PhoneOtpError) {
          await recordAuthEventQuietly({
            eventType: 'phone_otp_verify_failed',
            request,
            details: { reason: error.message },
          })

          response.status(401).json({ message: error.message })
          return
        }

        next(error)
      }
    },
  )

  router.post(
    '/login',
    requireAllowedOrigin,
    authRateLimiter,
    async (request, response, next) => {
      try {
        const { email, password, language } = request.body ?? {}

        const { user, sessionToken } = await signInWithEmail(
          email,
          password,
          request,
          { language },
        )

        response.setHeader('Set-Cookie', createSessionCookie(sessionToken))
        response.setHeader('Cache-Control', 'no-store')
        response.status(200).json({ user })
      } catch (error) {
        if (error instanceof AuthenticationError) {
          await recordAuthEventQuietly({
            eventType: 'email_login_failed',
            request,
            details: { reason: error.message },
          })

          response.status(401).json({ message: error.message })
          return
        }

        next(error)
      }
    },
  )

  router.post(
    '/register',
    requireAllowedOrigin,
    authRateLimiter,
    async (request, response, next) => {
      try {
        const { email, password, displayName, language } = request.body ?? {}

        const { user, sessionToken } = await registerWithEmail(
          email,
          password,
          displayName,
          request,
          { language },
        )

        response.setHeader('Set-Cookie', createSessionCookie(sessionToken))
        response.setHeader('Cache-Control', 'no-store')
        response.status(201).json({ user })
      } catch (error) {
        if (error instanceof AuthenticationError) {
          await recordAuthEventQuietly({
            eventType: 'email_register_failed',
            request,
            details: { reason: error.message },
          })

          // A taken email is a client-visible conflict; policy failures are
          // validation errors. Both are safe to show to the user.
          const status =
            error.message === 'An account with this email already exists. Sign in instead.'
              ? 409
              : 400

          response.status(status).json({ message: error.message })
          return
        }

        if (error instanceof PasswordPolicyError) {
          response.status(400).json({ message: error.message })
          return
        }

        next(error)
      }
    },
  )

  router.get('/me', async (request, response, next) => {
    try {
      const user = await getAuthenticatedUser(request)

      if (!user) {
        response.status(401).json({ message: 'Authentication required.' })
        return
      }

      response.setHeader('Cache-Control', 'no-store')
      response.status(200).json({ user })
    } catch (error) {
      next(error)
    }
  })

  // Same-origin GETs do not carry an Origin header, so this read is guarded
  // by the session cookie (SameSite=Lax) instead of the origin check.
  router.get(
    '/factors',
    requireUser,
    async (request, response, next) => {
      try {
        const factors = await getFactorStatus(request.authUser.id)

        response.setHeader('Cache-Control', 'no-store')
        response.status(200).json({ factors })
      } catch (error) {
        next(error)
      }
    },
  )

  router.post(
    '/factors/telegram',
    requireAllowedOrigin,
    authRateLimiter,
    requireUser,
    async (request, response, next) => {
      try {
        await enrollTelegramFactor(
          request.authUser,
          request.body,
          request,
        )

        const factors = await getFactorStatus(request.authUser.id)

        response.setHeader('Cache-Control', 'no-store')
        response.status(200).json({ factors })
      } catch (error) {
        if (error instanceof FactorVerificationError) {
          await recordAuthEventQuietly({
            userId: request.authUser.id,
            eventType: 'factor_enroll_failed',
            request,
            details: { factor_type: 'telegram', reason: error.message },
          })

          response.status(401).json({ message: error.message })
          return
        }

        next(error)
      }
    },
  )

  router.post(
    '/step-up',
    requireAllowedOrigin,
    authRateLimiter,
    requireUser,
    async (request, response, next) => {
      try {
        const { sessionToken } = await stepUpWithTelegram(
          request.authUser,
          request,
          request.body,
        )

        response.setHeader('Set-Cookie', createSessionCookie(sessionToken))
        response.setHeader('Cache-Control', 'no-store')
        response.status(200).json({ message: 'Step-up verification succeeded.' })
      } catch (error) {
        if (error instanceof FactorVerificationError) {
          await recordAuthEventQuietly({
            userId: request.authUser.id,
            eventType: 'step_up_failed',
            request,
            details: { factor_type: 'telegram', reason: error.message },
          })

          response.status(401).json({ message: error.message })
          return
        }

        next(error)
      }
    },
  )

  router.post('/logout', requireAllowedOrigin, async (request, response, next) => {
    try {
      const user = await getAuthenticatedUser(request)

      await revokeCurrentSession(request)

      if (user) {
        await recordAuthEvent({
          userId: user.id,
          eventType: 'logout',
          request,
        })
      }

      response.setHeader('Set-Cookie', clearSessionCookie())
      response.status(200).json({ message: 'Logged out successfully.' })
    } catch (error) {
      next(error)
    }
  })

  router.post(
    '/logout-all',
    requireAllowedOrigin,
    requireUser,
    async (request, response, next) => {
      try {
        await revokeAllUserSessions(request.authUser.id)

        await recordAuthEvent({
          userId: request.authUser.id,
          eventType: 'logout_all',
          request,
        })

        response.setHeader('Set-Cookie', clearSessionCookie())
        response.status(200).json({
          message: 'All sessions have been revoked.',
        })
      } catch (error) {
        next(error)
      }
    },
  )

  return router
}
