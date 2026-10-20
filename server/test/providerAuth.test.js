import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hashOtpCode,
  normalizePhoneNumber,
} from '../src/services/phoneAuthService.js'
import {
  verifyFacebookAccessToken,
} from '../src/services/facebookAuthService.js'
import { computeTelegramAuthHash } from '../src/services/telegramFactorService.js'
import { signInWithTelegram } from '../src/services/telegramLoginService.js'
import {
  getSmsProvider,
  isSmsDeliveryConfigured,
  sendSms,
} from '../src/services/smsDeliveryService.js'

test('normalizePhoneNumber keeps an explicit country code and strips separators', () => {
  assert.equal(normalizePhoneNumber('+855 12 345 678'), '+85512345678')
  assert.equal(normalizePhoneNumber('+1 (555) 010-9999'), '+15550109999')
})

test('normalizePhoneNumber rejects numbers without a country code', () => {
  assert.equal(normalizePhoneNumber('012345678'), null)
  assert.equal(normalizePhoneNumber(''), null)
  assert.equal(normalizePhoneNumber(null), null)
  assert.equal(normalizePhoneNumber('+1'), null)
  assert.equal(normalizePhoneNumber('+1234567890123456'), null)
})

test('hashOtpCode is a stable sha256 hex digest and never the raw code', () => {
  const hash = hashOtpCode('123456')

  assert.match(hash, /^[a-f0-9]{64}$/)
  assert.equal(hash, hashOtpCode('123456'))
  assert.notEqual(hash, hashOtpCode('123457'))
  assert.notEqual(hash, '123456')
})

test('verifyFacebookAccessToken rejects a missing or invalid token', async () => {
  await assert.rejects(
    () => verifyFacebookAccessToken(''),
    /access token is required/,
  )
})

test('verifyFacebookAccessToken requires app credentials before any network call', async () => {
  const previousId = process.env.FACEBOOK_APP_ID
  const previousSecret = process.env.FACEBOOK_APP_SECRET

  delete process.env.FACEBOOK_APP_ID
  delete process.env.FACEBOOK_APP_SECRET

  try {
    await assert.rejects(
      () => verifyFacebookAccessToken('some-token'),
      /FACEBOOK_APP_ID and FACEBOOK_APP_SECRET/,
    )
  } finally {
    process.env.FACEBOOK_APP_ID = previousId
    process.env.FACEBOOK_APP_SECRET = previousSecret
  }
})

test('verifyFacebookAccessToken accepts a token whose app and validity match', async () => {
  const previousId = process.env.FACEBOOK_APP_ID
  const previousSecret = process.env.FACEBOOK_APP_SECRET
  const previousFetch = globalThis.fetch

  process.env.FACEBOOK_APP_ID = '1234567890'
  process.env.FACEBOOK_APP_SECRET = 'test-secret'

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { data: { is_valid: true, app_id: '1234567890', user_id: '42' } }
    },
  })

  try {
    assert.equal(await verifyFacebookAccessToken('valid-token'), '42')
  } finally {
    globalThis.fetch = previousFetch
    process.env.FACEBOOK_APP_ID = previousId
    process.env.FACEBOOK_APP_SECRET = previousSecret
  }
})

test('verifyFacebookAccessToken rejects a token issued for another app', async () => {
  const previousId = process.env.FACEBOOK_APP_ID
  const previousSecret = process.env.FACEBOOK_APP_SECRET
  const previousFetch = globalThis.fetch

  process.env.FACEBOOK_APP_ID = '1234567890'
  process.env.FACEBOOK_APP_SECRET = 'test-secret'

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { data: { is_valid: true, app_id: '9999999999', user_id: '42' } }
    },
  })

  try {
    await assert.rejects(
      () => verifyFacebookAccessToken('foreign-token'),
      /issued for another app/,
    )
  } finally {
    globalThis.fetch = previousFetch
    process.env.FACEBOOK_APP_ID = previousId
    process.env.FACEBOOK_APP_SECRET = previousSecret
  }
})

