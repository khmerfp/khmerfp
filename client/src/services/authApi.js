const UNEXPECTED_RESPONSE_MESSAGE = 'The server returned an unexpected response.'

// read a json response safely
async function readJson(response) {
  try {
    return await response.json()
  } catch {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }
}

// choose a safe message from a failed response
function readMessage(body) {
  return typeof body.message === 'string' && body.message
    ? body.message
    : UNEXPECTED_RESPONSE_MESSAGE
}

// turn a response into a user object or an Error
async function readAuthResponse(response) {
  const body = await readJson(response)

  if (!response.ok || !isAuthUser(body.user)) {
    throw new Error(readMessage(body))
  }

  return body.user
}

// check the shape of a user returned by the auth api
function isAuthUser(value) {
  if (typeof value !== 'object' || value === null) return false

  return (
    typeof value.id === 'string'
    && typeof value.email === 'string'
    && typeof value.display_name === 'string'
    && (typeof value.avatar_url === 'string' || value.avatar_url === null)
    && (value.language === 'en' || value.language === 'km')
  )
}

// read the public auth configuration
export async function getAuthConfig() {
  const response = await fetch('/api/auth/config', {
    headers: { Accept: 'application/json' },
  })
  const body = await readJson(response)

  if (!response.ok) {
    throw new Error(readMessage(body))
  }

  return {
    googleClientId: typeof body.googleClientId === 'string' && body.googleClientId
      ? body.googleClientId
      : null,
    telegramBotUsername:
      typeof body.telegramBotUsername === 'string' && body.telegramBotUsername
        ? body.telegramBotUsername
        : null,
  }
}

// resolve the current session user, or null when signed out
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

// exchange a Google ID token for a session cookie
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

// sign in with an email and password
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

// register a new email/password account and start a session
export async function registerWithEmail({
  email,
  password,
  displayName,
  language,
}) {
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

// revoke the current session and clear the cookie
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

// revoke every session for the signed-in user
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

// read the second-factor enrollment state for the signed-in user
export async function getFactors() {
  const response = await fetch('/api/auth/factors', {
    headers: { Accept: 'application/json' },
  })
  const body = await readJson(response)

  if (!response.ok) {
    throw new Error(readMessage(body))
  }

  return body.factors
}

// enroll the Telegram second factor from a Login Widget payload
export async function enrollTelegram(telegramUser) {
  const response = await fetch('/api/auth/factors/telegram', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(telegramUser),
  })
  const body = await readJson(response)

  if (!response.ok) {
    throw new Error(readMessage(body))
  }

  return body.factors
}

// re-verify the Telegram factor and receive a rotated session cookie
export async function stepUpWithTelegram(telegramUser) {
  const response = await fetch('/api/auth/step-up', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(telegramUser),
  })
  const body = await readJson(response)

  if (!response.ok) {
    throw new Error(readMessage(body))
  }
}
