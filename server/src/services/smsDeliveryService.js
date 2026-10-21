import { operationalLogger } from '../logging/operationalLogger.js'

const SMS_TIMEOUT_MS = 8000
const VONAGE_SMS_URL = 'https://rest.nexmo.com/sms/json'
const DEFAULT_VONAGE_SENDER = 'AngkorPay'

// Vonage (formerly Nexmo) is the only SMS provider for this application.
// Credentials are supplied through the environment and are never logged.
export function isVonageConfigured() {
  return Boolean(process.env.VONAGE_API_KEY && process.env.VONAGE_API_SECRET)
}

export function isSmsDeliveryConfigured() {
  return isVonageConfigured()
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

// Deliver one message through the Vonage SMS API.
// The endpoint answers HTTP 200 even for rejections, so the per-message
// status field is the real verdict: "0" means accepted.
async function sendViaVonage({ to, message }) {
  const body = new URLSearchParams({
    api_key: process.env.VONAGE_API_KEY,
    api_secret: process.env.VONAGE_API_SECRET,
    to: to.replace(/^\+/, ''),
    from: process.env.VONAGE_FROM || DEFAULT_VONAGE_SENDER,
    text: message,
  })

  const response = await fetchWithTimeout(VONAGE_SMS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    throw new Error(`Vonage responded with ${response.status}.`)
  }

  const payload = await response.json().catch(() => null)
  const result = payload?.messages?.[0]

  if (!result || String(result.status) !== '0') {
    throw new Error(
      `Vonage rejected the message (status ${result?.status ?? 'unknown'}${result?.['error-text'] ? `: ${result['error-text']}` : ''}).`,
    )
  }

  return { delivered: true, provider: 'vonage' }
}

// Central SMS entry point shared by every SMS-based auth feature.
export async function sendSms({ to, message }) {
  if (!isVonageConfigured()) {
    // Never log the code through the redacting logger.
    operationalLogger.info('sms.delivery_skipped', {
      reason: 'vonage is not configured',
    })

    return { delivered: false, reason: 'not_configured' }
  }

  return sendViaVonage({ to, message })
}