test('verifyFacebookAccessToken rejects an invalid token', async () => {
  const previousId = process.env.FACEBOOK_APP_ID
  const previousSecret = process.env.FACEBOOK_APP_SECRET
  const previousFetch = globalThis.fetch

  process.env.FACEBOOK_APP_ID = '1234567890'
  process.env.FACEBOOK_APP_SECRET = 'test-secret'

  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { data: { is_valid: false } }
    },
  })

  try {
    await assert.rejects(
      () => verifyFacebookAccessToken('bad-token'),
      /invalid or expired/,
    )
  } finally {
    globalThis.fetch = previousFetch
    process.env.FACEBOOK_APP_ID = previousId
    process.env.FACEBOOK_APP_SECRET = previousSecret
  }
})

test('signInWithTelegram rejects a malformed payload before touching the database', async () => {
  const previousToken = process.env.TELEGRAM_BOT_TOKEN

  process.env.TELEGRAM_BOT_TOKEN = '123456:test-token'

  try {
    await assert.rejects(
      () => signInWithTelegram({ id: 1, auth_date: 1, hash: 'not-hex' }, {}),
      /malformed|signature|Telegram/,
    )
  } finally {
    process.env.TELEGRAM_BOT_TOKEN = previousToken
  }
})

test('computeTelegramAuthHash produces the widget signature used by sign-in', () => {
  const token = '123456:test-token'
  const payload = { id: 1, auth_date: 1700000000, first_name: 'A' }
  const hash = computeTelegramAuthHash(token, payload)

  assert.match(hash, /^[a-f0-9]{64}$/)
})

const MOCEAN_URL = 'https://rest.moceanapi.com/rest/2/sms'

// snapshot and restore the SMS-related environment for isolation
function withSmsEnv(values, run) {
  const keys = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
    'MOCEAN_API_KEY',
    'MOCEAN_API_SECRET',
    'MOCEAN_API_TOKEN',
    'MOCEAN_FROM',
    'SMS_API_URL',
    'SMS_API_KEY',
    'SMS_SENDER',
    'SMS_DEV_CONSOLE',
  ]
  const previous = {}

  for (const key of keys) {
    previous[key] = process.env[key]
    if (key in values) {
      if (values[key] === undefined) delete process.env[key]
      else process.env[key] = values[key]
    } else {
      delete process.env[key]
    }
  }

  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const key of keys) {
        if (previous[key] === undefined) delete process.env[key]
        else process.env[key] = previous[key]
      }
    })
}

test('getSmsProvider selects twilio when fully configured', async () => {
  await withSmsEnv(
    {
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'token',
      TWILIO_FROM_NUMBER: '+15005550006',
    },
    () => {
      assert.equal(getSmsProvider(), 'twilio')
      assert.equal(isSmsDeliveryConfigured(), true)
    },
  )
})

test('getSmsProvider selects mocean when only MoceanAPI is configured', async () => {
  await withSmsEnv(
    { MOCEAN_API_KEY: 'key', MOCEAN_API_SECRET: 'secret' },
    () => {
      assert.equal(getSmsProvider(), 'mocean')
      assert.equal(isSmsDeliveryConfigured(), true)
    },
  )
})

test('getSmsProvider prefers twilio over mocean when both are set', async () => {
  await withSmsEnv(
    {
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'token',
      TWILIO_FROM_NUMBER: '+15005550006',
      MOCEAN_API_KEY: 'key',
      MOCEAN_API_SECRET: 'secret',
    },
    () => {
      assert.equal(getSmsProvider(), 'twilio')
    },
  )
})

test('getSmsProvider falls back to the gateway then none', async () => {
  await withSmsEnv({ SMS_API_URL: 'https://sms.example/send' }, () => {
    assert.equal(getSmsProvider(), 'gateway')
  })

  await withSmsEnv({}, () => {
    assert.equal(getSmsProvider(), 'none')
    assert.equal(isSmsDeliveryConfigured(), false)
  })
})

