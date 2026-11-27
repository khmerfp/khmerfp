import { operationalLogger } from '../logging/operationalLogger.js'
import { sendSms } from './smsDeliveryService.js'

const RESEND_EMAIL_URL = 'https://api.resend.com/emails'

function emailCanReceiveNotice(email) {
  return typeof email === 'string'
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && !email.endsWith('.local')
}

async function sendTelegramNotice(telegramId, message) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  if (!token || !telegramId) return false

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: telegramId, text: message }),
    signal: AbortSignal.timeout(8000),
  })
  return response.ok
}

async function sendEmailNotice(email, message) {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.RESEND_FROM?.trim()
  if (!apiKey || !from || !emailCanReceiveNotice(email)) return false

  const response = await fetch(RESEND_EMAIL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'KhmerFP account verification update',
      text: message,
    }),
    signal: AbortSignal.timeout(8000),
  })
  return response.ok
}

// Try the linked Telegram account, verified phone, then configured email.
export async function notifyIdentityDenial(user, deniedUntil) {
  const time = new Date(deniedUntil).toLocaleString('en-GB', {
    timeZone: 'Asia/Phnom_Penh',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const message = `Your KhmerFP account is temporarily denied after identity verification. You can try again after ${time}.`
  const channels = [
    () => sendTelegramNotice(user.telegram_sub, message),
    () => user.phone_verified_at && user.phone_number
      ? sendSms({ to: user.phone_number, message })
          .then((result) => result.delivered)
      : false,
    () => sendEmailNotice(user.email, message),
  ]

  for (const send of channels) {
    try {
      if (await send()) return true
    } catch {
      // Try the next configured login channel if delivery fails.
    }
  }

  operationalLogger.warn('identity.denial_notice_not_sent', {
    reason: 'no_delivery_channel_available',
  })
  return false
}
