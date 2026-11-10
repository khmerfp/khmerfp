import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BakongApiError,
  BAKONG_CHECK_TRANSACTION_PATH,
  BAKONG_RENEW_TOKEN_PATH,
  createBakongClient,
  decodeJwtExpiry,
  normalizeCheckTransactionResponse,
} from '../src/services/bakongClient.js'

const md5 = 'd60f3db96913029a2af979a1662c1e72'

function config(overrides = {}) {
  return {
    environment: 'sit',
    paymentsEnabled: true,
    endpoints: { baseUrl: 'https://bakong.test' },
    credentials: { apiToken: 'test-token', email: undefined },
    merchant: {
      accountId: 'khmerfp@aclb',
      name: 'KhmerFP',
      city: 'Phnom Penh',
      acquiringBank: undefined,
    },
    qr: { currency: 'USD', expireMinutes: 5 },
    timeoutMs: 5000,
    ...overrides,
  }
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

test('normalizes a successful check_transaction_by_md5 response', () => {
  const result = normalizeCheckTransactionResponse({
    responseCode: 0,
    responseMessage: 'Getting transaction successfully.',
    data: {
      hash: 'abc',
      fromAccountId: 'customer@aclb',
      toAccountId: 'khmerfp@aclb',
      currency: 'usd',
      amount: 25.5,
      description: 'top up',
    },
  })

  assert.equal(result.found, true)
  assert.deepEqual(result.transaction, {
    hash: 'abc',
    fromAccountId: 'customer@aclb',
    toAccountId: 'khmerfp@aclb',
    amount: 25.5,
    currency: 'USD',
    description: 'top up',
  })
})

test('treats a non-zero response code as not found', () => {
  const result = normalizeCheckTransactionResponse({
    responseCode: 1,
    errorCode: 1,
    responseMessage: 'Transaction could not be found.',
    data: null,
  })

  assert.equal(result.found, false)
  assert.equal(result.responseCode, 1)
  assert.equal(result.errorCode, 1)
  assert.equal(result.transaction, null)
})

test('raises a rate limited error when the daily quota is exceeded', async () => {
  const client = createBakongClient({
    config: config(),
    transport: async () => jsonResponse({
      responseCode: 1,
      errorCode: 17,
      responseMessage: 'Daily request limit of 100 exceeded.',
      data: null,
    }),
  })

  await assert.rejects(
    () => client.checkTransactionByMd5(md5),
    (error) => error instanceof BakongApiError
      && error.code === 'RATE_LIMITED',
  )
})

test('treats a not found response as pending rather than an error', async () => {
  const client = createBakongClient({
    config: config(),
    transport: async () => jsonResponse({
      responseCode: 1,
      errorCode: 1,
      responseMessage: 'Transaction could not be found.',
      data: null,
    }),
  })

  const result = await client.checkTransactionByMd5(md5)

  assert.equal(result.found, false)
  assert.equal(result.errorCode, 1)
})

test('treats malformed or incomplete data as not found', () => {
  assert.equal(normalizeCheckTransactionResponse(null).found, false)
  assert.equal(normalizeCheckTransactionResponse({ data: null }).found, false)
  assert.equal(
    normalizeCheckTransactionResponse({
      responseCode: 0,
      data: { amount: 'abc', currency: 'USD' },
    }).found,
    false,
  )
})

test('sends an authenticated check_transaction_by_md5 request', async () => {
  const requests = []
  const client = createBakongClient({
    config: config(),
    transport: async (url, options) => {
      requests.push({ url, options })
      return jsonResponse({
        responseCode: 0,
        data: {
          hash: 'abc',
          fromAccountId: 'customer@aclb',
          toAccountId: 'khmerfp@aclb',
          currency: 'USD',
          amount: 25.5,
        },
      })
    },
  })

  const result = await client.checkTransactionByMd5(md5)

  assert.equal(result.found, true)
  assert.equal(requests.length, 1)
  assert.equal(
    requests[0].url,
    `https://bakong.test${BAKONG_CHECK_TRANSACTION_PATH}`,
  )
  assert.equal(requests[0].options.method, 'POST')
  assert.equal(
    requests[0].options.headers.Authorization,
    'Bearer test-token',
  )
  assert.deepEqual(JSON.parse(requests[0].options.body), { md5 })
})

test('renews a token from the registered email when no token is configured', async () => {
  const requests = []
  const client = createBakongClient({
    config: config({
      credentials: { apiToken: undefined, email: 'payangsanok@gmail.com' },
    }),
    transport: async (url, options) => {
      requests.push({ url, options })

      if (url.endsWith(BAKONG_RENEW_TOKEN_PATH)) {
        return jsonResponse({
          responseCode: 0,
          data: { token: 'renewed-token' },
        })
      }

      return jsonResponse({
        responseCode: 1,
        errorCode: 1,
        data: null,
      })
    },
  })

  await client.checkTransactionByMd5(md5)

  assert.equal(requests.length, 2)
  assert.equal(
    requests[0].url,
    `https://bakong.test${BAKONG_RENEW_TOKEN_PATH}`,
  )
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    email: 'payangsanok@gmail.com',
  })
  assert.equal(
    requests[1].options.headers.Authorization,
    'Bearer renewed-token',
  )
})

test('renews once and retries after an unauthorized response', async () => {
  const requests = []
  let checkCount = 0
  const client = createBakongClient({
    config: config({
      credentials: { apiToken: 'expired-token', email: 'owner@example.com' },
    }),
    transport: async (url, options) => {
      requests.push({ url, options })

      if (url.endsWith(BAKONG_RENEW_TOKEN_PATH)) {
        return jsonResponse({
          responseCode: 0,
          data: { token: 'renewed-token' },
        })
      }

      checkCount += 1
      if (checkCount === 1) {
        return jsonResponse({}, { ok: false, status: 401 })
      }

      return jsonResponse({
        responseCode: 1,
        errorCode: 1,
        data: null,
      })
    },
  })

  const result = await client.checkTransactionByMd5(md5)

  assert.equal(result.found, false)
  assert.equal(requests.length, 3)
  assert.equal(
    requests[1].url,
    `https://bakong.test${BAKONG_RENEW_TOKEN_PATH}`,
  )
  assert.equal(
    requests[2].options.headers.Authorization,
    'Bearer renewed-token',
  )
})

test('rejects an invalid md5 before any request', async () => {
  const client = createBakongClient({
    config: config(),
    transport: async () => {
      throw new Error('should not be called')
    },
  })

  await assert.rejects(
    () => client.checkTransactionByMd5('not-an-md5'),
    TypeError,
  )
})

test('reports missing configuration without a token or email', async () => {
  const client = createBakongClient({
    config: config({
      credentials: { apiToken: undefined, email: undefined },
    }),
    transport: async () => {
      throw new Error('should not be called')
    },
  })

  await assert.rejects(
    () => client.checkTransactionByMd5(md5),
    (error) => error instanceof BakongApiError
      && error.code === 'MISSING_CONFIGURATION',
  )
})

test('decodes JWT expiry and ignores malformed tokens', () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1700000000 }))
    .toString('base64url')

  assert.equal(
    decodeJwtExpiry(`header.${payload}.signature`),
    1700000000 * 1000,
  )
  assert.equal(decodeJwtExpiry('not-a-jwt'), null)
  assert.equal(decodeJwtExpiry('a.b.c'), null)
  assert.equal(decodeJwtExpiry(undefined), null)
})
