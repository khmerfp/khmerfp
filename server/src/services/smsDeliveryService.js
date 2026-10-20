import { operationalLogger } from '../logging/operationalLogger.js'

const SMS_TIMEOUT_MS = 8000
const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01'
const MOCEAN_API_URL = 'https://rest.moceanapi.com/rest/2/sms'

// Resolve which delivery backend is active. Twilio and MoceanAPI are real SMS
// services (MoceanAPI is Cambodia-native); the generic webhook stays available
// for other gateways, and the console fallback keeps local development working
// without an account.
export function getSmsProvider() {
  if (
    process.env.TWILIO_ACCOUNT_SID
    && process.env.TWILIO_AUTH_TOKEN
    && process.env.TWILIO_FROM_NUMBER
  ) {
    return 'twilio'
  }

  if (process.env.MOCEAN_API_KEY && process.env.MOCEAN_API_SECRET) {
    return 'mocean'
  }

  if (process.env.MOCEAN_API_TOKEN) return 'mocean'

  if (process.env.SMS_API_URL) return 'gateway'

  return 'none'
}

export function isSmsDeliveryConfigured() {
  return getSmsProvider() !== 'none'
}

// Bound every provider call so a slow gateway cannot hold the request open.
async function fetchWithTimeout(url, options) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SMS_TIMEOUT_MS)

  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

// Deliver one message through the Twilio Messages REST API.
async function sendViaTwilio({ to, message }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER

  const url = `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`
  const body = new URLSearchParams({
    To: to,
    From: from,
    Body: message,
  })

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64')

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body,
  })

  if (!response.ok) {
    throw new Error(`Twilio responded with ${response.status}.`)
  }

  return { delivered: true, provider: 'twilio' }
}

// Deliver one message through the MoceanAPI SMS REST API.
// Prefers the modern API-token Bearer auth; falls back to the legacy
// key/secret query-string auth. mocean-to must carry the country code with no
// leading plus.
async function sendViaMocean({ to, message }) {
  const apiToken = process.env.MOCEAN_API_TOKEN
  const apiKey = process.env.MOCEAN_API_KEY
  const apiSecret = process.env.MOCEAN_API_SECRET
  const from = process.env.MOCEAN_FROM || process.env.SMS_SENDER || 'AngkorPay'

  const params = new URLSearchParams({
    'mocean-to': to.replace(/^\+/, ''),
    'mocean-from': from,
    'mocean-text': message,
    'mocean-resp-format': 'json',
  })

  const headers = {}

  if (!apiToken) {
    params.set('mocean-api-key', apiKey)
    params.set('mocean-api-secret', apiSecret)
  } else {
    headers.Authorization = `Bearer ${apiToken}`
  }

  const response = await fetchWithTimeout(MOCEAN_API_URL, {
    method: 'POST',
    headers,
    body: params,
  })

  if (!response.ok) {
    throw new Error(`MoceanAPI responded with ${response.status}.`)
  }

  // MoceanAPI returns 202 with a per-message status code. 0 means accepted.
  const payload = await response.json().catch(() => null)
  const result = payload?.messages?.[0]

  if (result && result.status !== 0) {
    throw new Error(
      `MoceanAPI rejected the message (status ${result.status}${result.err_msg ? `: ${result.err_msg}` : ''}).`,
    )
  }

  return { delivered: true, provider: 'mocean' }
}

// Deliver one message through the generic JSON webhook gateway.
async function sendViaGateway({ to, message }) {
  const response = await fetchWithTimeout(process.env.SMS_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.SMS_API_KEY
        ? { Authorization: `Bearer ${process.env.SMS_API_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      to,
      message,
      sender: process.env.SMS_SENDER || undefined,
    }),
  })

  if (!response.ok) {
    throw new Error(`SMS provider responded with ${response.status}.`)
  }

  return { delivered: true, provider: 'gateway' }
}

export async function sendSms({ to, message }) {
  const provider = getSmsProvider()

  if (provider === 'twilio') {
    return sendViaTwilio({ to, message })
  }

  if (provider === 'mocean') {
    return sendViaMocean({ to, message })
  }

  if (provider === 'gateway') {
    return sendViaGateway({ to, message })
  }

  // No provider configured. Never log the code through the redacting logger;
  // the console fallback is an explicit, local-only escape hatch.
  operationalLogger.info('sms.delivery_skipped', {
    reason: 'no SMS provider is configured',
  })

  if (process.env.SMS_DEV_CONSOLE === 'true') {
    console.info(`[sms-dev] to=${to} message=${message}`)
  }

  return { delivered: false, reason: 'not_configured' }
}
