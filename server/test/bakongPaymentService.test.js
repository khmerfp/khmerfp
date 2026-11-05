import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  BakongPaymentNotFoundError,
  BakongPaymentValidationError,
  BakongPaymentsUnavailableError,
  BakongProviderUnavailableError,
  createBakongPayment,
  generateBakongTransactionId,
  getBakongPaymentStatus,
  toMinorUnits,
} from '../src/services/bakongPaymentService.js'
import { hashStatusAccessToken } from '../src/payway/statusAccessToken.js'

const NOW = new Date('2026-11-05T10:00:00.000Z')
const STATUS_TOKEN = 'T'.repeat(43)
const STATUS_TOKEN_HASH = hashStatusAccessToken(STATUS_TOKEN)
const MD5 = 'a'.repeat(32)

function config(overrides = {}) {
  return {
    environment: 'sit',
    paymentsEnabled: true,
    endpoints: { baseUrl: 'https://bakong.test' },
    credentials: { apiToken: 'token', email: undefined },
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

// Minimal in-memory model that mirrors the real conditional update.
function createModel() {
  const store = new Map()

  return {
    store,
    async create(data) {
      if (store.has(data.tranId)) {
        const error = new Error('duplicate')
        error.code = '23505'
        error.constraint = 'bakong_payments_tran_id_key'
        throw error
      }

      const payment = {
        id: String(store.size + 1),
        status: 'PENDING',
        paidAt: null,
        providerEvidence: null,
        ...data,
      }

      store.set(payment.tranId, payment)
      return { ...payment }
    },
    async findByTranId(tranId, options = {}) {
      const payment = store.get(tranId)
      if (!payment) return null

      if (
        options.statusAccessTokenHash !== undefined
        && payment.statusAccessTokenHash !== options.statusAccessTokenHash
      ) {
        return null
      }

      return { ...payment }
    },
    async updateStatus(tranId, updates, options = {}) {
      const payment = store.get(tranId)
      if (!payment) return null
      if (options.expectedStatus && payment.status !== options.expectedStatus) {
        return null
      }

      Object.assign(payment, updates)
      return { ...payment }
    },
  }
}

function deps(overrides = {}) {
  return {
    config: config(),
    now: () => NOW,
    customerName: 'Test Customer',
    transactionIdGenerator: () => 'FP123',
    generateQr: () => ({ qrString: 'qr-string', md5: MD5 }),
    createStatusToken: () => STATUS_TOKEN,
    ...overrides,
  }
}

async function createPayment(overrides = {}) {
  const model = overrides.transactionModel ?? createModel()
  const options = deps({ transactionModel: model, ...overrides })

  return {
    model,
    result: await createBakongPayment({ amount: 25 }, options),
    options,
  }
}

test('generates bounded transaction ids', () => {
  const id = generateBakongTransactionId(() => NOW.getTime())

  assert.match(id, /^FP[0-9A-Z]+$/)
  assert.ok(id.length <= 25)
})

test('stores money as integer minor units', () => {
  assert.equal(toMinorUnits(25.5, 'USD'), 2550)
  assert.equal(toMinorUnits(4000, 'KHR'), 4000)
})

test('refuses to create a payment while disabled', async () => {
  await assert.rejects(
    () => createBakongPayment({ amount: 25 }, deps({
      config: config({ paymentsEnabled: false }),
    })),
    BakongPaymentsUnavailableError,
  )
})

test('rejects invalid payment details before persistence', async () => {
  await assert.rejects(
    () => createBakongPayment({ amount: 0 }, deps()),
    BakongPaymentValidationError,
  )
})

test('creates and persists a pending Bakong payment', async () => {
  const { model, result } = await createPayment()

  assert.equal(result.environment, 'sit')
  assert.equal(result.provider, 'BAKONG')
  assert.equal(result.payment.tranId, 'FP123')
  assert.equal(result.payment.amount, 25)
  assert.equal(result.payment.currency, 'USD')
  assert.equal(result.payment.status, 'PENDING')
  assert.equal(result.payment.qrString, 'qr-string')
  assert.equal(result.payment.md5, MD5)
  assert.deepEqual(result.statusAccess, {
    tranId: 'FP123',
    token: STATUS_TOKEN,
  })

  const stored = model.store.get('FP123')
  assert.equal(stored.statusAccessTokenHash, STATUS_TOKEN_HASH)
  assert.equal(stored.name, 'Test Customer')
  assert.equal(stored.expiresAt.toISOString(), '2026-11-05T10:05:00.000Z')
})

test('retries a transaction id collision with a new QR', async () => {
  const inner = createModel()
  let createAttempts = 0
  const model = {
    ...inner,
    async create(data) {
      createAttempts += 1

      if (createAttempts === 1) {
        const error = new Error('duplicate')
        error.code = '23505'
        error.constraint = 'bakong_payments_tran_id_key'
        throw error
      }

      return inner.create(data)
    },
  }
  const ids = ['FP123', 'FP456']
  const qrCodes = [
    { qrString: 'first', md5: 'a'.repeat(32) },
    { qrString: 'second', md5: 'b'.repeat(32) },
  ]
  let idIndex = 0
  let qrIndex = 0

  const result = await createBakongPayment(
    { amount: 25 },
    deps({
      transactionModel: model,
      transactionIdGenerator: () => ids[idIndex++],
      generateQr: () => qrCodes[qrIndex++],
    }),
  )

  assert.equal(result.payment.tranId, 'FP456')
  assert.equal(result.payment.qrString, 'second')
  assert.equal(inner.store.size, 1)
})

test('rejects an unknown status token', async () => {
  const { model } = await createPayment()

  await assert.rejects(
    () => getBakongPaymentStatus('FP123', 'X'.repeat(43), {
      config: config(),
      transactionModel: model,
      now: () => NOW,
      checkTransaction: async () => ({ found: false }),
    }),
    BakongPaymentNotFoundError,
  )
})

test('keeps a pending payment while Bakong has no transaction', async () => {
  const { model } = await createPayment()
  let checks = 0

  const payment = await getBakongPaymentStatus('FP123', STATUS_TOKEN, {
    config: config(),
    transactionModel: model,
    now: () => NOW,
    checkTransaction: async () => {
      checks += 1
      return { found: false }
    },
  })

  assert.equal(checks, 1)
  assert.equal(payment.status, 'PENDING')
})

test('marks a matching Bakong transaction as paid with evidence', async () => {
  const { model } = await createPayment()
  const verifiedAt = new Date('2026-11-05T10:02:00.000Z')

  const payment = await getBakongPaymentStatus('FP123', STATUS_TOKEN, {
    config: config(),
    transactionModel: model,
    now: () => verifiedAt,
    checkTransaction: async () => ({
      found: true,
      transaction: {
        hash: 'hash-value',
        fromAccountId: 'customer@aclb',
        toAccountId: 'khmerfp@aclb',
        amount: 25,
        currency: 'USD',
        description: 'top up',
      },
    }),
  })

  assert.equal(payment.status, 'PAID')
  assert.equal(payment.paidAt, verifiedAt)

  const stored = model.store.get('FP123')
  assert.equal(stored.providerEvidence.source, 'BAKONG_OPEN_API')
  assert.equal(stored.providerEvidence.checkTransactionHash, 'hash-value')
  assert.equal(stored.providerEvidence.fromAccountId, 'customer@aclb')
})

test('fails a payment whose verified amount or currency does not match', async () => {
  const { model } = await createPayment()

  const payment = await getBakongPaymentStatus('FP123', STATUS_TOKEN, {
    config: config(),
    transactionModel: model,
    now: () => NOW,
    checkTransaction: async () => ({
      found: true,
      transaction: {
        hash: 'hash-value',
        fromAccountId: 'customer@aclb',
        toAccountId: 'khmerfp@aclb',
        amount: 25.01,
        currency: 'USD',
        description: null,
      },
    }),
  })

  assert.equal(payment.status, 'FAILED')
})

test('expires an unpaid QR after its lifetime', async () => {
  const { model } = await createPayment()

  const payment = await getBakongPaymentStatus('FP123', STATUS_TOKEN, {
    config: config(),
    transactionModel: model,
    now: () => new Date('2026-11-05T10:06:00.000Z'),
    checkTransaction: async () => ({ found: false }),
  })

  assert.equal(payment.status, 'EXPIRED')
})

test('expires a payment when verification fails after the QR lifetime', async () => {
  const { model } = await createPayment()

  const payment = await getBakongPaymentStatus('FP123', STATUS_TOKEN, {
    config: config(),
    transactionModel: model,
    now: () => new Date('2026-11-05T10:06:00.000Z'),
    checkTransaction: async () => {
      throw new Error('network down')
    },
  })

  assert.equal(payment.status, 'EXPIRED')
})

test('reports a provider failure while the QR is still valid', async () => {
  const { model } = await createPayment()

  await assert.rejects(
    () => getBakongPaymentStatus('FP123', STATUS_TOKEN, {
      config: config(),
      transactionModel: model,
      now: () => NOW,
      checkTransaction: async () => {
        throw new Error('network down')
      },
    }),
    BakongProviderUnavailableError,
  )
})
