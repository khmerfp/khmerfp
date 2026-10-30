
import { getDatabasePool } from '../config/database.js'
import {
  AuthenticationError,
  createSession,
} from './authSessionService.js'
import { resolveProviderUser } from './providerAccountService.js'

const GRAPH_DEBUG_URL = 'https://graph.facebook.com/debug_token'
const GRAPH_PROFILE_URL = 'https://graph.facebook.com/me'
const GRAPH_TOKEN_URL = 'https://graph.facebook.com/oauth/access_token'
const GRAPH_TIMEOUT_MS = 5000

export { AuthenticationError }

export class FacebookAuthConfigurationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'FacebookAuthConfigurationError'
  }
}

function getAppCredentials() {
  const appId = process.env.FACEBOOK_APP_ID?.trim()
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim()

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

// Request the profile fields covered by public_profile and, when the person
// granted it, the optional email permission.
async function fetchFacebookProfile(accessToken) {
  const profileUrl = new URL(GRAPH_PROFILE_URL)

  profileUrl.searchParams.set('fields', 'id,name,email,picture')
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

// Facebook only returns the email when the person granted the email
// permission. The Facebook id is the real identity, so an account without a
// shared email receives a reserved, non-routable placeholder address instead
// of being locked out of the sign-in button.
export function resolveFacebookEmail(profile, facebookSub) {
  const sharedEmail =
    typeof profile?.email === 'string' && profile.email.trim()
      ? profile.email.trim().toLowerCase()
      : null

  return sharedEmail || `facebook-${facebookSub}@facebook.local`
}

// Exchange an authorization code for a user access token. The app secret is
// used for this server-to-server call and never reaches the browser.
export async function exchangeFacebookAuthorizationCode(code, redirectUri) {
  if (typeof code !== 'string' || !code.trim()) {
    throw new AuthenticationError('A Facebook authorization code is required.')
  }

  const { appId, appSecret } = getAppCredentials()

  const tokenUrl = new URL(GRAPH_TOKEN_URL)
  tokenUrl.searchParams.set('client_id', appId)
  tokenUrl.searchParams.set('client_secret', appSecret)
  tokenUrl.searchParams.set('code', code.trim())

  if (typeof redirectUri === 'string' && redirectUri.trim()) {
    tokenUrl.searchParams.set('redirect_uri', redirectUri.trim())
  }

  let body

  try {
    const response = await graphFetch(tokenUrl)
    body = await response.json()
  } catch {
    throw new AuthenticationError(
      'Unable to exchange the Facebook authorization code.',
    )
  }

  const accessToken =
    typeof body?.access_token === 'string' && body.access_token.trim()
      ? body.access_token.trim()
      : null

  if (!accessToken) {
    throw new AuthenticationError(
      'The Facebook authorization code is invalid or expired.',
    )
  }

  return accessToken
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

  const email = resolveFacebookEmail(profile, facebookSub)
  const sharedEmail = email !== `facebook-${facebookSub}@facebook.local`

  const pool = getDatabasePool()
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    const { user } = await resolveProviderUser(client, {
      column: 'facebook_sub',
      identifier: facebookSub,
      email,
      displayName:
        profile.name || (sharedEmail ? null : `Facebook User ${facebookSub}`),
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

// Sign in with an authorization code from the Facebook login dialog. The code
// is exchanged server-side for an access token before the identity check.
export async function signInWithFacebookCode(
  code,
  redirectUri,
  request,
  { language } = {},
) {
  const accessToken = await exchangeFacebookAuthorizationCode(code, redirectUri)

  return signInWithFacebookAccessToken(accessToken, request, { language })
}
