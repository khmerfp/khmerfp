const UNEXPECTED_RESPONSE_MESSAGE = 'The server returned an unexpected response.'
const API_REQUEST_OPTIONS = { credentials: 'include' }

const API_BASE_URL =
  typeof import.meta.env?.VITE_API_URL === 'string'
    ? import.meta.env.VITE_API_URL.trim().replace(/\/+$/, '')
    : ''

function apiUrl(path) {
  return `${API_BASE_URL}${path}`
}

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }
}

function readMessage(body) {
  return typeof body.message === 'string' && body.message
    ? body.message
    : UNEXPECTED_RESPONSE_MESSAGE
}

async function readAuthResponse(response) {
  const body = await readJson(response)

  if (!response.ok || !isAuthUser(body.user)) {
    throw new Error(readMessage(body))
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

const ENV_FACEBOOK_APP_ID =
  typeof import.meta.env?.VITE_FACEBOOK_APP_ID === 'string' && import.meta.env.VITE_FACEBOOK_APP_ID
    ? import.meta.env.VITE_FACEBOOK_APP_ID
    : null

function readConfigString(value) {
  return typeof value === 'string' && value ? value : null
}

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
      throw new Error(readMessage(body))
    }

    return {
      googleClientId: readConfigString(body.googleClientId) ?? ENV_GOOGLE_CLIENT_ID,
      facebookAppId: readConfigString(body.facebookAppId) ?? ENV_FACEBOOK_APP_ID,
      telegramBotUsername: readConfigString(body.telegramBotUsername),
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

  if (!response.ok || !isAuthUser(body.user)) {
    throw new Error(readMessage(body))
  }

  return body.user
}

export async function loginWithGoogle(credential, language) {
  const response = await fetch(apiUrl('/api/auth/google'), {
    ...API_REQUEST_OPTIONS,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ credential, language }),
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
    throw new Error(readMessage(body))
  }

  return {
    phoneNumber: typeof body.phoneNumber === 'string' ? body.phoneNumber : phoneNumber,
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
    throw new Error(readMessage(body))
  }
}
