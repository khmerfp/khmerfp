const UNEXPECTED_RESPONSE_MESSAGE = 'The server returned an unexpected response.'

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

function readConfigString(value) {
  return typeof value === 'string' && value ? value : null
}

export async function getAuthConfig() {
  const response = await fetch('/api/auth/config', {
    headers: { Accept: 'application/json' },
  })
  const body = await readJson(response)

  if (!response.ok) {
    throw new Error(readMessage(body))
  }

  return {
    googleClientId: readConfigString(body.googleClientId) ?? ENV_GOOGLE_CLIENT_ID,
    facebookAppId: readConfigString(body.facebookAppId),
    telegramBotUsername: readConfigString(body.telegramBotUsername),
  }
}

export async function getCurrentUser() {
  const response = await fetch('/api/auth/me', {
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
  const response = await fetch('/api/auth/google', {
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
  const response = await fetch('/api/auth/facebook', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accessToken, language }),
  })

  return readAuthResponse(response)
}

export async function loginWithTelegram(telegramUser, language) {
  const response = await fetch('/api/auth/telegram', {
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
  const response = await fetch('/api/auth/phone/request', {
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
  const response = await fetch('/api/auth/phone/verify', {
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
  const response = await fetch('/api/auth/login', {
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
  const response = await fetch('/api/auth/register', {
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
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  const body = await readJson(response)

  if (!response.ok) {
    throw new Error(readMessage(body))
  }
}

export async function logoutAll() {
  const response = await fetch('/api/auth/logout-all', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  })
  const body = await readJson(response)

  if (!response.ok) {
    throw new Error(readMessage(body))
  }
}
