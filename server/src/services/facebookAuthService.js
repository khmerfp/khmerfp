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

function getAppCredentials() {
  const appId = process.env.FACEBOOK_APP_ID
  const appSecret = process.env.FACEBOOK_APP_SECRET

  if (!appId || !appSecret) {
    throw new Error(
      'FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be configured.',
    )
  }

  return { appId, appSecret }
}

// Bound every Graph call so a slow provider cannot hold the request open.
async function graphFetch(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS)

  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

// Confirm the access token really belongs to this app and this user. The
// app-access-token inspection is the authoritative server-side check; the
// client is never trusted to assert its own identity.
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
    debugBody = await response.json()
  } catch {
    throw new AuthenticationError('Unable to verify the Facebook token.')
  }

  const data = debugBody?.data

  if (!data?.is_valid) {
    throw new AuthenticationError('The Facebook token is invalid or expired.')
  }

  if (String(data.app_id) !== String(appId)) {
    throw new AuthenticationError('The Facebook token was issued for another app.')
  }

  if (!data.user_id) {
    throw new AuthenticationError('The Facebook token has no linked user.')
  }

  return String(data.user_id)
}

async function fetchFacebookProfile(accessToken) {
  const profileUrl = new URL(GRAPH_PROFILE_URL)
  profileUrl.searchParams.set('fields', 'id,name,email,picture')
  profileUrl.searchParams.set('access_token', accessToken)

  try {
    const response = await graphFetch(profileUrl)

    if (!response.ok) return null

    return await response.json()
  } catch {
    return null
  }
}

export async function signInWithFacebook(accessToken, request, { language } = {}) {
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new AuthenticationError('A Facebook access token is required.')
  }

  const facebookSub = await verifyFacebookAccessToken(accessToken)
  const profile = await fetchFacebookProfile(accessToken)

  const email = typeof profile?.email === 'string' && profile.email.trim()
    ? profile.email.trim().toLowerCase()
    : null

  // A verified email is required so the strict no-auto-link policy can be
  // enforced without guessing an identity.
  if (!email) {
    throw new AuthenticationError(
      'This Facebook account did not share an email address, which is required to sign in.',
    )
  }

  const pool = getDatabasePool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const { user } = await resolveProviderUser(client, {
      column: 'facebook_sub',
      identifier: facebookSub,
      email,
      displayName: profile?.name,
      avatarUrl: profile?.picture?.data?.url || null,
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
