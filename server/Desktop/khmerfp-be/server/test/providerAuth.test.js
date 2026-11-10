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

// snapshot and restore the SMS-related environment for isolation
function withSmsEnv(values, run) {
  const keys = ['VONAGE_API_KEY', 'VONAGE_API_SECRET', 'VONAGE_FROM']
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

test('isSmsDeliveryConfigured requires the Vonage credential pair', async () => {
  await withSmsEnv(
    { VONAGE_API_KEY: 'key', VONAGE_API_SECRET: 'secret' },
    () => {
      assert.equal(isSmsDeliveryConfigured(), true)
    },
  )

  await withSmsEnv({ VONAGE_API_KEY: 'key' }, () => {
    assert.equal(isSmsDeliveryConfigured(), false)
  })

  await withSmsEnv({}, () => {
    assert.equal(isSmsDeliveryConfigured(), false)
  })
})

test('sendSms posts a form-encoded Vonage message with a bare number', async () => {
  const previousFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ status: '0' }] }),
    }
  }

  await withSmsEnv(
    {
      VONAGE_API_KEY: 'vg-key',
      VONAGE_API_SECRET: 'vg-secret',
      VONAGE_FROM: 'AngkorPay',
    },
    async () => {
      const result = await sendSms({ to: '+85512345678', message: 'code 123456' })

      assert.deepEqual(result, { delivered: true, provider: 'vonage' })
      assert.equal(calls.length, 1)
      assert.equal(calls[0].url, 'https://rest.nexmo.com/sms/json')
      assert.equal(calls[0].options.method, 'POST')
      assert.equal(
        calls[0].options.headers['Content-Type'],
        'application/x-www-form-urlencoded',
      )

      const body = calls[0].options.body
      assert.equal(body.get('api_key'), 'vg-key')
      assert.equal(body.get('api_secret'), 'vg-secret')
      assert.equal(body.get('to'), '85512345678')
      assert.equal(body.get('from'), 'AngkorPay')
      assert.equal(body.get('text'), 'code 123456')
    },
  )
    .finally(() => {
      globalThis.fetch = previousFetch
    })
})

test('sendSms defaults the Vonage sender id when VONAGE_FROM is missing', async () => {
  const previousFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ status: '0' }] }),
    }
  }

  await withSmsEnv(
    { VONAGE_API_KEY: 'key', VONAGE_API_SECRET: 'secret' },
    async () => {
      await sendSms({ to: '+85512345678', message: 'code' })

      assert.equal(calls[0].options.body.get('from'), 'AngkorPay')
    },
  )
    .finally(() => {
      globalThis.fetch = previousFetch
    })
})

test('sendSms surfaces a Vonage per-message error status', async () => {
  const previousFetch = globalThis.fetch

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      messages: [{ status: '3', 'error-text': 'Invalid number' }],
    }),
  })

  await withSmsEnv(
    { VONAGE_API_KEY: 'key', VONAGE_API_SECRET: 'secret' },
    async () => {
      await assert.rejects(
        () => sendSms({ to: '+85512345678', message: 'code' }),
        /Vonage rejected the message \(status 3: Invalid number\)/,
      )
    },
  )
    .finally(() => {
      globalThis.fetch = previousFetch
    })
})

test('sendSms throws when Vonage rejects the request', async () => {
  const previousFetch = globalThis.fetch

  globalThis.fetch = async () => ({ ok: false, status: 401 })

  await withSmsEnv(
    { VONAGE_API_KEY: 'key', VONAGE_API_SECRET: 'secret' },
    async () => {
      await assert.rejects(
        () => sendSms({ to: '+85512345678', message: 'code' }),
        /Vonage responded with 401/,
      )
    },
  )
    .finally(() => {
      globalThis.fetch = previousFetch
    })
})

test('sendSms reports not_configured without calling Vonage when credentials are missing', async () => {
  const previousFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200 }
  }

  await withSmsEnv({}, async () => {
    const result = await sendSms({ to: '+85512345678', message: 'code' })

    assert.deepEqual(result, { delivered: false, reason: 'not_configured' })
    assert.equal(calls.length, 0)
  })
    .finally(() => {
      globalThis.fetch = previousFetch
    })
})

