const UNEXPECTED_RESPONSE_MESSAGE = 'The server returned an unexpected response.'
const API_REQUEST_OPTIONS = { credentials: 'include' }

// A cold backend, a proxy timeout, or a dropped connection must not leave the
// Google button stuck in "Signing in…" forever.
const GOOGLE_REQUEST_TIMEOUT_MS = 20000
const GOOGLE_MAX_ATTEMPTS = 2
const GOOGLE_RETRY_DELAY_MS = 300
const BLOCKED_REDIRECT_MESSAGE =
  'Your network blocked the sign-in request. Try another network or disable content filtering.'

const API_BASE_URL =
  typeof import.meta.env?.VITE_API_URL === 'string'
    ? import.meta.env.VITE_API_URL.trim().replace(/\/+$/, '')
    : ''

function apiUrl(path) {
  return `${API_BASE_URL}${path}`
}

// Read the body even when a proxy returns HTML or an empty response, so the
// caller can report the HTTP status instead of a generic failure.
async function readJson(response) {
  let text

  try {
    text = await response.text()
  } catch {
    return null
  }

  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function readMessage(body, response) {
  if (body && typeof body.message === 'string' && body.message) {
    return body.message
  }

  if (body && typeof body.error === 'string' && body.error) {
    return body.error
  }

  const status = response?.status

  if (status === 429) {
    return 'Too many attempts. Please try again later.'
  }

  if (typeof status === 'number' && status >= 500) {
    return `Sign-in services are temporarily unavailable (HTTP ${status}). Please try again.`
  }

  if (typeof status === 'number' && status > 0) {
    return `${UNEXPECTED_RESPONSE_MESSAGE} (HTTP ${status})`
  }

  return UNEXPECTED_RESPONSE_MESSAGE
}

async function readAuthResponse(response) {
  const body = await readJson(response)

  if (!response.ok || !isAuthUser(body?.user)) {
    const error = new Error(readMessage(body, response))

    if (typeof body?.code === 'string' && body.code) {
      error.code = body.code
    }

    error.status = response.status
    throw error
  }

  return body.user
}

function isAuthUser(value) {
  if (typeof value !== 'object' || value === null) return false

  return (
    typeof value.id === 'string' &&
    typeof value.email === 'string' &&
    typeof value.display_name === 'string' &&
    (typeof value.avatar_url === 'string' || value.avatar_url === null) &&
    (value.language === 'en' || value.language === 'km')
  )
}

const ENV_GOOGLE_CLIENT_ID =
  typeof import.meta.env?.VITE_GOOGLE_CLIENT_ID === 'string' && import.meta.env.VITE_GOOGLE_CLIENT_ID
    ? import.meta.env.VITE_GOOGLE_CLIENT_ID
    : null

// Let the UI initialize Google Sign-In from the public build-time value while
// the runtime config request is still in flight. The server response remains
// authoritative when it becomes available.
export function getInitialGoogleClientId() {
  return ENV_GOOGLE_CLIENT_ID
}

// A Facebook app id is numeric; an app secret is not. Rejecting anything else
// keeps a misconfigured API (or build) from passing a secret to the SDK.
const FACEBOOK_APP_ID_PATTERN = /^\d{1,21}$/

function readConfigString(value) {
  return typeof value === 'string' && value ? value : null
}

function readFacebookAppId(value) {
  const appId = readConfigString(value)?.trim()

  return appId && FACEBOOK_APP_ID_PATTERN.test(appId) ? appId : null
}

const ENV_FACEBOOK_APP_ID = readFacebookAppId(
  import.meta.env?.VITE_FACEBOOK_APP_ID,
)

// Provider ids are public and the sign-in buttons must still render when the
// config request cannot reach the API (cold start, network hiccup, split
// frontend/API hosts), so fall back to the build-time values.
export async function getAuthConfig() {
  try {
    const response = await fetch(apiUrl('/api/auth/config'), {
      ...API_REQUEST_OPTIONS,
      headers: { Accept: 'application/json' },
    })
    const body = await readJson(response)

    if (!response.ok) {
      throw new Error(readMessage(body, response))
    }

    return {
      googleClientId: readConfigString(body?.googleClientId) ?? ENV_GOOGLE_CLIENT_ID,
      facebookAppId: readFacebookAppId(body?.facebookAppId) ?? ENV_FACEBOOK_APP_ID,
      telegramBotUsername: readConfigString(body?.telegramBotUsername),
    }
  } catch {
    return {
      googleClientId: ENV_GOOGLE_CLIENT_ID,
      facebookAppId: ENV_FACEBOOK_APP_ID,
      telegramBotUsername: null,
    }
  }
}

export async function getCurrentUser() {
  const response = await fetch(apiUrl('/api/auth/me'), {
    ...API_REQUEST_OPTIONS,
    headers: { Accept: 'application/json' },
  })

  if (response.status === 401) return null

  const body = await readJson(response)

  if (!response.ok || !isAuthUser(body?.user)) {
    throw new Error(readMessage(body, response))
  }

  return body.user
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isForeignRedirect(response, endpoint) {
  if (!response.redirected || !response.url) return false
  if (typeof window === 'undefined') return false

  try {
    const expectedOrigin = new URL(endpoint, window.location.href).origin
    return new URL(response.url).origin !== expectedOrigin
  } catch {
    return false
  }
}

async function sendGoogleLogin(credential, language, endpoint) {
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    GOOGLE_REQUEST_TIMEOUT_MS,
  )

  console.info('[google-signin]', 'api.login.request', {
    endpoint,
    language,
    hasCredential: Boolean(credential),
    timeoutMs: GOOGLE_REQUEST_TIMEOUT_MS,
  })

  try {
    const response = await fetch(endpoint, {
      ...API_REQUEST_OPTIONS,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ credential, language }),
      signal: controller.signal,
    })

    console.info('[google-signin]', 'api.login.response', {
      status: response.status,
      ok: response.ok,
      redirected: response.redirected,
      url: response.url,
    })

    return response
  } catch (error) {
    if (error?.name === 'AbortError') {
      console.info('[google-signin]', 'api.login.timeout')
      throw new Error('Google sign-in timed out. Please try again.')
    }

    console.info('[google-signin]', 'api.login.network_error', {
      message: error?.message,
      name: error?.name,
    })

    const networkError = new Error(
      'Unable to reach the sign-in service. Check your connection and try again.',
    )
    networkError.retryable = true
    throw networkError
  } finally {
    clearTimeout(timer)
  }
}