test('sendSms posts a form-encoded Twilio message with basic auth', async () => {
  const previousFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 201 }
  }

  await withSmsEnv(
    {
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'secret-token',
      TWILIO_FROM_NUMBER: '+15005550006',
    },
    async () => {
      const result = await sendSms({ to: '+85512345678', message: 'code 123456' })

      assert.deepEqual(result, { delivered: true, provider: 'twilio' })
      assert.equal(calls.length, 1)
      assert.match(calls[0].url, /Accounts\/AC123\/Messages\.json$/)
      assert.match(calls[0].options.headers.Authorization, /^Basic /)
      assert.equal(
        calls[0].options.headers['Content-Type'],
        'application/x-www-form-urlencoded',
      )
      assert.equal(calls[0].options.body.get('To'), '+85512345678')
      assert.equal(calls[0].options.body.get('From'), '+15005550006')
      assert.equal(calls[0].options.body.get('Body'), 'code 123456')
    },
  )
    .finally(() => {
      globalThis.fetch = previousFetch
    })
})

test('sendSms calls the MoceanAPI REST endpoint with credentials and bare number', async () => {
  const previousFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      status: 202,
      json: async () => ({ messages: [{ status: 0, receiver: '85512345678' }] }),
    }
  }

  await withSmsEnv(
    {
      MOCEAN_API_KEY: 'key',
      MOCEAN_API_SECRET: 'secret',
      MOCEAN_FROM: 'AngkorPay',
    },
    async () => {
      const result = await sendSms({ to: '+85512345678', message: 'code 123456' })

      assert.deepEqual(result, { delivered: true, provider: 'mocean' })
      assert.equal(calls.length, 1)
      assert.equal(calls[0].url, MOCEAN_URL)
      assert.equal(calls[0].options.method, 'POST')

      const body = calls[0].options.body
      assert.equal(body.get('mocean-api-key'), 'key')
      assert.equal(body.get('mocean-api-secret'), 'secret')
      assert.equal(body.get('mocean-to'), '85512345678')
      assert.equal(body.get('mocean-from'), 'AngkorPay')
      assert.equal(body.get('mocean-text'), 'code 123456')
      assert.equal(body.get('mocean-resp-format'), 'json')
    },
  )
    .finally(() => {
      globalThis.fetch = previousFetch
    })
})

test('sendSms uses a Bearer token for MoceanAPI when an API token is set', async () => {
  const previousFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      status: 202,
      json: async () => ({ messages: [{ status: 0 }] }),
    }
  }

  await withSmsEnv({ MOCEAN_API_TOKEN: 'token-123' }, async () => {
    const result = await sendSms({ to: '+85512345678', message: 'code' })

    assert.deepEqual(result, { delivered: true, provider: 'mocean' })
    assert.equal(calls[0].options.headers.Authorization, 'Bearer token-123')
    assert.equal(calls[0].options.body.get('mocean-api-key'), null)
  })
    .finally(() => {
      globalThis.fetch = previousFetch
    })
})

test('sendSms surfaces a MoceanAPI per-message error status', async () => {
  const previousFetch = globalThis.fetch

  globalThis.fetch = async () => ({
    ok: true,
    status: 202,
    json: async () => ({
      messages: [{ status: 2, err_msg: 'Insufficient balance' }],
    }),
  })

  await withSmsEnv({ MOCEAN_API_TOKEN: 'token-123' }, async () => {
    await assert.rejects(
      () => sendSms({ to: '+85512345678', message: 'code' }),
      /MoceanAPI rejected the message \(status 2: Insufficient balance\)/,
    )
  })
    .finally(() => {
      globalThis.fetch = previousFetch
    })
})

test('sendSms throws when the provider rejects the message', async () => {
  const previousFetch = globalThis.fetch

  globalThis.fetch = async () => ({ ok: false, status: 401 })

  await withSmsEnv(
    {
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'secret-token',
      TWILIO_FROM_NUMBER: '+15005550006',
    },
    async () => {
      await assert.rejects(
        () => sendSms({ to: '+85512345678', message: 'code' }),
        /Twilio responded with 401/,
      )
    },
  )
    .finally(() => {
      globalThis.fetch = previousFetch
    })
})

test('sendSms reports not_configured without a provider', async () => {
  await withSmsEnv({}, async () => {
    const result = await sendSms({ to: '+85512345678', message: 'code' })

    assert.deepEqual(result, { delivered: false, reason: 'not_configured' })
  })
})
