import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createOperationalLogger,
  redactTransactionId,
  sanitizeLogFields,
} from '../src/logging/operationalLogger.js'

test('redacts transaction ids and drops sensitive metadata', () => {
  assert.equal(redactTransactionId('12345678901234567890'), '***7890')
  assert.deepEqual(sanitizeLogFields({
    transactionId: '12345678901234567890',
    code: 'PAYMENT_UNVERIFIED',
    requestId: 'request-id-123',
    name: 'Fictional Customer',
    accountNumber: '00001234',
    apiKey: 'fictional-secret',
    signature: 'fictional-signature',
    payload: { private: true },
  }), {
    transactionId: '***7890',
    code: 'PAYMENT_UNVERIFIED',
    requestId: 'request-id-123',
  })
})

test('writes one structured event without secret values', () => {
  const records = []
  const logger = createOperationalLogger({
    info: (record) => records.push(record),
  })

  logger.info('callback.handled', {
    requestId: 'request-id-123',
    transactionId: '12345678901234567890',
    outcome: 'PAID',
    apiKey: 'fictional-secret',
  })

  assert.equal(records.length, 1)
  const record = JSON.parse(records[0])
  assert.equal(record.event, 'callback.handled')
  assert.equal(record.requestId, 'request-id-123')
  assert.equal(record.transactionId, '***7890')
  assert.equal(record.outcome, 'PAID')
  assert.equal(JSON.stringify(record).includes('fictional-secret'), false)
})

test('drops malformed request ids from logs', () => {
  assert.deepEqual(sanitizeLogFields({ requestId: 'bad\r\nvalue' }), {})
})
