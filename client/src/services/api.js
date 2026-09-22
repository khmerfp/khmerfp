const UNEXPECTED_RESPONSE_MESSAGE = 'The server returned an unexpected response.'

export class PaymentStatusUnavailableError extends Error {
  // identify a rejected protected status lookup
  constructor() {
    super('Payment status is unavailable.')
    this.name = 'PaymentStatusUnavailableError'
  }
}

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

  if (
    !body.checkout?.action
    || !body.checkout?.fields
    || !body.checkout?.statusAccess?.tranId
    || !body.checkout?.statusAccess?.token
  ) {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }

  return { ok: true, checkout: body.checkout }
}

// request one protected payment status
export async function getPaymentStatus(transactionId, token) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(
      `/api/payments/${encodeURIComponent(transactionId)}/status`,
      {
        headers: {
          Accept: 'application/json',
          'X-Payment-Status-Token': token,
        },
        signal: controller.signal,
      },
    )
    const body = await readJson(response)

    if (response.status === 404) {
      throw new PaymentStatusUnavailableError()
    }

    if (!response.ok || !body.payment) {
      throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
    }

    const payment = body.payment
    if (
      payment.tranId !== transactionId
      || !Number.isSafeInteger(payment.amount)
      || payment.currency !== 'KHR'
      || !['PENDING', 'PAID', 'FAILED', 'CANCELLED'].includes(payment.status)
    ) {
      throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
    }

    return payment
  } finally {
    window.clearTimeout(timeout)
  }
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