export async function loginWithGoogle(credential, language) {
  const endpoint = apiUrl('/api/auth/google')
  let lastError

  for (let attempt = 1; attempt <= GOOGLE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await sendGoogleLogin(credential, language, endpoint)

      if (isForeignRedirect(response, endpoint)) {
        const blockedError = new Error(BLOCKED_REDIRECT_MESSAGE)
        blockedError.retryable = true

        console.info('[google-signin]', 'api.login.blocked_redirect', {
          attempt,
          url: response.url,
        })

        throw blockedError
      }

      if (response.status >= 500 && attempt < GOOGLE_MAX_ATTEMPTS) {
        await response.text().catch(() => {})

        console.info('[google-signin]', 'api.login.retry', {
          attempt,
          reason: 'server_error',
          status: response.status,
        })

        await wait(GOOGLE_RETRY_DELAY_MS)
        continue
      }

      try {
        const user = await readAuthResponse(response)
        console.info('[google-signin]', 'api.login.parsed', {
          userId: user?.id,
        })
        return user
      } catch (error) {
        console.info('[google-signin]', 'api.login.rejected', {
          status: response.status,
          message: error?.message,
        })
        throw error
      }
    } catch (error) {
      lastError = error

      if (error?.retryable === true && attempt < GOOGLE_MAX_ATTEMPTS) {
        console.info('[google-signin]', 'api.login.retry', {
          attempt,
          reason: 'network_error',
        })

        await wait(GOOGLE_RETRY_DELAY_MS)
        continue
      }

      throw error
    }
  }

  throw lastError
}

export async function linkGoogleAccount(credential) {
  const response = await fetch(apiUrl('/api/auth/link/google'), {
    ...API_REQUEST_OPTIONS,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ credential }),
  })

  return readAuthResponse(response)
}

export async function loginWithFacebook(accessToken, language) {
  const response = await fetch(apiUrl('/api/auth/facebook'), {
    ...API_REQUEST_OPTIONS,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accessToken, language }),
  })

  return readAuthResponse(response)
}

export async function linkFacebookAccount(accessToken) {
  const response = await fetch(apiUrl('/api/auth/link/facebook'), {
    ...API_REQUEST_OPTIONS,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accessToken }),
  })

  return readAuthResponse(response)
}

export async function loginWithFacebookCode(code, redirectUri, language) {
  const response = await fetch(apiUrl('/api/auth/facebook/code'), {
    ...API_REQUEST_OPTIONS,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code, redirectUri, language }),
  })

  return readAuthResponse(response)
}

export async function loginWithTelegram(telegramUser, language) {
  const response = await fetch(apiUrl('/api/auth/telegram'), {
    ...API_REQUEST_OPTIONS,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...telegramUser, language }),
  })

  return readAuthResponse(response)
}

export async function requestPhoneCode(phoneNumber) {
  const response = await fetch(apiUrl('/api/auth/phone/request'), {
    ...API_REQUEST_OPTIONS,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ phoneNumber }),
  })
  const body = await readJson(response)

  if (!response.ok) {
    throw new Error(readMessage(body, response))
  }

  return {
    phoneNumber: typeof body?.phoneNumber === 'string' ? body.phoneNumber : phoneNumber,
    devCode: typeof body?.devCode === 'string' ? body.devCode : null,
  }
}

export async function verifyPhoneCode({ phoneNumber, code, language }) {
  const response = await fetch(apiUrl('/api/auth/phone/verify'), {
    ...API_REQUEST_OPTIONS,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ phoneNumber, code, language }),
  })

  return readAuthResponse(response)
}

export async function loginWithEmail({ email, password, language }) {
  const response = await fetch(apiUrl('/api/auth/login'), {
    ...API_REQUEST_OPTIONS,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, language }),
  })

  return readAuthResponse(response)
}

export async function registerWithEmail({ email, password, displayName, language }) {
  const response = await fetch(apiUrl('/api/auth/register'), {
    ...API_REQUEST_OPTIONS,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, displayName, language }),
  })

  return readAuthResponse(response)
}

export async function logout() {
  const response = await fetch(apiUrl('/api/auth/logout'), {
    ...API_REQUEST_OPTIONS,
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  const body = await readJson(response)

  if (!response.ok) {
    throw new Error(readMessage(body, response))
  }
}
