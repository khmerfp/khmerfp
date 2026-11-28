import { Router } from 'express'
import { getDatabasePool } from '../config/database.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { recordAuthEvent } from '../services/authAuditService.js'
import { notifyIdentityDenial } from '../services/identityDenialNotificationService.js'
import {
  exchangeAuthToken,
  getLoginToken,
  getUserInfo,
} from '../lib/camdigikey.js'

export function getAge(dateOfBirth, today = new Date()) {
  const match = typeof dateOfBirth === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth)
    : null
  if (!match) return -1

  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const birthDate = new Date(Date.UTC(year, month - 1, day))
  if (
    birthDate.getUTCFullYear() !== year
    || birthDate.getUTCMonth() !== month - 1
    || birthDate.getUTCDate() !== day
  ) return -1

  let age = today.getUTCFullYear() - year
  if (
    today.getUTCMonth() < month - 1
    || (today.getUTCMonth() === month - 1 && today.getUTCDate() < day)
  ) age -= 1
  return age
}

export async function isUserIdentityVerified(userId) {
  const result = await getDatabasePool().query(
    `SELECT identity_verified_at IS NOT NULL AS verified
     FROM users WHERE id = $1`,
    [userId],
  )
  return result.rows[0]?.verified === true
}

export function createCamDigiKeyRouter({
  authGuard = requireAuth,
  createLoginToken = getLoginToken,
  exchangeToken = exchangeAuthToken,
  fetchUserInfo = getUserInfo,
  pool = getDatabasePool,
  audit = recordAuthEvent,
  now = () => new Date(),
} = {}) {
  const router = Router()

  router.post('/login-token', authGuard, async (request, response) => {
    try {
      const loginToken = await createLoginToken()
      response.setHeader('Cache-Control', 'no-store')
      response.status(200).json({ loginToken })
    } catch (error) {
      console.error('CamDigiKey login-token request failed:', error)
      response.status(500).json({ message: 'Could not start verification.' })
    }
  })

  router.get('/callback', authGuard, async (request, response) => {
    const resultUrl = new URL('/verify-result', process.env.FRONTEND_URL || 'http://localhost:5173')
    const redirect = (status, retryAt = null) => {
      resultUrl.searchParams.set('status', status)
      if (retryAt) resultUrl.searchParams.set('retryAt', new Date(retryAt).toISOString())
      response.redirect(resultUrl.toString())
    }

    try {
      // TODO: replace "token" with the official CamDigiKey callback parameter.
      const authToken = request.query.token
      if (typeof authToken !== 'string' || !authToken) {
        throw new Error('CamDigiKey callback token is missing.')
      }

      const accessToken = await exchangeToken(authToken)
      const info = await fetchUserInfo(accessToken)
      const subject = typeof info.sub === 'string' && info.sub ? info.sub : null
      const reasons = []
      if (info.nationality !== 'KH') reasons.push('not_cambodian')
      if (info.idType !== 'NATIONAL_ID') reasons.push('not_national_id')
      const age = getAge(info.dateOfBirth, now())
      if (age < 15) reasons.push('under_15_or_invalid_birth_date')

      const database = pool()
      const client = await database.connect()
      let deniedUntil = null
      let noticeUser = null
      let outcome = 'verified'

      try {
        await client.query('BEGIN')

        const accountResult = await client.query(
          `SELECT identity_verified_at, identity_denied_until
           FROM users WHERE id = $1 FOR UPDATE`,
          [request.authUser.id],
        )
        const account = accountResult.rows[0]
        if (account?.identity_verified_at) {
          await client.query('COMMIT')
          redirect('ok')
          return
        }

        if (subject) {
          const ownerResult = await client.query(
            `SELECT id, identity_verified_at, identity_denied_until
             FROM users WHERE camdigikey_sub = $1 FOR UPDATE`,
            [subject],
          )
          const owner = ownerResult.rows[0]

          if (owner && String(owner.id) !== String(request.authUser.id)) {
            const ownerDeniedUntil = owner.identity_denied_until
            if (owner.identity_verified_at) {
              outcome = 'rejected'
              reasons.push('identity_already_linked')
            } else if (ownerDeniedUntil && new Date(ownerDeniedUntil) > now()) {
              deniedUntil = ownerDeniedUntil
              outcome = 'denied'
              await client.query(
                `UPDATE users SET identity_denied_until = $2 WHERE id = $1`,
                [request.authUser.id, deniedUntil],
              )
              await client.query(
                `UPDATE sessions SET revoked_at = NOW()
                 WHERE user_id = $1 AND revoked_at IS NULL`,
                [request.authUser.id],
              )
              const recipient = await client.query(
                `SELECT email, phone_number, phone_verified_at, telegram_sub
                 FROM users WHERE id = $1`,
                [request.authUser.id],
              )
              noticeUser = recipient.rows[0]
            } else {
              await client.query(
                `UPDATE users
                 SET camdigikey_sub = NULL, identity_denied_until = NULL
                 WHERE id = $1 AND identity_verified_at IS NULL`,
                [owner.id],
              )
            }
          }
        }

        if (outcome === 'verified') {
          const isUnderage = age >= 0 && age < 15
          if (reasons.length && isUnderage) {
            const denied = await client.query(
              `UPDATE users
               SET camdigikey_sub = $1,
                   identity_denied_until = NOW() + INTERVAL '48 hours'
               WHERE id = $2
               RETURNING identity_denied_until`,
              [subject, request.authUser.id],
            )
            deniedUntil = denied.rows[0].identity_denied_until
            outcome = 'denied'
            await client.query(
              `UPDATE sessions SET revoked_at = NOW()
               WHERE user_id = $1 AND revoked_at IS NULL`,
              [request.authUser.id],
            )
            const recipient = await client.query(
              `SELECT email, phone_number, phone_verified_at, telegram_sub
               FROM users WHERE id = $1`,
              [request.authUser.id],
            )
            noticeUser = recipient.rows[0]
          } else if (reasons.length) {
            outcome = 'rejected'
          } else if (!reasons.length && !subject) {
            throw new Error('CamDigiKey subject is missing.')
          } else if (!reasons.length) {
            await client.query(
              `UPDATE users
               SET camdigikey_sub = $1,
                   identity_verified_at = COALESCE(identity_verified_at, NOW()),
                   identity_denied_until = NULL
               WHERE id = $2`,
              [subject, request.authUser.id],
            )
          }
        }

        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }

      if (outcome === 'denied') {
        if (noticeUser) await notifyIdentityDenial(noticeUser, deniedUntil)
        await audit({
          userId: request.authUser.id,
          eventType: 'camdigikey_verification_denied',
          request,
          details: {
            reasons: reasons.length ? reasons : ['identity_denied_cooldown'],
            retryAt: new Date(deniedUntil).toISOString(),
          },
        })
        redirect('denied', deniedUntil)
        return
      }

      if (outcome === 'rejected') {
        await audit({
          userId: request.authUser.id,
          eventType: 'camdigikey_verification_rejected',
          request,
          details: { reasons },
        })
        redirect('rejected')
        return
      }

      await audit({
        userId: request.authUser.id,
        eventType: 'camdigikey_verification_succeeded',
        request,
      })
      redirect('ok')
    } catch (error) {
      console.error('CamDigiKey callback failed:', error)
      try {
        await audit({
          userId: request.authUser.id,
          eventType: 'camdigikey_verification_error',
          request,
          details: { reason: 'provider_or_server_error' },
        })
      } catch (auditError) {
        console.error('CamDigiKey error audit write failed:', auditError)
      }
      redirect('error')
    }
  })

  return router
}

export default createCamDigiKeyRouter
