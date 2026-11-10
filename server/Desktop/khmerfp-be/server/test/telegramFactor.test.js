import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import {
  FactorVerificationError,
  computeTelegramAuthHash,
  verifyTelegramLogin,
} from '../src/services/telegramFactorService.js'

const TEST_BOT_TOKEN = '123456:TEST-token-for-hashing-only'

// build a payload whose hash matches the given token, like the real widget
function signedPayload(overrides = {}) {
  const base = {
    id: 987654321,
    first_name: 'Sokha',
    username: 'sokha_kh',
    auth_date: Math.floor(Date.now() / 1000) - 30,
    ...overrides,
  }

  return {
    ...base,
    hash: computeTelegramAuthHash(TEST_BOT_TOKEN, base),
  }
}

test('computeTelegramAuthHash matches an independent hmac construction', () => {
  const payload = { id: 1, auth_date: 1700000000, first_name: 'A', hash: 'skip' }
  const secret = createHmac('sha256', 'WebAppData').update(TEST_BOT_TOKEN).digest()
  const dataCheckString = 'auth_date=1700000000\nfirst_name=A\nid=1'
  const expected = createHmac('sha256', secret).update(dataCheckString).digest('hex')

  assert.equal(computeTelegramAuthHash(TEST_BOT_TOKEN, payload), expected)
})

test('verifyTelegramLogin accepts a freshly signed payload', () => {
  const verified = verifyTelegramLogin(signedPayload(), {
    botToken: TEST_BOT_TOKEN,
  })

  assert.equal(verified.telegramId, '987654321')
  assert.equal(verified.displayName, 'Sokha')
  assert.equal(verified.username, 'sokha_kh')
})

test('verifyTelegramLogin rejects a tampered payload field', () => {
  const payload = signedPayload()

  assert.throws(
    () => verifyTelegramLogin({ ...payload, id: 111 }, { botToken: TEST_BOT_TOKEN }),
    FactorVerificationError,
  )
})

test('verifyTelegramLogin rejects a hash signed with the wrong bot token', () => {
  const payload = signedPayload()
  const wrongSecretPayload = {
    ...payload,
    hash: computeTelegramAuthHash('999999:wrong-token', payload),
  }

  assert.throws(
    () => verifyTelegramLogin(wrongSecretPayload, { botToken: TEST_BOT_TOKEN }),
    /signature is invalid/,
  )
})

test('verifyTelegramLogin rejects an expired auth_date', () => {
  const stale = signedPayload({
    auth_date: Math.floor(Date.now() / 1000) - 3600,
  })

  assert.throws(
    () => verifyTelegramLogin(stale, { botToken: TEST_BOT_TOKEN }),
    /expired/,
  )
})

test('verifyTelegramLogin rejects a far-future auth_date', () => {
  const future = signedPayload({
    auth_date: Math.floor(Date.now() / 1000) + 3600,
  })

  assert.throws(
    () => verifyTelegramLogin(future, { botToken: TEST_BOT_TOKEN }),
    /expired/,
  )
})

test('verifyTelegramLogin rejects malformed payloads before hashing', () => {
  for (const payload of [
    null,
    undefined,
    'string',
    {},
    { id: 'abc', auth_date: 1, hash: 'a'.repeat(64) },
    { id: 1, auth_date: 'soon', hash: 'a'.repeat(64) },
    { id: 1, auth_date: 1, hash: 'not-hex' },
  ]) {
    assert.throws(
      () => verifyTelegramLogin(payload, { botToken: TEST_BOT_TOKEN }),
      FactorVerificationError,
    )
  }
})
