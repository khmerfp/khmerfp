const UNEXPECTED_RESPONSE_MESSAGE = 'The server returned an unexpected response.'

async function readJson(response) {
  try {
    return await response.json()
  } catch {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }
}

export async function getBackendHealth() {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch('/api/health', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    const body = await readJson(response)
    return response.ok && body.status === 'ok' ? 'connected' : 'unavailable'
  } catch {
    return 'unavailable'
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function validatePaymentDetails(details) {
  const response = await fetch('/api/payments/validate', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(details),
  })
  const body = await readJson(response)

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: body.message,
      errors: body.errors,
    }
  }

  if (body.message !== 'Validation passed. No payment was initiated.') {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }

  return { ok: true }
}

export function getApiErrorMessage(error) {
  return error instanceof Error && error.message === UNEXPECTED_RESPONSE_MESSAGE
    ? error.message
    : 'Unable to reach the server. Check the connection and try again.'
}

