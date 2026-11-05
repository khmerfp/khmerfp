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
  return typeof body?.message === 'string' && body.message
    ? body.message
    : UNEXPECTED_RESPONSE_MESSAGE
}

function isPayment(value) {
  return (
    typeof value === 'object'
    && value !== null
    && typeof value.tranId === 'string'
    && typeof value.amount === 'number'
    && typeof value.currency === 'string'
    && typeof value.status === 'string'
  )
}

// Create a Bakong KHQR payment and return the QR plus its status token.
export async function createBakongPayment({ amount, idempotencyKey }) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }

  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey
  }

  const response = await fetch(apiUrl('/api/payments/bakong'), {
    ...API_REQUEST_OPTIONS,
    method: 'POST',
    headers,
    body: JSON.stringify({ amount }),
  })
  const body = await readJson(response)

  if (
    !response.ok
    || !isPayment(body.payment)
    || typeof body.payment.qrString !== 'string'
    || typeof body.statusAccess?.token !== 'string'
  ) {
    throw new Error(readMessage(body))
  }

  return body
}

// Read the server-verified status of a Bakong payment.
export async function getBakongPaymentStatus(tranId, statusToken) {
  const response = await fetch(
    apiUrl(`/api/payments/bakong/${encodeURIComponent(tranId)}/status`),
    {
      ...API_REQUEST_OPTIONS,
      headers: {
        Accept: 'application/json',
        'X-Payment-Status-Token': statusToken,
      },
    },
  )
  const body = await readJson(response)

  if (!response.ok || !isPayment(body.payment)) {
    throw new Error(readMessage(body))
  }

  return body.payment
}
