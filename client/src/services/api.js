const UNEXPECTED_RESPONSE_MESSAGE = 'The server returned an unexpected response.'

// read a json response safely
async function readJson(response) {
  try {
    return await response.json()
  } catch {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }
}

// request the backend health state
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

// send details for server validation
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

// prepare one sandbox checkout
export async function prepareSandboxCheckout(details) {
  const response = await fetch('/api/payments/checkout/prepare', {
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

  if (!body.checkout?.action || !body.checkout?.fields) {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }

  return { ok: true, checkout: body.checkout }
}

// list the hosted checkout fields once
export function getHostedCheckoutEntries(checkout) {
  return Object.entries(checkout.fields)
}

// submit the hosted checkout form
export function submitHostedCheckout(checkout) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = checkout.action
  form.enctype = 'multipart/form-data'

  for (const [name, value] of getHostedCheckoutEntries(checkout)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.append(input)
  }

  document.body.append(form)
  form.submit()
  form.remove()
}

// choose a safe api error message
export function getApiErrorMessage(error) {
  return error instanceof Error && error.message === UNEXPECTED_RESPONSE_MESSAGE
    ? error.message
    : 'Unable to reach the server. Check the connection and try again.'
}
