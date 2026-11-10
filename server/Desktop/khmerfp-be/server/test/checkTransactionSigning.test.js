import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildCheckTransactionSigningInput,
  CHECK_TRANSACTION_SIGNING_FIELDS,
  signCheckTransaction,
} from '../src/payway/checkTransactionSigning.js'

const fields = Object.freeze({
  req_time: '20260921123456',
  merchant_id: 'fictional-merchant',
  tran_id: '00012345678901234567',
})

test('uses the documented check transaction signing order', () => {
  assert.deepEqual(CHECK_TRANSACTION_SIGNING_FIELDS, [
    'req_time',
    'merchant_id',
    'tran_id',
  ])
  assert.equal(
    buildCheckTransactionSigningInput(fields),
    '20260921123456fictional-merchant00012345678901234567',
  )
})

test('matches an independently generated fictional check signature', () => {
  assert.equal(
    signCheckTransaction(fields, 'fictional-public-key'),
    'QcUIFlk2mwdMVZeh5Lukoie5oO+zyMsw/n6ErtE9dwkihhrzQZCkQ7cf4JtqgYICwircvqtrwCK0Y3/G0QveTA==',
  )
})

test('keeps check signing separate from purchase fields', () => {
  assert.equal(
    signCheckTransaction({ ...fields, amount: '2000' }, 'fictional-public-key'),
    signCheckTransaction(fields, 'fictional-public-key'),
  )
})
