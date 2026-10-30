
import { getDatabasePool } from '../config/database.js'
import {
  AuthenticationError,
  createSession,
} from './authSessionService.js'
import { resolveProviderUser } from './providerAccountService.js'

const GRAPH_DEBUG_URL = 'https://graph.facebook.com/debug_token'
const GRAPH_PROFILE_URL = 'https://graph.facebook.com/me'
const GRAPH_TIMEOUT_MS = 5000

export { AuthenticationError }

export class FacebookAuthConfigurationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FacebookAuthConfigurationError'
  }
}

function getAppCredentials() {
  const appId = process.env.FACEBOOK_APP_ID
  const appSecret = process.env.FACEBOOK_APP_SECRET

  if (!appId || !appSecret) {
    throw new FacebookAuthConfigurationError(
      'FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be configured.',
    )
  }

  return { appId, appSecret }
}

async function graphFetch(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS)

  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

// Verify that the access token is valid and belongs to this Facebook app.
export async function verifyFacebookAccessToken(accessToken) {
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new AuthenticationError('A Facebook access token is required.')
  }

  const { appId, appSecret } = getAppCredentials()
  const appAccessToken = `${appId}|${appSecret}`

  const debugUrl = new URL(GRAPH_DEBUG_URL)
  debugUrl.searchParams.set('input_token', accessToken)
  debugUrl.searchParams.set('access_token', appAccessToken)

  let debugBody

  try {
    const response = await graphFetch(debugUrl)

    if (!response.ok) {
      throw new Error('Facebook token verification failed.')
    }

    debugBody = await response.json()
  } catch {
    throw new AuthenticationError('Unable to verify the Facebook token.')
  }

  const data = debugBody?.data

  if (!data?.is_valid) {
    throw new AuthenticationError('The Facebook token is invalid or expired.')
  }

  if (String(data.app_id) !== String(appId)) {
    throw new AuthenticationError(
      'The Facebook token was issued for another app.',
    )
  }

  if (!data.user_id) {
    throw new AuthenticationError('The Facebook token has no linked user.')
  }

  return String(data.user_id)
}

// Request only basic public profile information.
// No email field is requested.
async function fetchFacebookProfile(accessToken) {
  const profileUrl = new URL(GRAPH_PROFILE_URL)

  profileUrl.searchParams.set('fields', 'id,name,picture')
  profileUrl.searchParams.set('access_token', accessToken)

  try {
    const response = await graphFetch(profileUrl)

    if (!response.ok) {
      return null
    }

    const profile = await response.json()

    return profile?.id ? profile : null
  } catch {
    return null
  }
}

// Keep compatibility with the existing database user structure.
// Facebook public_profile does not provide an email address.
export function resolveFacebookEmail(facebookSub) {
  return `facebook-${facebookSub}@facebook.local`
}

async function signInWithFacebookAccessToken(
  accessToken,
  request,
  { language } = {},
) {
  const facebookSub = await verifyFacebookAccessToken(accessToken)
  const profile = await fetchFacebookProfile(accessToken)

  if (!profile || String(profile.id) !== facebookSub) {
    throw new AuthenticationError(
      'Unable to retrieve your Facebook profile.',
    )
  }

  const email = resolveFacebookEmail(facebookSub)

  const pool = getDatabasePool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const { user } = await resolveProviderUser(client, {
      column: 'facebook_sub',
      identifier: facebookSub,
      email,
      displayName: profile.name || `Facebook User ${facebookSub}`,
      avatarUrl: profile.picture?.data?.url || null,
      language,
      request,
    })

    const sessionToken = await createSession(
      client,
      user.id,
      request,
      'facebook_login',
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

export async function signInWithFacebook(
  accessToken,
  request,
  { language } = {},
) {
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new AuthenticationError('A Facebook access token is required.')
  }

  return signInWithFacebookAccessToken(accessToken, request, { language })
}
