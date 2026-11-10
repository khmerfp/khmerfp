import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  generateStatusAccessToken,
  hashStatusAccessToken,
} from '../src/payway/statusAccessToken.js'

test('generates random browser tokens and stable non-reversible storage hashes', () => {
  const first = generateStatusAccessToken()
  const second = generateStatusAccessToken()

  assert.match(first, /^[A-Za-z0-9_-]{43}$/)
  assert.match(second, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(first, second)
  assert.match(hashStatusAccessToken(first), /^[a-f0-9]{64}$/)
  assert.equal(hashStatusAccessToken(first), hashStatusAccessToken(first))
  assert.notEqual(hashStatusAccessToken(first), first)
})
