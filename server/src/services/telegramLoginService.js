import { getDatabasePool } from '../config/database.js'
import {
  AuthenticationError,
  createSession,
} from './authSessionService.js'
import { resolveProviderUser } from './providerAccountService.js'
import { FactorVerificationError, verifyTelegramLogin } from './telegramFactorService.js'

export { AuthenticationError }

// Sign in with the Telegram Login Widget as a first-class provider, separate
// from the second-factor enrollment flow. Verification is the same HMAC proof
// used by the factor service; here it establishes or resumes a session.
export async function signInWithTelegram(payload, request, { language } = {}) {
  let verified

  try {
    verified = verifyTelegramLogin(payload)
  } catch (error) {
    if (error instanceof FactorVerificationError) {
      throw new AuthenticationError(error.message)
    }

    throw error
  }

  const pool = getDatabasePool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const { user } = await resolveProviderUser(client, {
      column: 'telegram_sub',
      identifier: verified.telegramId,
      // Telegram shares no email; store a reserved, non-routable placeholder
      // that is unique per Telegram id.
      email: `telegram-${verified.telegramId}@telegram.local`,
      displayName: verified.displayName || verified.username || `Telegram ${verified.telegramId}`,
      language,
      request,
    })

    const sessionToken = await createSession(
      client,
      user.id,
      request,
      'telegram_login',
    )

    await client.query('COMMIT')

    return { user, sessionToken }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
