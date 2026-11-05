import assert from 'node:assert/strict'
import { test } from 'node:test'

import bakongKhqr from 'bakong-khqr'
import {
  BakongKhqrError,
  generateBakongKhqr,
} from '../src/payway/bakongKhqr.js'

const { BakongKHQR } = bakongKhqr

function validInput(overrides = {}) {
  return {
    accountId: 'khmerfp@aclb',
    merchantName: 'KhmerFP',
    merchantCity: 'Phnom Penh',
    acquiringBank: 'ACLEDA Bank',
    amount: 25.5,
    currency: 'USD',
    billNumber: 'FPABC123',
    storeLabel: 'KhmerFP',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    ...overrides,
  }
}

test('generates a verifiable dynamic KHQR and its MD5', () => {
  const result = generateBakongKhqr(validInput())

  assert.equal(typeof result.qrString, 'string')
  assert.match(result.qrString, /^000201/)
  assert.match(result.md5, /^[a-f0-9]{32}$/)
  assert.equal(BakongKHQR.verify(result.qrString).isValid, true)
})

test('generates a KHR KHQR', () => {
  const result = generateBakongKhqr(validInput({
    amount: 4000,
    currency: 'KHR',
  }))

  assert.equal(BakongKHQR.verify(result.qrString).isValid, true)
})

test('requires an expiration time for a dynamic QR', () => {
  assert.throws(
    () => generateBakongKhqr(validInput({ expiresAt: undefined })),
    BakongKhqrError,
  )
})

test('rejects more than two USD decimal places', () => {
  assert.throws(
    () => generateBakongKhqr(validInput({ amount: 1.234 })),
    BakongKhqrError,
  )
})

test('requires a Bakong account id and merchant name', () => {
  assert.throws(
    () => generateBakongKhqr(validInput({ accountId: '' })),
    BakongKhqrError,
  )
  assert.throws(
    () => generateBakongKhqr(validInput({ merchantName: '' })),
    BakongKhqrError,
  )
})
