import { operationalLogger } from '../logging/operationalLogger.js'

const SMS_TIMEOUT_MS = 8000
const MOCEAN_SMS_URL = 'https://rest.moceanapi.com/rest/2/sms'
const DEFAULT_MOCEAN_SENDER = 'AngkorPay'

// Mocean is the SMS provider for this application. The API token is supplied
// through the environment and is never logged.
export function isMoceanConfigured() {
  return Boolean(process.env.MOCEAN_API_TOKEN?.trim())
}

export function isSmsDeliveryConfigured() {
  return isMoceanConfigured()
}

// Bound the provider call so a slow gateway cannot hold the request open.
async function fetchWithTimeout(url, options) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SMS_TIMEOUT_MS)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

// Attach the numeric provider verdict so it can be logged without ever
// including the message text or the OTP code.
function providerError(message, { httpStatus, providerStatus } = {}) {
  const error = new Error(message)
  error.provider = 'mocean'

  if (Number.isFinite(httpStatus)) error.httpStatus = httpStatus
  if (Number.isFinite(providerStatus)) error.providerStatus = providerStatus

  return error
}

// Deliver one message through the Mocean SMS API.
// A success answers HTTP 202, but the per-message status field is the real
// verdict: 0 means accepted.
async function sendViaMocean({ to, message }) {
  const body = new URLSearchParams({
    'mocean-from': process.env.MOCEAN_FROM?.trim() || DEFAULT_MOCEAN_SENDER,
    'mocean-to': to.replace(/^\+/, ''),
    'mocean-text': message,
    'mocean-resp-format': 'json',
  })

  const response = await fetchWithTimeout(MOCEAN_SMS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.MOCEAN_API_TOKEN.trim()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  const payload =
    typeof response.json === 'function'
      ? await response.json().catch(() => null)
      : null
  const result = payload?.messages?.[0]

  if (!response.ok && !result) {
    throw providerError(`Mocean responded with ${response.status}.`, {
      httpStatus: response.status,
    })
  }

  if (!result || Number(result.status) !== 0) {
    throw providerError(
      `Mocean rejected the message (status ${result?.status ?? 'unknown'}${result?.err_msg ? `: ${result.err_msg}` : ''}).`,
      {
        httpStatus: response.status,
        providerStatus: Number(result?.status),
      },
    )
  }

  return { delivered: true, provider: 'mocean' }
}

// Central SMS entry point shared by every SMS-based auth feature.
export async function sendSms({ to, message }) {
  if (!isMoceanConfigured()) {
    // Never log the code through the redacting logger.
    operationalLogger.info('sms.delivery_skipped', {
      provider: 'mocean',
      reason: 'not_configured',
    })

    return { delivered: false, reason: 'not_configured' }
  }

  return sendViaMocean({ to, message })
}
