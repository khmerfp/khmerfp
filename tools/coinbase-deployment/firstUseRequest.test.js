// test the review-only request format and its safety limits.
﻿import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { prepareWalletManagedFirstUse } from './firstUseRequest.js'
import { guardPreparationProvider } from './connection.js'
const wallet = '0x1111111111111111111111111111111111111111'
const other = '0x2222222222222222222222222222222222222222'
const input = { wallet, expectedWallet: wallet, chainId: 84532 }

test('draft uses one exact zero-value empty-data self-call on Base Sepolia', () => {
  const draft = prepareWalletManagedFirstUse(input)
  assert.equal(draft.executionEnabled, false)
  assert.equal(draft.request.method, 'wallet_sendCalls')
  assert.deepEqual(draft.request.params, [{ version: '1.0', chainId: '0x14a34', from: wallet,
    atomicRequired: true, calls: [{ to: wallet, value: '0x0', data: '0x' }] }])
  assert.equal(draft.feeQuote, null)
  assert.equal(draft.sponsorship, 'UNKNOWN')
  assert.equal(draft.deploymentSupport, 'UNVERIFIED_FOR_THIS_ACCOUNT')
})
test('wrong chain, another account, zero and malformed addresses reject', () => {
  for (const change of [{ chainId: 8453 }, { chainId: 31337 }, { chainId: '84532' }, { expectedWallet: other },
    { wallet: 'not-an-address' }, { wallet: `0x${'0'.repeat(40)}`, expectedWallet: `0x${'0'.repeat(40)}` }]) {
    assert.throws(() => prepareWalletManagedFirstUse({ ...input, ...change }))
  }
})
test('caller cannot add recipients, amounts, approvals, factory data, owners or nonce', () => {
  for (const key of ['calls', 'value', 'capabilities', 'factory', 'factoryData', 'owners', 'nonce', 'signature']) {
    assert.throws(() => prepareWalletManagedFirstUse({ ...input, [key]: 'untrusted' }))
  }
})
test('draft is deeply immutable and cannot silently change call effects', () => {
  const draft = prepareWalletManagedFirstUse(input)
  assert.throws(() => { draft.request.params[0].chainId = '0x2105' })
  assert.throws(() => { draft.request.params[0].calls[0].to = other })
  assert.throws(() => { draft.request.params[0].calls.push({ to: other }) })
})
test('preparation provider still blocks the proposed request before forwarding it', () => {
  let forwarded = 0
  const provider = guardPreparationProvider({ request: () => { forwarded++ } })
  assert.throws(() => provider.request(prepareWalletManagedFirstUse(input).request), /disabled/)
  assert.equal(forwarded, 0)
})
test('draft matches the installed SDK helper envelope without executing the helper', () => {
  const source = readFileSync(new URL('../../node_modules/@base-org/account/dist/sign/base-account/utils.js', import.meta.url), 'utf8')
  assert.match(source, /method: 'wallet_sendCalls'/)
  assert.match(source, /version: '1\.0'/)
  assert.match(source, /atomicRequired: true/)
  // source inspection verifies request shape, not hosted-wallet deployment success.
})


test('real tester draft binds the same public sender and self-call without claiming deployment', () => {
  const tester = '0xfb42D26Fb8566B77f8AEB73c92c35E1d6BCDAbaC'
  const draft = prepareWalletManagedFirstUse({ wallet: tester, expectedWallet: tester, chainId: 84532 })
  assert.equal(draft.request.params[0].from, tester)
  assert.deepEqual(draft.request.params[0].calls, [{ to: tester, value: '0x0', data: '0x' }])
  assert.equal(draft.deploymentSupport, 'UNVERIFIED_FOR_THIS_ACCOUNT')
  assert.equal(draft.executionEnabled, false)
  assert.equal(draft.feeQuote, null)
  assert.equal(draft.sponsorship, 'UNKNOWN')
})
